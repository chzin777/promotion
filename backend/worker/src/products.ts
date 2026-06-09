import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { config } from './config.js'
import { scrapeMeta } from './scrape.js'
import { linkKey, productKey, readState, wasSent } from './state.js'
import { pruneQueue } from './queue.js'

export type Item = {
  title?: string
  price?: string
  oldPrice?: string | null
  code?: string
  link: string
  /** URL da pagina real do produto no ML. Worker busca a imagem (og:image) dela. */
  productUrl?: string | null
  /** Imagem explicita. Se vazio mas link/productUrl presente, worker resolve sozinho. */
  image?: string | null
  message?: string | null
}

// gift cards / recargas / vale-presente: preco = valor de face (sem promo).
const GIFT_RE = /\b(gift\s*-?\s*card|cart[aã]o\s*(de\s*)?presente|vale[\s-]?presente|e-?shop|playstation\s*store|psn|nintendo\s*(eshop|switch\s*online)|google\s*play|xbox\s*(live|game\s*pass)|steam|recarga|cr[eé]ditos?)\b/i

/** Extrai o 1o valor em R$ de um texto. 0 se nao achar. Aceita formato BR. */
function brNum(s: string): number {
  const m = s.match(/R\$\s*([\d.,]+)/i) ?? s.match(/([\d.,]+)/)
  if (!m) return 0
  let n = m[1]
  if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.') // BR: 1.299,90
  else n = n.replace(/,/g, '')
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

/**
 * Gift card / recarga SEM promo real? So vale postar se tiver desconto de fato.
 * Compara o valor de face no titulo (ex "Gift Card R$ 50") com o preco cobrado.
 * preco >= face (ou sem desconto >=3%) = preco base, nao e promocao -> dropa.
 */
export function isBasePriceGiftCard(it: Item): boolean {
  const title = it.title ?? ''
  if (!GIFT_RE.test(title)) return false // nao e gift card -> mantem
  const face = brNum(title)
  const price = brNum(it.price ?? '')
  if (face && price && price < face * 0.97) return false // desconto real -> mantem
  return true // sem desconto detectavel -> junk
}

/** Data local no formato AAAA-MM-DD. */
export function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Carrega itens. Prioridade:
 *  1. produtos.xlsx  -> planilha fixa: voce cola so o link (e preco opcional);
 *     o worker busca titulo/foto/descricao sozinho.
 *  2. AAAA-MM-DD.txt -> cola dos textos de "Compartilhar" do ML.
 *  3. AAAA-MM-DD.json -> modo avancado estruturado.
 */
export function loadItems(date = todayStr()): Item[] {
  // 1. itens manuais (planilha/txt/json), se houver
  let manual: Item[] = []
  const xlsx = path.join(config.dataDir, 'produtos.xlsx')
  const txt = path.join(config.dataDir, `${date}.txt`)
  if (fs.existsSync(xlsx)) manual = loadXlsx(xlsx)
  else if (fs.existsSync(txt)) manual = loadTxt(txt)
  else manual = loadJson(date)

  // 2. fila automatica (descoberta -> link afiliado). Lazy import evita ciclo.
  let auto: Item[] = []
  const queueFile = path.join(config.dataDir, 'auto-queue.json')
  if (fs.existsSync(queueFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(queueFile, 'utf8'))
      if (Array.isArray(data)) auto = data as Item[]
    } catch {
      console.warn('[queue] auto-queue.json invalido, ignorando.')
    }
  }

  // manuais primeiro, depois a fila automatica. Dropa gift card, enviados e duplicados.
  pruneQueue()
  return dedupePending([...manual, ...auto].filter((it) => it.link && it.link.trim() && !isBasePriceGiftCard(it)))
}

/** Remove itens ja enviados e duplicatas (mesmo link ou mesmo produto). */
function dedupePending(items: Item[]): Item[] {
  const state = readState()
  const seenLinks = new Set<string>()
  const seenProducts = new Set<string>()
  const out: Item[] = []
  for (const it of items) {
    if (wasSent(it, state)) continue
    const lk = linkKey(it.link)
    const pk = productKey(it.link, it.productUrl)
    if (seenLinks.has(lk) || seenProducts.has(pk)) continue
    seenLinks.add(lk)
    seenProducts.add(pk)
    out.push(it)
  }
  return out
}

