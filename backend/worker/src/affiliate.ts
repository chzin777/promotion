import type { Page } from 'puppeteer'
import { getMlBrowser, openLinkBuilder } from './ml.js'

/** Conta quantos links ja foram gerados na pagina (textareas de resultado). */
const COUNT_RESULTS_JS = `document.querySelectorAll('.copy-link__textfield textarea').length`

/** Pega o valor do ultimo link gerado (meli.la). */
const LAST_LINK_JS = `(() => {
  const els = Array.from(document.querySelectorAll('.copy-link__textfield textarea'));
  const last = els[els.length - 1];
  return last ? (last.value || last.textContent || '').trim() : '';
})()`

/** Clica o botao "Gerar". */
const CLICK_GERAR_JS = `(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => /^gerar$/i.test((x.textContent||'').trim()));
  if (b) { b.click(); return true; }
  return false;
})()`

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Le titulo/imagem/preco da pagina RENDERIZADA do produto (axios pega shell vazio). */
const DETAILS_JS = `(() => {
  const q = (s) => document.querySelector(s);
  const title = (q('h1.ui-pdp-title') && q('h1.ui-pdp-title').textContent.trim())
    || (q('meta[property="og:title"]') && q('meta[property="og:title"]').content) || '';
  const img = (q('meta[property="og:image"]') && q('meta[property="og:image"]').content)
    || (q('figure.ui-pdp-gallery__figure img') && q('figure.ui-pdp-gallery__figure img').src) || '';
  // le um elemento andes-money-amount -> "199,90"
  const money = (el) => {
    if (!el) return '';
    const f = el.querySelector('.andes-money-amount__fraction');
    const c = el.querySelector('.andes-money-amount__cents');
    if (!f) return '';
    return f.textContent.trim() + (c ? ',' + c.textContent.trim() : '');
  };
  // preco atual: 1o money da area de preco
  const scope = q('.ui-pdp-price__second-line') || document;
  const price = money(scope);
  // preco cheio (riscado), se houver promo
  const oldPrice = money(q('.ui-pdp-price__original-value'));
  return { title, img, price, oldPrice };
})()`

export type Promo = { productUrl: string; link: string | null; title: string; image: string; price: string; oldPrice: string }

/** Navega a pagina do produto e le titulo/imagem/preco (atual + cheio) renderizados. */
async function grabDetails(page: Page, productUrl: string): Promise<{ title: string; image: string; price: string; oldPrice: string }> {
  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForSelector('h1.ui-pdp-title, .andes-money-amount__fraction', { timeout: 12_000 }).catch(() => {})
    await delay(500)
    const d = (await page.evaluate(DETAILS_JS)) as { title: string; img: string; price: string; oldPrice: string }
    return {
      title: (d.title || '').trim(),
      image: (d.img || '').trim(),
      price: d.price ? `R$ ${d.price}` : '',
      oldPrice: d.oldPrice ? `R$ ${d.oldPrice}` : '',
    }
  } catch (e) {
    console.warn('[details] falha em', productUrl, '-', (e as Error).message)
    return { title: '', image: '', price: '', oldPrice: '' }
  }
}

/**
 * Pipeline full: pra cada URL de produto, le os dados na pagina renderizada e
 * gera o link de afiliado. Devolve promos prontas (1 navegador, sequencial).
 */
export async function buildPromos(productUrls: string[]): Promise<Promo[]> {
  await getMlBrowser()
  const out: Promo[] = []
  for (const productUrl of productUrls) {
    const page = await openLinkBuilder() // handle da aba (no LinkBuilder)
    const details = await grabDetails(page, productUrl) // navega pro produto
    await openLinkBuilder() // volta a mesma aba pro LinkBuilder
    const link = await generateOne(page, productUrl)
    out.push({ productUrl, link, ...details })
    console.log(link ? `[ok] ${details.title || productUrl} ${details.price} -> ${link}` : `[falhou] ${productUrl}`)
    await delay(1500) // ritmo humano
  }
  // NAO fecha o navegador: sessao do afiliado fica quente, sem relogin a cada batch
  return out
}

/**
 * Gera o link de afiliado de UMA URL de produto, usando a pagina ja no
 * LinkBuilder (logada). Retorna o meli.la ou null se falhar.
 */
export async function generateOne(page: Page, productUrl: string): Promise<string | null> {
  try {
    await page.waitForSelector('#url-0', { timeout: 30_000 })
    await delay(400)
    const before = (await page.evaluate(COUNT_RESULTS_JS)) as number

    // ate 2 tentativas (o React as vezes engole o 1o clique)
    for (let attempt = 0; attempt < 2; attempt++) {
      // limpa o campo de forma garantida
      await page.click('#url-0').catch(() => {})
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyA')
      await page.keyboard.up('Control')
      await page.keyboard.press('Backspace')
      await delay(150)
      await page.type('#url-0', productUrl, { delay: 12 })
      await delay(700)

      // habilita e clica Gerar
      await page.waitForSelector('button.links-form__button:not(.andes-button--disabled)', { timeout: 12_000 }).catch(() => {})
      const clicked = (await page.evaluate(CLICK_GERAR_JS)) as boolean
      if (!clicked) { await delay(800); continue }

      // espera surgir um resultado novo (~14s)
      for (let i = 0; i < 12; i++) {
        await delay(1200)
        const now = (await page.evaluate(COUNT_RESULTS_JS)) as number
        if (now > before) {
          const link = (await page.evaluate(LAST_LINK_JS)) as string
          if (/meli\.la|\/sec\//i.test(link)) return link.trim()
        }
      }
      console.warn(`[affiliate] tentativa ${attempt + 1} sem resultado pra ${productUrl}`)
    }
    return null
  } catch (e) {
    console.warn('[affiliate] erro em', productUrl, '-', (e as Error).message)
    return null
  }
}

/**
 * Gera links de afiliado de varias URLs (1 navegador, sequencial = mais seguro
 * e mapeia url->link sem ambiguidade). Devolve [{url, link}].
 */
export async function generateLinks(productUrls: string[]): Promise<{ url: string; link: string | null }[]> {
  await getMlBrowser()
  const out: { url: string; link: string | null }[] = []
  for (const url of productUrls) {
    const page = await openLinkBuilder() // recarrega = estado limpo por URL
    await delay(800)
    const link = await generateOne(page, url)
    out.push({ url, link })
    console.log(link ? `[ok] ${url}\n      -> ${link}` : `[falhou] ${url}`)
    await delay(1500) // ritmo humano
  }
  // NAO fecha o navegador: sessao do afiliado fica quente, sem relogin a cada batch
  return out
}
