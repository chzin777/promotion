import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { loadItems, enrichItem } from './products.js'
import { readState, writeState, recordSent, wasSent } from './state.js'
import { pruneQueue } from './queue.js'
import { sendItem, checkConnection } from './whatsapp.js'
import { startClient, type WAClient } from './wa.js'
import { runFeed, maybeFeed } from './feeder.js'
import { closeMlBrowser } from './ml.js'
import { closeAmazonBrowser } from './amazon.js'
import { readSettings, isItemAllowed, withinActiveHours, intervalPool, pauseAutomationOnBoot } from './settings.js'

const PAUSED_POLL_MS = 30_000

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

  if (!settings.automationRunning) {
    console.log(`[${stamp()}] automacao pausada — inicie pelo painel web (http://localhost:3000).`)
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
  const next = items.find((it) => !wasSent(it, state) && isItemAllowed(it, settings))
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
  console.log(`Grupo: ${config.groupId}`)
  const ritmo = settings.useIntervalPool && settings.sendIntervalPool.length
    ? `${settings.sendIntervalPool.join('/')}min (sorteado)`
    : `${settings.sendIntervalMinutes}min`
  console.log(`Intervalo: ${ritmo} | horario ativo: ${settings.activeHoursStart}-${settings.activeHoursEnd}h`)
  console.log(`ML: ${settings.mlEnabled ? 'on' : 'off'} | Amazon: ${settings.amazonEnabled ? 'on' : 'off'}`)
  console.log(`Coleta reativa quando fila <= ${settings.feedReactiveThreshold} itens`)
  console.log('Automação PAUSADA — inicie pelo painel web: http://localhost:3000')
  console.log('Subindo WhatsApp (whatsapp-web.js)...')

  const client = await startClient()
  await checkConnection(client)
  await writeWaStatus(client)

  await tick(client)
  scheduleNext(client)
}

/** Grava nome do grupo + conexao pra o painel mostrar pra onde manda. */
async function writeWaStatus(client: WAClient): Promise<void> {
  let groupName = ''
  try {
    if (config.groupId) {
      const chat = await client.getChatById(config.groupId)
      groupName = chat?.name ?? ''
      console.log(`[wa] enviando para o grupo: ${groupName || '(sem nome)'} (${config.groupId})`)
    }
  } catch (e) {
    console.warn('[wa] nao resolveu o nome do grupo:', (e as Error).message)
  }
  try {
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.writeFileSync(
      path.join(config.dataDir, '.wa-status.json'),
      JSON.stringify(
        { groupId: config.groupId, groupName, connected: true, updatedAt: new Date().toISOString() },
        null,
        2,
      ),
    )
  } catch {
    /* best-effort */
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
