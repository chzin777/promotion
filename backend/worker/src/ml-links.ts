import fs from 'node:fs'
import path from 'node:path'
import { getMlBrowser } from './ml.js'
import { buildPromos } from './affiliate.js'
import { config } from './config.js'

/**
 * Teste Fase 1 + prototipo de descoberta: pega N produtos de mais-vendidos e
 * gera o link de afiliado de cada. Uso: npm run ml-links -- 3
 */

const GRAB_MANY_JS = `(() => {
  const set = new Set();
  document.querySelectorAll('a').forEach(a => {
    const h = (a.href || '').split('#')[0].split('?')[0];
    if (/mercadolivre\\.com\\.br\\/.*\\/p\\/MLB\\d+/i.test(h)) set.add(h);
  });
  return Array.from(set);
})()`

async function main() {
  const n = Number(process.argv[2] || 3)
  const browser = await getMlBrowser()
  const p = await browser.newPage()
  console.log('Pegando produtos de mais-vendidos...')
  await p.goto('https://www.mercadolivre.com.br/mais-vendidos', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 3000))
  const urls = ((await p.evaluate(GRAB_MANY_JS)) as string[]).slice(0, n)
  await p.close()
  console.log(`${urls.length} produtos:`)
  urls.forEach((u) => console.log(' -', u))

  if (!urls.length) {
    console.log('Nenhum produto encontrado.')
    process.exit(1)
  }

  console.log('\nGerando promos (dados + link)...\n')
  const res = await buildPromos(urls)

  const out = path.join(config.dataDir, '..', 'ml-links.json')
  fs.writeFileSync(out, JSON.stringify(res, null, 2))
  const ok = res.filter((r) => r.link).length
  console.log(`\n${ok}/${res.length} links gerados. Salvo em ${out}`)
  process.exit(0)
}

main().catch((e) => {
  console.error('erro:', (e as Error).message)
  process.exit(1)
})
