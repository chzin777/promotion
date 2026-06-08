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

async function tick(client: WAClient): Promise<void> {
  const settings = readSettings()

  if (!settings.automationRunning) {
    console.log(`[${stamp()}] automacao pausada — inicie pelo painel web (http://localhost:3000).`)
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

  await tick(client)
  scheduleNext(client)
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
