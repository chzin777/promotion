import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { loadItems, enrichItem, type Item } from './products.js'
import { readState, writeState, recordSent, wasSent } from './state.js'
import { pruneQueue } from './queue.js'
import { sendItem, checkConnection, listGroups } from './whatsapp.js'
import { startClient, type WAClient } from './wa.js'
import { runFeed, maybeFeed } from './feeder.js'
import { closeMlBrowser } from './ml.js'
import { closeAmazonBrowser } from './amazon.js'
import {
  readSettings,
  isItemAllowed,
  isMlLink,
  isAmazonLink,
  isShopeeLink,
  withinActiveHours,
  intervalPool,
  pauseAutomationOnBoot,
  getGroupIds,
  type AppSettings,
} from './settings.js'

const PAUSED_POLL_MS = 30_000
const PANEL_URL = `http://localhost:${process.env.PORT ?? '3002'}`

// ordem da rotacao alternada entre plataformas (so entram as que tem item na fila)
const PLATFORM_CYCLE = ['shopee', 'amazon', 'ml'] as const
type Platform = (typeof PLATFORM_CYCLE)[number] | 'outro'

function platformOf(it: Item): Platform {
  if (isShopeeLink(it.link, it.productUrl)) return 'shopee'
  if (isAmazonLink(it.link, it.productUrl)) return 'amazon'
  if (isMlLink(it.link, it.productUrl)) return 'ml'
  return 'outro'
}

/**
 * Escolhe o proximo item alternando plataforma: shopee -> amazon -> ml -> ...
 * So entram no ciclo as plataformas com item elegivel agora. Comeca pela seguinte
 * a ultima enviada (state.lastPlatform). Links manuais ('outro') so saem se nao
 * houver nada do ciclo. Devolve undefined se nada elegivel.
 */
function pickNext(items: Item[], state: ReturnType<typeof readState>, settings: AppSettings): Item | undefined {
  const eligible = items.filter((it) => !wasSent(it, state) && isItemAllowed(it, settings))
  if (!eligible.length) return undefined
  const present = PLATFORM_CYCLE.filter((p) => eligible.some((it) => platformOf(it) === p))
  if (!present.length) return eligible[0] // so links manuais
  const lastIdx = present.indexOf(state.lastPlatform as (typeof present)[number])
  const startIdx = lastIdx >= 0 ? (lastIdx + 1) % present.length : 0
  for (let i = 0; i < present.length; i++) {
    const p = present[(startIdx + i) % present.length]
    const hit = eligible.find((it) => platformOf(it) === p)
    if (hit) return hit
  }
  return eligible[0]
}

function stamp(): string {
  return new Date().toISOString()
}

/**
 * Modo skip: marca os proximos N produtos como ENVIADOS sem mandar nada. Usa a
 * fila atual e, se faltar, dispara a descoberta pra completar (ate maxRounds).
 * Serve pra "pular" produtos que ja foram divulgados por fora.
 */
async function drainSkip(state: ReturnType<typeof readState>, settings: ReturnType<typeof readSettings>): Promise<void> {
  console.log(`[${stamp()}] modo skip: pulando ${state.skipNext} produtos (marca como enviado, nao manda).`)
  const maxRounds = 8
  for (let round = 0; round < maxRounds && state.skipNext > 0; round++) {
    let skippedThisRound = 0
    for (const it of loadItems()) {
      if (state.skipNext <= 0) break
      if (wasSent(it, state) || !isItemAllowed(it, settings)) continue
      recordSent(it, state)
      state.skipNext -= 1
      skippedThisRound += 1
      console.log(`[${stamp()}] [skip] ${it.title || it.link} — faltam ${state.skipNext}`)
    }
    if (skippedThisRound > 0) {
      writeState(state)
      pruneQueue()
    }
    if (state.skipNext <= 0) break
    // fila esgotou e ainda falta pular: descobre mais
    try {
      const added = await runFeed()
      if (added <= 0 && skippedThisRound === 0) {
        console.log(`[${stamp()}] modo skip: sem mais produtos pra pular. Restavam ${state.skipNext}, zerando.`)
        state.skipNext = 0
        writeState(state)
        break
      }
    } catch (e) {
      console.error(`[${stamp()}] modo skip: descoberta falhou:`, (e as Error).message)
      break
    }
  }
  writeState(state)
  console.log(`[${stamp()}] modo skip concluido. Envio normal volta no proximo ciclo.`)
}

