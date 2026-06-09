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
  lastPlatform: string // ultima plataforma enviada (rotacao alternada shopee/amazon/ml)
}

function empty(): State {
  return {
    sent: [],
    sentProducts: [],
    seenProducts: [],
    lastFeed: { date: '', am: false, pm: false },
    skipNext: 0,
    sentSignatures: [],
    lastPlatform: '',
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
      lastPlatform: String(s.lastPlatform ?? ''),
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
 * Temas super-representados (saturam a fila). Cada tema tem um teto diario: passou
 * do teto, os proximos do mesmo tema sao tratados como "ja enviados" (pulados).
 * Diferente da titleSignature, agrupa titulos variados sob o mesmo guarda-chuva
 * (ex: "kit torcedor", "camiseta brasil", "babylook brasil" -> tema "copa").
 */
// Mesmo "tipo" de produto (titleSignature) nao se repete por esta janela de dias.
// Antes era so "1 por dia" -> bestsellers (meia calca, etc) voltavam todo dia.
const SIG_COOLDOWN_DAYS = 5

/** Data 'YYYY-MM-DD' esta dentro dos ultimos `days` dias (hoje incluso)? */
function withinCooldown(dateStr: string, days: number): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return false
  const then = new Date(y, m - 1, d).getTime()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.floor((today - then) / 86_400_000)
  return diff >= 0 && diff < days
}

const THEME_RULES: { re: RegExp; key: string; maxPerDay: number }[] = [
  {
    re: /copa do mundo|copa 2026|torcedor|torcida|\bfifa\b|sele[çc][ãa]o brasil|(camis|camiseta|moletom|blusa|babylook|babytee|regata)\w*.*brasil|brasil.*(camis|camiseta|moletom|blusa|babylook|regata)/i,
    key: 'copa',
    maxPerDay: 2,
  },
]

/** Tema saturado do titulo, ou '' se nenhum. */
export function themeOf(title?: string | null): string {
  if (!title) return ''
  for (const r of THEME_RULES) if (r.re.test(title)) return r.key
  return ''
}

function themeMax(key: string): number {
  return THEME_RULES.find((r) => r.key === key)?.maxPerDay ?? Infinity
}

/** Quantos itens deste tema ja sairam hoje. */
function themeCount(state: State, key: string): number {
  const pre = `${todayKey()}|tema:${key}|`
  return state.sentSignatures.filter((e) => e.startsWith(pre)).length
}

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
  // mesmo "tipo" (assinatura) ja saiu nos ultimos SIG_COOLDOWN_DAYS dias -> pula.
  const sig = titleSignature(it.title)
  if (sig) {
    for (const e of state.sentSignatures) {
      const i = e.indexOf('|')
      if (i < 0) continue
      if (e.slice(i + 1) === sig && withinCooldown(e.slice(0, i), SIG_COOLDOWN_DAYS)) return true
    }
  }
  // teto diario por tema (ex: copa/torcedor): passou do limite, pula.
  const th = themeOf(it.title)
  if (th && themeCount(state, th) >= themeMax(th)) return true
  return false
}

/** Registra envio bem-sucedido (link + produto + assinatura de tipo do dia). */
export function recordSent(it: Sendable, state: State): void {
  const lk = linkKey(it.link)
  const pk = productKey(it.link, it.productUrl)
  if (!state.sent.includes(lk)) state.sent.push(lk)
  if (!state.sentProducts.includes(pk)) state.sentProducts.push(pk)
  if (!state.seenProducts.includes(pk)) state.seenProducts.push(pk)
  const today = todayKey()
  const sig = titleSignature(it.title)
  const th = themeOf(it.title)
  // limpa entradas fora da janela de cooldown (nao cresce sem limite)
  state.sentSignatures = state.sentSignatures.filter((e) => {
    const i = e.indexOf('|')
    return i > 0 && withinCooldown(e.slice(0, i), SIG_COOLDOWN_DAYS)
  })
  if (sig) {
    const key = `${today}|${sig}`
    if (!state.sentSignatures.includes(key)) state.sentSignatures.push(key)
  }
  // 1 marcador por envio do tema (chave unica por link) -> permite contar quantos sairam hoje.
  if (th) state.sentSignatures.push(`${today}|tema:${th}|${lk}`)
}
