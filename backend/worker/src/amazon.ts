import fs from 'node:fs'
import path from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer'
import { config } from './config.js'
import { resolveChrome } from './chrome.js'
import { getAmazonTag } from './settings.js'
import type { Promo } from './affiliate.js'

// fontes gerais
const GENERAL = ['https://www.amazon.com.br/bestsellers', 'https://www.amazon.com.br/deals']
// fontes de categoria (vies pra roupas/tenis/utilidades) — slugs validados
const CATEGORY = [
  'https://www.amazon.com.br/bestsellers/fashion', // roupas/tenis
  'https://www.amazon.com.br/bestsellers/kitchen', // utilidades cozinha
  'https://www.amazon.com.br/bestsellers/home', // utilidades casa
]

let browser: Browser | null = null

function clearStaleLocks(dir: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('Singleton')) fs.rmSync(path.join(dir, f), { force: true })
    }
  } catch {
    /* dir nao existe ainda = 1a vez, ok */
  }
}

/** Sobe (ou reusa) o navegador da Amazon. Sem login — perfil so ajuda anti-bot. */
export async function getAmazonBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser
  clearStaleLocks(config.amazonSessionDir)
  browser = await puppeteer.launch({
    headless: config.amazonHeadless,
    userDataDir: config.amazonSessionDir,
    executablePath: resolveChrome(),
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR'],
  })
  return browser
}

export async function closeAmazonBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
}

/** ASIN do produto (10 chars). Serve de id pra dedupe. '' se nao achar. */
export function asin(url: string): string {
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i)
  return m ? m[1].toUpperCase() : ''
}

/** Monta o link de afiliado canonico: /dp/ASIN?tag=suatag. '' se sem ASIN/tag. */
export function amazonLink(url: string): string {
  const id = asin(url)
  const tag = getAmazonTag()
  if (!id || !tag) return ''
  return `https://www.amazon.com.br/dp/${id}?tag=${tag}`
}

/** Coleta URLs /dp/ASIN visiveis na pagina. */
const GRAB_JS = `(() => {
  const set = new Set();
  document.querySelectorAll('a[href*="/dp/"]').forEach(a => {
    const m = (a.href || '').match(/\\/dp\\/[A-Z0-9]{10}/i);
    if (m) set.add('https://www.amazon.com.br' + m[0]);
  });
  return Array.from(set);
})()`

async function grabFrom(page: Page, url: string, scrolls = 4): Promise<string[]> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate('window.scrollBy(0, document.body.scrollHeight)')
      await new Promise((r) => setTimeout(r, 1200))
    }
    return (await page.evaluate(GRAB_JS)) as string[]
  } catch (e) {
    console.warn('[amazon] falha em', url, '-', (e as Error).message)
    return []
  }
}

/** Junta varias paginas-fonte numa lista unica (na ordem dada). */
async function grabSources(page: Page, urls: string[], tag: string): Promise<string[]> {
  const all: string[] = []
  for (const u of urls) {
    const found = await grabFrom(page, u, 5)
    console.log(`[amazon] ${tag} ${u.split('/').pop()}: ${found.length} produtos`)
    all.push(...found)
  }
  return all
}

/**
 * Descobre URLs de produto, dedupa por ASIN. Puxa ~2:1 pra categorias
 * (roupas/tenis/utilidades) sobre as fontes gerais, sem ser exclusivo.
 */
export async function discoverAmazonUrls(limit: number, exclude: Set<string> = new Set()): Promise<string[]> {
  if (!getAmazonTag()) return []
  const b = await getAmazonBrowser()
  const page = await b.newPage()
  const category = await grabSources(page, CATEGORY, 'categoria')
  const general = await grabSources(page, GENERAL, 'geral')
  await page.close().catch(() => {})

  // tece 2 de categoria pra 1 geral (vies parcial)
  const out: string[] = []
  const seen = new Set<string>()
  let ci = 0
  let gi = 0
  const push = (u?: string): boolean => {
    if (!u) return false
    const id = asin(u)
    if (!id || exclude.has(id) || seen.has(id)) return false
    seen.add(id)
    out.push(u)
    return out.length >= limit
  }
  while (out.length < limit && (ci < category.length || gi < general.length)) {
    if (push(category[ci++])) break
    if (push(category[ci++])) break
    if (push(general[gi++])) break
  }
  return out
}