async function tick(client: WAClient): Promise<void> {
  const settings = readSettings()
  await writeWaStatus(client) // mantem o painel com conexao + grupo atuais

  if (!settings.automationRunning) {
    console.log(`[${stamp()}] automacao pausada — inicie pelo painel web (${PANEL_URL}).`)
    return
  }

  // modo skip tem prioridade: queima os proximos N sem mandar
  const skipState = readState()
  if (skipState.skipNext > 0) {
    await drainSkip(skipState, settings)
    return
  }

  let items = loadItems()

  if (settings.autoFeedEnabled && withinActiveHours(settings)) {
    await maybeFeed()
  }

  if (
    settings.feedReactiveThreshold > 0 &&
    items.length <= settings.feedReactiveThreshold &&
    withinActiveHours(settings)
  ) {
    console.log(`[${stamp()}] fila com ${items.length} itens. Coletando mais produtos...`)
    try {
      const added = await runFeed()
      if (added > 0) {
        console.log(`[${stamp()}] coletados ${added} novos. Recarregando...`)
        items = loadItems()
      }
    } catch (e) {
      console.error(`[${stamp()}] coleta falhou:`, (e as Error).message)
    }
  }

  if (items.length === 0) {
    console.log(
      `[${stamp()}] fila vazia. Aguardando proxima coleta (entre ${settings.activeHoursStart}h-${settings.activeHoursEnd}h).`,
    )
    return
  }

  const state = readState()
  const next = pickNext(items, state, settings)
  if (!next) {
    const paused = items.some((it) => !wasSent(it, state))
    if (paused) {
      console.log(`[${stamp()}] itens na fila, mas plataformas desativadas no painel. Aguardando.`)
    } else {
      console.log(`[${stamp()}] todos os ${items.length} produtos ja foram enviados. Aguardando novos links.`)
    }
    return
  }
  if (!withinActiveHours(settings)) {
    console.log(
      `[${stamp()}] fora do horario ativo (${settings.activeHoursStart}-${settings.activeHoursEnd}h). Espera.`,
    )
    return
  }

  const item = await enrichItem(next)
  try {
    await sendItem(client, item)
    console.log(`[${stamp()}] enviado: ${item.title || item.link}`)
    recordSent(next, state)
    const plat = platformOf(next)
    if (plat !== 'outro') state.lastPlatform = plat
    writeState(state)
    pruneQueue()
  } catch (e) {
    const detail = (e as { message?: string }).message ?? String(e)
    console.error(`[${stamp()}] FALHA ao enviar ${next.link}:`, detail)
  }
}

async function main(): Promise<void> {
  pauseAutomationOnBoot()

  const settings = readSettings()
  console.log('=== Worker promotion ===')
  const bootGroups = getGroupIds()
  console.log(`Grupos: ${bootGroups.length ? bootGroups.join(', ') : '(nenhum — defina no painel)'}`)
  const ritmo = settings.useIntervalPool && settings.sendIntervalPool.length
    ? `${settings.sendIntervalPool.join('/')}min (sorteado)`
    : `${settings.sendIntervalMinutes}min`
  console.log(`Intervalo: ${ritmo} | horario ativo: ${settings.activeHoursStart}-${settings.activeHoursEnd}h`)
  console.log(`ML: ${settings.mlEnabled ? 'on' : 'off'} | Amazon: ${settings.amazonEnabled ? 'on' : 'off'}`)
  console.log(`Coleta reativa quando fila <= ${settings.feedReactiveThreshold} itens`)
  console.log(`Automação PAUSADA — inicie pelo painel web: ${PANEL_URL}`)
  console.log('Subindo WhatsApp (whatsapp-web.js)...')

  const client = await startClient()
  await checkConnection(client)
  await writeWaStatus(client)
  await writeWaGroups(client)

  await tick(client)
  scheduleNext(client)
}

/** Grava nomes dos grupos + conexao pra o painel mostrar pra onde manda. */
async function writeWaStatus(client: WAClient): Promise<void> {
  const groupIds = getGroupIds()
  let connected = false
  try {
    const state = await client.getState().catch(() => null)
    connected = state === 'CONNECTED'
  } catch {
    /* assume desconectado */
  }
  const groups: { id: string; name: string }[] = []
  for (const id of groupIds) {
    let name = ''
    try {
      const chat = await client.getChatById(id)
      name = chat?.name ?? ''
    } catch (e) {
      console.warn(`[wa] nao resolveu o nome do grupo ${id}:`, (e as Error).message)
    }
    groups.push({ id, name })
  }
  try {
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.writeFileSync(
      path.join(config.dataDir, '.wa-status.json'),
      JSON.stringify({ groups, connected, updatedAt: new Date().toISOString() }, null, 2),
    )
  } catch {
    /* best-effort */
  }
}

/** Dump da lista de grupos do WhatsApp conectado pra o painel escolher o destino. */
async function writeWaGroups(client: WAClient): Promise<void> {
  try {
    const groups = await listGroups(client)
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.writeFileSync(
      path.join(config.dataDir, '.wa-groups.json'),
      JSON.stringify({ groups, updatedAt: new Date().toISOString() }, null, 2),
    )
    console.log(`[wa] ${groups.length} grupos disponiveis no painel.`)
  } catch (e) {
    console.warn('[wa] nao listou os grupos:', (e as Error).message)
  }
}

let lastMin = 0

function scheduleNext(client: WAClient): void {
  const settings = readSettings()

  if (!settings.automationRunning) {
    setTimeout(() => {
      void tick(client).finally(() => scheduleNext(client))
    }, PAUSED_POLL_MS)
    return
  }

  const pool = intervalPool(settings)
  const choices = pool.length > 1 ? pool.filter((m) => m !== lastMin) : pool
  const min = choices[Math.floor(Math.random() * choices.length)]
  lastMin = min
  console.log(`[${stamp()}] proximo envio em ${min} min.`)
  setTimeout(() => {
    void tick(client).finally(() => scheduleNext(client))
  }, min * 60_000)
}

let shuttingDown = false
async function shutdown(sig: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[${sig}] encerrando, salvando sessoes...`)
  await Promise.all([closeMlBrowser(), closeAmazonBrowser()])
  process.exit(0)
}
process.on('SIGINT', () => { void shutdown('SIGINT') })
process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGBREAK', () => { void shutdown('SIGBREAK') })

void main().catch((e) => {
  console.error('Erro fatal:', (e as Error).message)
  process.exit(1)
})