/**
 * Modo planilha (o jeito facil): primeira aba do produtos.xlsx.
 * Cada linha = uma oferta. Acha sozinho a celula com o link (http...) e,
 * se houver, uma celula que pareca preco (R$ 99,90 / 99,90). Ordem das
 * colunas e cabecalho nao importam.
 */
function loadXlsx(file: string): Item[] {
  const wb = XLSX.readFile(file)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })
  const items: Item[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const cells = row.map((c) => (c == null ? '' : String(c).trim()))
    const link = cells.find((c) => /https?:\/\/\S+/i.test(c))?.match(/https?:\/\/\S+/i)?.[0]
    if (!link) continue // pula cabecalho e linhas sem link
    const price = cells.find((c) => c !== link && isPrice(c))
    items.push({ link, price: price ? normPrice(price) : undefined })
  }
  return items
}

/** Parece preco? Aceita "R$ 1.299,90", "1299,90", "99.90". */
function isPrice(s: string): boolean {
  return /^(r\$\s*)?\d{1,3}(\.\d{3})*(,\d{2})?$/i.test(s) || /^(r\$\s*)?\d+([.,]\d{1,2})?$/i.test(s)
}

/** Garante o prefixo R$. */
function normPrice(s: string): string {
  const v = s.replace(/r\$\s*/i, '').trim()
  return `R$ ${v}`
}

/**
 * Modo medio: cola os textos de "Compartilhar" do ML, um atras do outro.
 * Cada linha com um link (http...) FECHA uma oferta. Worker manda o bloco
 * exatamente como veio do ML (com emoji, codigo, link).
 */
function loadTxt(file: string): Item[] {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const items: Item[] = []
  let buf: string[] = []
  for (const line of lines) {
    buf.push(line)
    const url = line.match(/https?:\/\/\S+/)
    if (url) {
      const message = buf.join('\n').trim()
      if (message) items.push({ message, link: url[0] })
      buf = []
    }
  }
  if (buf.join('').trim()) {
    console.warn('[txt] texto no final sem link foi ignorado:', buf.join(' ').slice(0, 60))
  }
  return items
}

/** Modo avancado: JSON estruturado (title/price/image/etc). */
function loadJson(date: string): Item[] {
  const file = path.join(config.dataDir, `${date}.json`)
  if (!fs.existsSync(file)) return []
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`[erro] JSON invalido em ${file}:`, (e as Error).message)
    return []
  }
  const items: Item[] = Array.isArray((data as { items?: unknown }).items)
    ? ((data as { items: Item[] }).items)
    : []
  return items.filter((it) => {
    if (!it.link || !it.link.trim()) {
      console.warn('[skip] item sem link:', it.title ?? '(sem titulo)')
      return false
    }
    return true
  })
}

/**
 * Completa o item buscando titulo + imagem na pagina do link (og:tags).
 * So mexe no que falta — itens do .txt/.json com message/title proprios
 * passam intactos. Devolve um item novo (nao muta o original).
 */
export async function enrichItem(it: Item): Promise<Item> {
  if (it.message?.trim()) return it // .txt manda o bloco verbatim
  // ja completo? (titulo + imagem + preco, ou sem fonte pra raspar)
  if (it.title?.trim() && it.image?.trim() && it.price?.trim()) return it
  // prioriza a pagina canonica do produto (tem preco); senao o proprio link
  const src = it.productUrl?.trim() || it.link
  const meta = await scrapeMeta(src)
  return {
    ...it,
    title: it.title?.trim() || meta.title || undefined,
    image: it.image?.trim() || meta.image || undefined,
    price: it.price?.trim() || meta.price || undefined,
  }
}

/**
 * Variantes de mensagem (hardcoded). Cada uma: cabecalho (hype no topo), 1-2
 * linhas de urgencia e o rotulo do CTA. Preco/titulo/link entram sempre.
 * Sorteia uma por envio pra nao repetir o mesmo texto toda hora.
 */
