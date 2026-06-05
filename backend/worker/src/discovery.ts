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

// fontes gerais
const GENERAL = [
  'https://www.mercadolivre.com.br/ofertas',
  'https://www.mercadolivre.com.br/mais-vendidos',
]
// mais-vendidos por categoria (vies pra utilidades). So renderiza logado.
// Obs: a categoria de moda (MLB1430) nao expoe /p/ nem logada -> roupas/tenis
// ficam por conta da Amazon (bestsellers/fashion). Casa/utilidades funciona:
const CATEGORY = [
  'https://www.mercadolivre.com.br/mais-vendidos/MLB1574', // Casa, Moveis e Decoracao
]

/**
 * Descobre URLs de produto. Mistura fontes gerais (ofertas + mais vendidos)
 * com mais-vendidos de categoria (roupas/tenis/utilidades), tecendo ~1:1 pra
 * dar um leve vies sem virar foco exclusivo. Dedupa por id MLB.
 */
export async function discoverProductUrls(limit: number, exclude: Set<string> = new Set()): Promise<string[]> {
  const browser = await getMlBrowser()
  const page = await browser.newPage()

  const category: string[] = []
  for (const u of CATEGORY) {
    const found = await grabFrom(page, u, 4)
    console.log(`[discovery] categoria ${u.split('/').pop()}: ${found.length} produtos`)
    category.push(...found)
  }
  const general: string[] = []
  for (const u of GENERAL) {
    const found = await grabFrom(page, u, u.endsWith('ofertas') ? 6 : 4)
    console.log(`[discovery] geral ${u.split('/').pop()}: ${found.length} produtos`)
    general.push(...found)
  }
  await page.close()

  // tece 1 categoria : 1 geral (vies leve)
  const out: string[] = []
  const seenIds = new Set<string>()
  let ci = 0
  let gi = 0
  const push = (u?: string): boolean => {
    if (!u) return false
    const id = productId(u)
    if (exclude.has(id) || seenIds.has(id)) return false
    seenIds.add(id)
    out.push(u)
    return out.length >= limit
  }
  while (out.length < limit && (ci < category.length || gi < general.length)) {
    if (push(category[ci++])) break
    if (push(general[gi++])) break
  }
  return out
}
