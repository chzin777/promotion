import fs from 'node:fs'
import path from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer'
import { config } from './config.js'
import type { Promo } from './affiliate.js'

const BESTSELLERS = 'https://www.amazon.com.br/bestsellers'
const DEALS = 'https://www.amazon.com.br/deals'

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
  if (!id || !config.amazonTag) return ''
  return `https://www.amazon.com.br/dp/${id}?tag=${config.amazonTag}`
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

/** Descobre URLs de produto (mais vendidos + ofertas), dedupa por ASIN. */
export async function discoverAmazonUrls(limit: number, exclude: Set<string> = new Set()): Promise<string[]> {
  if (!config.amazonTag) return [] // sem tag, nao adianta
  const b = await getAmazonBrowser()
  const page = await b.newPage()

  const vendidos = await grabFrom(page, BESTSELLERS, 5)
  console.log(`[amazon] mais-vendidos: ${vendidos.length} produtos`)
  const ofertas = await grabFrom(page, DEALS, 5)
  console.log(`[amazon] ofertas: ${ofertas.length} produtos`)
  await page.close().catch(() => {})

  // intercala as duas fontes
  const merged: string[] = []
  const max = Math.max(vendidos.length, ofertas.length)
  for (let i = 0; i < max; i++) {
    if (vendidos[i]) merged.push(vendidos[i])
    if (ofertas[i]) merged.push(ofertas[i])
  }

  const out: string[] = []
  const seen = new Set<string>()
  for (const u of merged) {
    const id = asin(u)
    if (!id || exclude.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(u)
    if (out.length >= limit) break
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
  return { title, img, price };
})()`

async function grabDetails(page: Page, url: string): Promise<{ title: string; image: string; price: string }> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForSelector('#productTitle, .a-price .a-offscreen', { timeout: 12_000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 400))
    const d = (await page.evaluate(DETAILS_JS)) as { title: string; img: string; price: string }
    return {
      title: (d.title || '').trim(),
      image: (d.img || '').trim(),
      price: (d.price || '').trim().replace(/^R\$\s*/, 'R$ '), // padroniza "R$ 199,90"
    }
  } catch (e) {
    console.warn('[amazon] detalhe falhou em', url, '-', (e as Error).message)
    return { title: '', image: '', price: '' }
  }
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
    const details = await grabDetails(page, productUrl)
    out.push({ productUrl, link, ...details })
    console.log(`[amazon ok] ${details.title || productUrl} ${details.price} -> ${link}`)
    await new Promise((r) => setTimeout(r, 1000))
  }
  await page.close().catch(() => {})
  return out
}
