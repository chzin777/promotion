import type { Page } from 'puppeteer'
import { getMlBrowser } from './ml.js'

/** Coleta URLs canonicas de produto (/p/MLB...) visiveis na pagina. */
const GRAB_JS = `(() => {
  const set = new Set();
  document.querySelectorAll('a').forEach(a => {
    const h = (a.href || '').split('#')[0].split('?')[0];
    const m = h.match(/^https:\\/\\/www\\.mercadolivre\\.com\\.br\\/.*\\/p\\/MLB\\d+/i);
    if (m) set.add(m[0]);
  });
  return Array.from(set);
})()`

/** id MLB do produto (pra dedupe). */
export function productId(url: string): string {
  const m = url.match(/\/p\/(MLB\d+)/i)
  return m ? m[1].toUpperCase() : url
}

async function grabFrom(page: Page, url: string, scrolls = 4): Promise<string[]> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    // rola pra carregar lazy-load
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate('window.scrollBy(0, document.body.scrollHeight)')
      await new Promise((r) => setTimeout(r, 1200))
    }
    return (await page.evaluate(GRAB_JS)) as string[]
  } catch (e) {
    console.warn('[discovery] falha em', url, '-', (e as Error).message)
    return []
  }
}

/**
 * Descobre URLs de produto das ofertas do dia + mais vendidos.
 * Intercala as duas fontes e dedupa por id MLB. `exclude` = ids ja vistos.
 */
export async function discoverProductUrls(limit: number, exclude: Set<string> = new Set()): Promise<string[]> {
  const browser = await getMlBrowser()
  const page = await browser.newPage()

  const ofertas = await grabFrom(page, 'https://www.mercadolivre.com.br/ofertas', 6)
  console.log(`[discovery] ofertas: ${ofertas.length} produtos`)
  const vendidos = await grabFrom(page, 'https://www.mercadolivre.com.br/mais-vendidos', 4)
  console.log(`[discovery] mais-vendidos: ${vendidos.length} produtos`)
  await page.close()

  // intercala (oferta, vendido, oferta, ...) pra variar
  const merged: string[] = []
  const max = Math.max(ofertas.length, vendidos.length)
  for (let i = 0; i < max; i++) {
    if (ofertas[i]) merged.push(ofertas[i])
    if (vendidos[i]) merged.push(vendidos[i])
  }

  const out: string[] = []
  const seenIds = new Set<string>()
  for (const u of merged) {
    const id = productId(u)
    if (exclude.has(id) || seenIds.has(id)) continue
    seenIds.add(id)
    out.push(u)
    if (out.length >= limit) break
  }
  return out
}
