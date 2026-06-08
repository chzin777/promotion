import fs from 'node:fs'
import path from 'node:path'
import { asin } from './amazon.js'
import { productId } from './discovery.js'
import { shopeeId } from './shopee.js'
import { config } from './config.js'

const stateFile = path.join(config.dataDir, '.state.json')

export type State = {
  sent: string[] // links de afiliado ja enviados (normalizados)
  sentProducts: string[] // ids de produto ja enviados (MLB..., ASIN)
  seenProducts: string[] // ids ja processados pela descoberta (nao reprocessa)
  lastFeed: { date: string; am: boolean; pm: boolean } // controle dos 2 slots/dia
  skipNext: number // marca os proximos N como enviados SEM mandar (descarta ja-enviados)
  sentSignatures: string[] // "AAAA-MM-DD|assinatura" — evita 2 produtos do mesmo tipo/dia
}

function empty(): State {
  return {
    sent: [],
    sentProducts: [],
    seenProducts: [],
    lastFeed: { date: '', am: false, pm: false },
    skipNext: 0,
    sentSignatures: [],
  }
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)]
}

/** Le estado. Sem arquivo (ou formato antigo) = comeca zerado. */
export function readState(): State {
  const parsed = readStateFrom(stateFile) ?? readStateFrom(stateFile + '.bak')
  if (!parsed) return empty()
  return parsed
}

/** Tenta ler+parsear um arquivo de estado. null se faltar/corromper. */
function readStateFrom(file: string): State | null {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      sent: uniq(Array.isArray(s.sent) ? s.sent.map((x: unknown) => linkKey(String(x))) : []),
      sentProducts: uniq(Array.isArray(s.sentProducts) ? s.sentProducts.map(String) : []),
      seenProducts: uniq(Array.isArray(s.seenProducts) ? s.seenProducts.map(String) : []),
      lastFeed: {
        date: String(s.lastFeed?.date ?? ''),
        am: Boolean(s.lastFeed?.am),
        pm: Boolean(s.lastFeed?.pm),
      },
      skipNext: Math.max(0, Number(s.skipNext) || 0),
      sentSignatures: uniq(Array.isArray(s.sentSignatures) ? s.sentSignatures.map(String) : []),
    }
  } catch {
    return null // arquivo faltando ou corrompido -> caller tenta o .bak
  }
}

/**
 * Persiste estado de forma ATOMICA. Escreve num .tmp e renomeia por cima — um
 * kill no meio nunca deixa o .state.json truncado (corrompido -> readState cairia
 * pra empty() e reenviaria tudo). Mantem um .bak do estado anterior como rede.
 */
export function writeState(s: State): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  const payload = JSON.stringify(
    {
      ...s,
      sent: uniq(s.sent),
      sentProducts: uniq(s.sentProducts),
      seenProducts: uniq(s.seenProducts),
      sentSignatures: uniq(s.sentSignatures),
    },
    null,
    2,
  )
  const tmp = stateFile + '.tmp'
  fs.writeFileSync(tmp, payload)
  // backup do atual (se valido) antes de sobrescrever
  try {
    if (fs.existsSync(stateFile)) fs.copyFileSync(stateFile, stateFile + '.bak')
  } catch {
    /* backup e best-effort */
  }
  fs.renameSync(tmp, stateFile) // rename e atomico no mesmo filesystem
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
    const sh = shopeeId(src)
    if (sh) return sh
  }
  return linkKey(link)
}

type Sendable = { link: string; productUrl?: string | null; title?: string | null }

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const SIG_STOP = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'sem', 'por', 'kit', 'und', 'tamanho',
  'feminina', 'masculina', 'masculino', 'feminino', 'premium', 'original', 'pares', 'par',
  'unidades', 'unidade', 'cor', 'pro', 'plus', 'the', 'and',
])

/**
 * Assinatura de "tipo" do produto: 3 primeiras palavras significativas do titulo
 * (sem acento, sem stopword/numero). Ex: "Meia-Calca Termica Feminina..." ->
 * "meia calca termica". Serve pra nao postar 2 produtos quase-iguais no mesmo dia.
 */
export function titleSignature(title?: string | null): string {
  if (!title) return ''
  const toks = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\x00-\x7f]/g, '') // tira acentos/combining (viram nada, nao espaco)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !SIG_STOP.has(w) && !/^\d+$/.test(w))
  return toks.slice(0, 3).join(' ')
}

/** Ja foi enviado? Checa link, id do produto E assinatura de tipo (1 por dia). */
export function wasSent(it: Sendable, state: State): boolean {
  const lk = linkKey(it.link)
  const pk = productKey(it.link, it.productUrl)
  if (new Set(state.sent).has(lk) || new Set(state.sentProducts).has(pk)) return true
  const sig = titleSignature(it.title)
  if (sig && state.sentSignatures.includes(`${todayKey()}|${sig}`)) return true
  return false
}

/** Registra envio bem-sucedido (link + produto + assinatura de tipo do dia). */
export function recordSent(it: Sendable, state: State): void {
  const lk = linkKey(it.link)
  const pk = productKey(it.link, it.productUrl)
  if (!state.sent.includes(lk)) state.sent.push(lk)
  if (!state.sentProducts.includes(pk)) state.sentProducts.push(pk)
  if (!state.seenProducts.includes(pk)) state.seenProducts.push(pk)
  const sig = titleSignature(it.title)
  if (sig) {
    const today = todayKey()
    // mantem so as assinaturas de hoje (limpa dias antigos, nao cresce sem limite)
    state.sentSignatures = state.sentSignatures.filter((e) => e.startsWith(`${today}|`))
    const key = `${today}|${sig}`
    if (!state.sentSignatures.includes(key)) state.sentSignatures.push(key)
  }
}
