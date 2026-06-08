import { config } from './config.js'
import { discoverProductUrls, productId } from './discovery.js'
import { buildPromos, type Promo } from './affiliate.js'
import { discoverAmazonUrls, buildAmazonPromos, asin } from './amazon.js'
import { readState, writeState, wasSent } from './state.js'
import { appendQueue } from './queue.js'
import { todayStr, isBasePriceGiftCard, type Item } from './products.js'
import { readSettings, getAmazonTag } from './settings.js'

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

function promosToItems(promos: Promo[], state = readState()): Item[] {
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
    .filter((it) => !isBasePriceGiftCard(it) && !wasSent(it, state))
}

let feeding = false

/**
 * Descobre `count` produtos novos, gera o link de afiliado de cada e joga na
 * fila. Marca os ids como vistos (mesmo os que falharam, pra nao reprocessar).
 * Devolve quantas promos boas entraram. Guard contra execucao concorrente.
 */
export async function runFeed(count?: number): Promise<number> {
  if (feeding) {
    console.log('[feed] ja rodando, ignora.')
    return 0
  }
  feeding = true
  try {
    const settings = readSettings()
    const mlCount = count ?? settings.feedCount
    const state = readState()
    const seen = new Set([...state.seenProducts, ...state.sentProducts])

    let mlUrls: string[] = []
    let mlItems: Item[] = []
    if (settings.mlEnabled && mlCount > 0) {
      console.log(`[feed] ML: descobrindo ${mlCount} produtos...`)
      mlUrls = await discoverProductUrls(mlCount, seen)
      const mlPromos = mlUrls.length ? await buildPromos(mlUrls) : []
      mlItems = promosToItems(mlPromos)
      console.log(`[feed] ML: ${mlItems.length}/${mlUrls.length} links gerados.`)
    } else {
      console.log('[feed] ML desativado no painel.')
    }

    let amzUrls: string[] = []
    let amzItems: Item[] = []
    if (settings.amazonEnabled && getAmazonTag() && settings.amazonFeedCount > 0) {
      try {
        console.log(`[feed] Amazon: descobrindo ${settings.amazonFeedCount} produtos...`)
        amzUrls = await discoverAmazonUrls(settings.amazonFeedCount, seen)
        const amzPromos = amzUrls.length ? await buildAmazonPromos(amzUrls) : []
        amzItems = promosToItems(amzPromos)
        console.log(`[feed] Amazon: ${amzItems.length}/${amzUrls.length} links gerados.`)
      } catch (e) {
        console.error('[feed] Amazon falhou:', (e as Error).message)
      }
    } else if (settings.amazonEnabled && !getAmazonTag()) {
      console.log('[feed] Amazon ativa no painel, mas tag de afiliado vazia.')
    } else {
      console.log('[feed] Amazon desativada no painel.')
    }

    if (!mlUrls.length && !amzUrls.length) {
      console.log('[feed] nenhum produto novo encontrado.')
      return 0
    }

    const added = appendQueue(interleave(mlItems, amzItems))

    const st = readState()
    for (const u of mlUrls) st.seenProducts.push(productId(u))
    for (const u of amzUrls) st.seenProducts.push(asin(u) || u)
    writeState(st)

    console.log(`[feed] ${added} novos na fila.`)
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
  const settings = readSettings()
  if (!settings.autoFeedEnabled) return

  const now = new Date()
  const date = todayStr()
  const hour = now.getHours()

  let state = readState()
  if (state.lastFeed.date !== date) {
    state.lastFeed = { date, am: false, pm: false }
    writeState(state)
  }

  const slot: 'am' | 'pm' = hour < 12 ? 'am' : 'pm'
  const startHour = slot === 'am' ? settings.feedAmHour : settings.feedPmHour
  const alreadyDone = slot === 'am' ? state.lastFeed.am : state.lastFeed.pm
  if (hour < startHour || alreadyDone) return

  console.log(`[feed] slot ${slot} do dia ${date} — iniciando descoberta automatica.`)
  await runFeed()

  state = readState()
  state.lastFeed[slot] = true
  writeState(state)
}