/** Le titulo/imagem/preco da pagina do produto Amazon. */
const DETAILS_JS = `(() => {
  const q = (s) => document.querySelector(s);
  const title = (q('#productTitle') && q('#productTitle').textContent.trim())
    || (q('meta[property="og:title"]') && q('meta[property="og:title"]').content) || '';
  const img = (q('#landingImage') && (q('#landingImage').src || q('#landingImage').getAttribute('data-old-hires')))
    || (q('meta[property="og:image"]') && q('meta[property="og:image"]').content) || '';
  const priceEl = q('#corePrice_feature_div .a-offscreen')
    || q('#corePriceDisplay_desktop_feature_div .a-offscreen')
    || q('.a-price .a-offscreen');
  const price = priceEl ? priceEl.textContent.trim() : '';
  // preco cheio (lista, riscado), se houver promo
  const oldEl = q('.basisPrice .a-offscreen')
    || q('span.a-price.a-text-price[data-a-strike="true"] .a-offscreen')
    || q('.a-text-price .a-offscreen');
  const oldPrice = oldEl ? oldEl.textContent.trim() : '';
  // trilha de categoria (breadcrumb) — usada pra filtrar filme/livro/cd
  const dept = Array.from(document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a'))
    .map((a) => a.textContent.trim()).join(' > ');
  return { title, img, price, oldPrice, dept };
})()`

function normPrice(s: string): string {
  return (s || '').trim().replace(/^R\$\s*/, 'R$ ') // padroniza "R$ 199,90"
}

async function grabDetails(page: Page, url: string): Promise<{ title: string; image: string; price: string; oldPrice: string; dept: string }> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForSelector('#productTitle, .a-price .a-offscreen', { timeout: 12_000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 400))
    const d = (await page.evaluate(DETAILS_JS)) as { title: string; img: string; price: string; oldPrice: string; dept: string }
    return {
      title: (d.title || '').trim(),
      image: (d.img || '').trim(),
      price: normPrice(d.price),
      oldPrice: normPrice(d.oldPrice),
      dept: (d.dept || '').trim(),
    }
  } catch (e) {
    console.warn('[amazon] detalhe falhou em', url, '-', (e as Error).message)
    return { title: '', image: '', price: '', oldPrice: '', dept: '' }
  }
}

// categorias/formatos que ninguem compra no grupo — filme, livro, musica
const BLOCK_DEPT = /filme|s[ée]ries|livro|música|musica|cd e vinil|games|e-?book|kindle/i
const BLOCK_TITLE = /\b(blu-?ray|dvd|4k\s*uhd|4k\s*ultra\s*hd|\[blu-ray\]|box set|vinil|lp)\b/i

/** True se produto for filme/livro/cd — categorias que nao vendem no grupo. */
function isBlocked(title: string, dept: string): boolean {
  if (dept && BLOCK_DEPT.test(dept)) return true
  if (BLOCK_TITLE.test(title)) return true
  return false
}

/**
 * Pipeline: pra cada URL, monta o link de afiliado (instantaneo, so tag) e le
 * titulo/foto/preco da pagina. Browser fica quente (nao fecha por batch).
 */
export async function buildAmazonPromos(productUrls: string[]): Promise<Promo[]> {
  const b = await getAmazonBrowser()
  const page = await b.newPage()
  const out: Promo[] = []
  for (const productUrl of productUrls) {
    const link = amazonLink(productUrl)
    if (!link) {
      console.warn('[amazon] sem ASIN/tag, pula:', productUrl)
      continue
    }
    const { dept, ...details } = await grabDetails(page, productUrl)
    if (isBlocked(details.title, dept)) {
      console.log(`[amazon pula] filme/livro/cd: ${details.title || productUrl} (${dept})`)
      continue
    }
    out.push({ productUrl, link, ...details })
    console.log(`[amazon ok] ${details.title || productUrl} ${details.price} -> ${link}`)
    await new Promise((r) => setTimeout(r, 1000))
  }
  await page.close().catch(() => {})
  return out
}
