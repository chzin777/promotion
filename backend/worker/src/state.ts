import fs from 'node:fs'
import path from 'node:path'
import { asin } from './amazon.js'
import { productId } from './discovery.js'
import { config } from './config.js'

const stateFile = path.join(config.dataDir, '.state.json')

export type State = {
  sent: string[] // links de afiliado ja enviados (normalizados)
  sentProducts: string[] // ids de produto ja enviados (MLB..., ASIN)
  seenProducts: string[] // ids ja processados pela descoberta (nao reprocessa)
  lastFeed: { date: string; am: boolean; pm: boolean } // controle dos 2 slots/dia
}

function empty(): State {
  return { sent: [], sentProducts: [], seenProducts: [], lastFeed: { date: '', am: false, pm: false } }
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)]
}

/** Le estado. Sem arquivo (ou formato antigo) = comeca zerado. */
export function readState(): State {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    return {
      sent: uniq(Array.isArray(s.sent) ? s.sent.map((x: unknown) => linkKey(String(x))) : []),
      sentProducts: uniq(Array.isArray(s.sentProducts) ? s.sentProducts.map(String) : []),
      seenProducts: uniq(Array.isArray(s.seenProducts) ? s.seenProducts.map(String) : []),
      lastFeed: {
        date: String(s.lastFeed?.date ?? ''),
        am: Boolean(s.lastFeed?.am),
        pm: Boolean(s.lastFeed?.pm),
      },
    }
  } catch {
    return empty()
  }
}

/** Persiste estado (sobrevive a reinicio do worker). */
export function writeState(s: State): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        ...s,
        sent: uniq(s.sent),
        sentProducts: uniq(s.sentProducts),
        seenProducts: uniq(s.seenProducts),
      },
      null,
      2,
    ),
  )
}

/** Chave estavel de um link (normaliza URL pra nao tratar variacoes como novas). */
export function linkKey(link: string): string {
  let s = link.trim()
  try {
    const u = new URL(s)
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith('utm_') || k === 'ref' || k.startsWith('pf_rd_') || k.startsWith('pd_rd_')) {
        u.searchParams.delete(k)
      }
    }
    u.pathname = u.pathname.replace(/\/+$/, '') || '/'
    s = u.toString()
  } catch {
    /* link relativo ou malformado: usa trim */
  }
  return s
}

/** Id canonico do produto (MLB, ASIN) ou o proprio link normalizado como fallback. */
export function productKey(link: string, productUrl?: string | null): string {
  for (const src of [productUrl?.trim(), link.trim()].filter(Boolean) as string[]) {
    const ml = productId(src)
    if (/^MLB\d+$/i.test(ml)) return ml.toUpperCase()
    const a = asin(src)
    if (a) return a
  }
  return linkKey(link)
}

type Sendable = { link: string; productUrl?: string | null }

/** Ja foi enviado? Checa link normalizado E id do produto. */
export function wasSent(it: Sendable, state: State): boolean {
  const lk = linkKey(it.link)
  const pk = productKey(it.link, it.productUrl)
  const sentLinks = new Set(state.sent)
  const sentProducts = new Set(state.sentProducts)
  return sentLinks.has(lk) || sentProducts.has(pk)
}

/** Registra envio bem-sucedido (link + produto + visto na descoberta). */
export function recordSent(it: Sendable, state: State): void {
  const lk = linkKey(it.link)
  const pk = productKey(it.link, it.productUrl)
  if (!state.sent.includes(lk)) state.sent.push(lk)
  if (!state.sentProducts.includes(pk)) state.sentProducts.push(pk)
  if (!state.seenProducts.includes(pk)) state.seenProducts.push(pk)
}
