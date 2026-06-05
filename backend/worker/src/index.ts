import { config } from './config.js'
import { loadItems, enrichItem, type Item } from './products.js'
import { readState, writeState, linkKey } from './state.js'
import { sendItem, checkConnection } from './whatsapp.js'
import { startClient, type WAClient } from './wa.js'
import { maybeFeed } from './feeder.js'
import { closeMlBrowser } from './ml.js'
import { closeAmazonBrowser } from './amazon.js'

function withinActiveHours(): boolean {
  const h = new Date().getHours()
  return h >= config.activeStart && h < config.activeEnd
}

function stamp(): string {
  return new Date().toISOString()
}

async function tick(client: WAClient): Promise<void> {
  // descoberta automatica 2x/dia (nao-bloqueante: roda em paralelo aos envios)
  void maybeFeed().catch((e) => console.error('[feed] erro:', (e as Error).message))

  const items: Item[] = loadItems()
  if (items.length === 0) {
    console.log(`[${stamp()}] sem produtos. Crie data/produtos.xlsx (ou o .txt/.json do dia).`)
    return
  }

  const state = readState()
  const sent = new Set(state.sent)
  const next = items.find((it) => !sent.has(linkKey(it.link)))
  if (!next) {
    console.log(`[${stamp()}] todos os ${items.length} produtos ja foram enviados. Aguardando novos links.`)
    return
  }
  if (!withinActiveHours()) {
    console.log(`[${stamp()}] fora do horario ativo (${config.activeStart}-${config.activeEnd}h). Espera.`)
    return
  }

  const item = await enrichItem(next)
  try {
    await sendItem(client, item)
    console.log(`[${stamp()}] enviado: ${item.title || item.link}`)
    state.sent.push(linkKey(next.link))
    writeState(state) // so marca como enviado apos sucesso
  } catch (e) {
    const detail = (e as { message?: string }).message ?? String(e)
    console.error(`[${stamp()}] FALHA ao enviar ${next.link}:`, detail)
    // nao marca -> tenta de novo no proximo tick
  }
}

async function main(): Promise<void> {
  console.log('=== Worker promotion ===')
  console.log(`Grupo: ${config.groupId}`)
  const ritmo = config.intervalPoolMin.length ? `${config.intervalPoolMin.join('/')}min (sorteado)` : `${config.intervalMin}min`
  console.log(`Intervalo: ${ritmo} | horario ativo: ${config.activeStart}-${config.activeEnd}h`)
  console.log('Subindo WhatsApp (whatsapp-web.js)...')

  const client = await startClient()
  await checkConnection(client)

  await tick(client)
  scheduleNext(client)
}

let lastMin = 0
/** Sorteia o proximo intervalo do pool (evita repetir o ultimo) e agenda o tick. */
function scheduleNext(client: WAClient): void {
  const pool = config.intervalPoolMin.length ? config.intervalPoolMin : [config.intervalMin]
  const choices = pool.length > 1 ? pool.filter((m) => m !== lastMin) : pool
  const min = choices[Math.floor(Math.random() * choices.length)]
  lastMin = min
  console.log(`[${stamp()}] proximo envio em ${min} min.`)
  setTimeout(() => {
    void tick(client).finally(() => scheduleNext(client))
  }, min * 60_000)
}

// fecha o chrome do afiliado de forma limpa no shutdown -> cookies vao pro disco
let shuttingDown = false
async function shutdown(sig: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[${sig}] encerrando, salvando sessoes...`)
  await Promise.all([closeMlBrowser(), closeAmazonBrowser()])
  process.exit(0)
}
process.on('SIGINT', () => { void shutdown('SIGINT') })   // Ctrl+C
process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGBREAK', () => { void shutdown('SIGBREAK') }) // Ctrl+Break (Windows)

void main().catch((e) => {
  console.error('Erro fatal:', (e as Error).message)
  process.exit(1)
})
