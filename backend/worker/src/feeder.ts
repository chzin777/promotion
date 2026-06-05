import { config } from './config.js'
import { discoverProductUrls, productId } from './discovery.js'
import { buildPromos, type Promo } from './affiliate.js'
import { discoverAmazonUrls, buildAmazonPromos, asin } from './amazon.js'
import { readState, writeState } from './state.js'
import { appendQueue } from './queue.js'
import { todayStr, isBasePriceGiftCard, type Item } from './products.js'

/** Intercala dois arrays (a0, b0, a1, b1, ...) pra alternar as fontes na fila. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (a[i] !== undefined) out.push(a[i])
    if (b[i] !== undefined) out.push(b[i])
  }
  return out
}

function promosToItems(promos: Promo[]): Item[] {
  return promos
    .filter((p) => p.link)
    .map((p) => ({
      link: p.link as string,
      productUrl: p.productUrl,
      title: p.title || undefined,
      image: p.image || undefined,
      price: p.price || undefined,
      oldPrice: p.oldPrice || undefined,
    }))
    .filter((it) => !isBasePriceGiftCard(it)) // nao enfileira gift card sem promo
}

let feeding = false

/**
 * Descobre `count` produtos novos, gera o link de afiliado de cada e joga na
 * fila. Marca os ids como vistos (mesmo os que falharam, pra nao reprocessar).
 * Devolve quantas promos boas entraram. Guard contra execucao concorrente.
 */
export async function runFeed(count: number): Promise<number> {
  if (feeding) {
    console.log('[feed] ja rodando, ignora.')
    return 0
  }
  feeding = true
  try {
    const state = readState()
    const seen = new Set(state.seenProducts)

    // 1. Mercado Livre
    console.log(`[feed] ML: descobrindo ${count} produtos...`)
    const mlUrls = await discoverProductUrls(count, seen)
    const mlPromos = mlUrls.length ? await buildPromos(mlUrls) : []
    const mlItems = promosToItems(mlPromos)
    console.log(`[feed] ML: ${mlItems.length}/${mlUrls.length} links gerados.`)

    // 2. Amazon (opcional: so com tag). Isolado: se quebrar, o ML ja segue.
    let amzUrls: string[] = []
    let amzItems: Item[] = []
    if (config.amazonTag) {
      try {
        console.log(`[feed] Amazon: descobrindo ${config.amazonFeedCount} produtos...`)
        amzUrls = await discoverAmazonUrls(config.amazonFeedCount, seen)
        const amzPromos = amzUrls.length ? await buildAmazonPromos(amzUrls) : []
        amzItems = promosToItems(amzPromos)
        console.log(`[feed] Amazon: ${amzItems.length}/${amzUrls.length} links gerados.`)
      } catch (e) {
        console.error('[feed] Amazon falhou (segue so com ML):', (e as Error).message)
      }
    }

    if (!mlUrls.length && !amzUrls.length) {
      console.log('[feed] nenhum produto novo encontrado.')
      return 0
    }

    // 3. intercala ML/Amazon na fila (mesmo rodizio)
    const added = appendQueue(interleave(mlItems, amzItems))

    // 4. marca TODOS os descobertos como vistos (inclui falhas, pra nao travar)
    const st = readState()
    for (const u of mlUrls) st.seenProducts.push(productId(u))
    for (const u of amzUrls) st.seenProducts.push(asin(u) || u)
    writeState(st)

    console.log(`[feed] ${added} novos na fila (ML+Amazon).`)
    return added
  } finally {
    feeding = false
  }
}

/**
 * Agendador 2x/dia: roda o slot da manha (>= feedAmHour) e o da tarde
 * (>= feedPmHour) uma vez cada por dia. Nao-bloqueante (use sem await no tick).
 */
export async function maybeFeed(): Promise<void> {
  const now = new Date()
  const date = todayStr()
  const hour = now.getHours()

  let state = readState()
  if (state.lastFeed.date !== date) {
    state.lastFeed = { date, am: false, pm: false }
    writeState(state)
  }

  const slot: 'am' | 'pm' = hour < 12 ? 'am' : 'pm'
  const startHour = slot === 'am' ? config.feedAmHour : config.feedPmHour
  const alreadyDone = slot === 'am' ? state.lastFeed.am : state.lastFeed.pm
  if (hour < startHour || alreadyDone) return

  console.log(`[feed] slot ${slot} do dia ${date} — iniciando descoberta automatica.`)
  await runFeed(config.feedCount)

  state = readState()
  state.lastFeed[slot] = true
  writeState(state)
}