type MsgVariant = { hype: string[]; cta: string }

const VARIANTS: MsgVariant[] = [
  { hype: ['📉 Aproveite enquanto está nesse valor', '⏳ Corre que é por tempo limitado!'], cta: '🛒 Pega o seu agora:' },
  { hype: ['🤑 Difícil achar mais barato', '🔥 Últimas unidades nesse preço!'], cta: '👉 Não perde:' },
  { hype: ['💸 Economia de verdade nessa', '⏰ Promo pode encerrar a qualquer hora'], cta: '👉 Aproveita aqui:' },
  { hype: ['🔝 Bem avaliado e com bom preço', '⚡ Estoque voa, não vacila!'], cta: '👉 Confere no link:' },
  { hype: ['🤯 Esse preço tá surreal', '⏳ Aproveite antes que volte ao normal'], cta: '🛒 Quero esse:' },
  { hype: ['✅ Direto da loja oficial, sem enrolação', '⚡ Corre que acaba!'], cta: '👉 Garanta agora:' },
  { hype: ['💰 Pagou menos, levou igual', '🔥 Oferta por tempo limitado'], cta: '🛒 Aproveita:' },
  { hype: ['👀 Difícil deixar passar', '⏰ Pode subir a qualquer momento!'], cta: '👉 Pega o link:' },
  { hype: ['🔥 Caiu o preço agora há pouco', '⏳ Não sei até quando fica assim'], cta: '🛒 Garante o seu:' },
  { hype: ['💰 Vale muito a pena nesse valor', '🚀 Sai voando do estoque!'], cta: '👉 Aproveita:' },
  { hype: ['⭐ Um dos mais procurados', '⏰ Promo por tempo limitado'], cta: '🛒 Pega já:' },
  { hype: ['📉 Preço baixou de verdade', '⚡ Corre antes que normalize'], cta: '👉 Confere:' },
  { hype: ['🤩 Esse achado tá top', '🔥 Últimas peças nesse preço'], cta: '👉 Garante:' },
  { hype: ['✅ Qualidade com preço justo', '⏳ Oferta pode sumir a qualquer hora'], cta: '🛒 Quero o meu:' },
  { hype: ['💎 Vale cada centavo', '⏰ Some rápido, não vacila'], cta: '🛒 Pega o link:' },
]

/** Nome da loja a partir do link (pra nao citar loja errada). */
function storeName(link: string): string {
  if (/amazon\./i.test(link)) return 'Amazon'
  if (/meli\.|mercadolivre/i.test(link)) return 'Mercado Livre'
  if (/shopee\.com|s\.shopee\./i.test(link)) return 'Shopee'
  return ''
}

/** Monta a mensagem do WhatsApp a partir do item (descricao hype automatica). */
export function formatMessage(it: Item): string {
  if (it.message && it.message.trim()) return it.message.trim()

  const v = VARIANTS[Math.floor(Math.random() * VARIANTS.length)]
  const lines: string[] = []
  if (it.title?.trim()) {
    lines.push(`📦 ${it.title.trim()}`)
  } else {
    const loja = storeName(it.link)
    if (loja) lines.push(`🛍️ Oferta na ${loja}`)
  }

  // preco: mostra De/Por (riscado) so quando tem desconto real; senao so o atual
  const cur = it.price?.trim() ?? ''
  const old = it.oldPrice?.trim() ?? ''
  const curN = brNum(cur)
  const oldN = brNum(old)
  if (cur && old && curN > 0 && oldN > curN) {
    lines.push(`❌ De: ~${old}~`)
    lines.push(`✅ Por: ${cur}`)
  } else if (cur) {
    lines.push(`💰 ${cur}`)
  }

  lines.push('')
  for (const h of v.hype) lines.push(h)

  if (it.code?.trim()) {
    lines.push('')
    lines.push('🔍 Cole no buscador do Mercado Livre:')
    lines.push(it.code.trim())
  }

  lines.push('')
  lines.push(v.cta)
  lines.push(it.link.trim())

  return lines.join('\n')
}
