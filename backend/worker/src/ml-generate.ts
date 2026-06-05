import fs from 'node:fs'
import path from 'node:path'
import { getMlBrowser, openLinkBuilder, closeMlBrowser } from './ml.js'
import { config } from './config.js'

/**
 * DESCOBERTA da Fase 1: preenche o LinkBuilder com uma URL de produto, clica
 * "Gerar" e despeja onde o link de afiliado aparece (pra eu achar o seletor).
 * Uso: npm run ml-generate -- "https://www.mercadolivre.com.br/..../p/MLB..."
 * Sem URL: pega um produto da pagina de mais vendidos.
 */

const GRAB_PRODUCT_JS = `(() => {
  const a = Array.from(document.querySelectorAll('a')).map(x => x.href).filter(h => /mercadolivre\\.com\\.br\\/.*(\\/p\\/MLB|MLB-)/i.test(h));
  return a[0] || '';
})()`

const DUMP_RESULT_JS = `(() => {
  const hits = [];
  document.querySelectorAll('a,input,textarea,span,div,button').forEach(el => {
    const href = (el.href || '').toString();
    const val = (el.value || '').toString();
    const txt = (el.textContent || '').trim();
    if (/meli\\.la|\\/sec\\/|matt_tool|matt_word/i.test(href + ' ' + val) || /meli\\.la|\\/sec\\//i.test(txt)) {
      hits.push({ tag: el.tagName, id: el.id || '', cls: (el.className || '').toString().slice(0,70), href: href.slice(0,140), val: val.slice(0,140), txt: txt.slice(0,140) });
    }
  });
  const copy = Array.from(document.querySelectorAll('button,a')).filter(e => /copiar|copy/i.test(e.textContent || '')).map(e => ({ id: e.id || '', cls: (e.className||'').toString().slice(0,70), txt: (e.textContent||'').trim().slice(0,30) }));
  return { count: hits.length, hits, copy };
})()`

async function main() {
  let productUrl = process.argv[2] || ''
  const browser = await getMlBrowser()
  const page = await openLinkBuilder()

  if (!productUrl) {
    console.log('Sem URL passada — pegando um produto de mais-vendidos...')
    const grab = await browser.newPage()
    await grab.goto('https://www.mercadolivre.com.br/mais-vendidos', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 3000))
    productUrl = (await grab.evaluate(GRAB_PRODUCT_JS)) as string
    await grab.close()
    if (!productUrl) {
      console.log('Nao consegui pegar URL automaticamente. Passe uma: npm run ml-generate -- "URL"')
      await closeMlBrowser()
      process.exit(1)
    }
  }
  console.log('Produto:', productUrl)

  // preenche o campo de URL (textarea#url-0) e dispara o React
  await page.waitForSelector('#url-0', { timeout: 30_000 })
  await page.click('#url-0')
  await page.type('#url-0', productUrl, { delay: 15 })
  await new Promise((r) => setTimeout(r, 800))

  // espera o botao Gerar habilitar e clica
  console.log('Clicando Gerar...')
  await page.waitForSelector('button.links-form__button:not(.andes-button--disabled)', { timeout: 15_000 }).catch(() => {})
  await page.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button.links-form__button, button'));
    const b = btns.find(x => /gerar/i.test((x.textContent||'').trim()));
    if (b) b.click();
  })()`)

  // espera o link aparecer
  type Result = { count: number; hits: unknown[]; copy: unknown[] }
  let result: Result | null = null
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    result = (await page.evaluate(DUMP_RESULT_JS)) as Result
    console.log(`[${i}] hits=${result.count} copy=${result.copy.length}`)
    if (result.count > 0) break
  }

  const out = path.join(config.dataDir, '..', 'ml-generate.json')
  fs.writeFileSync(out, JSON.stringify({ productUrl, result }, null, 2))
  console.log('Despejado em', out)

  await closeMlBrowser()
  process.exit(0)
}

main().catch((e) => {
  console.error('erro:', (e as Error).message)
  process.exit(1)
})
