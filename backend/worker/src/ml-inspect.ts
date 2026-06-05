import fs from 'node:fs'
import path from 'node:path'
import { getMlBrowser, openLinkBuilder, closeMlBrowser } from './ml.js'
import { config } from './config.js'

/**
 * Abre o LinkBuilder headful. Espera voce logar. Quando aparecer o campo de
 * URL, despeja a estrutura da pagina (inputs/botoes/seletores) num arquivo
 * pra eu automatizar o "colar URL > Gerar > pegar link".
 */

// evaluate como STRING (evita o helper __name do tsx/esbuild no contexto do browser)
const DUMP_JS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = Array.from(document.querySelectorAll('input,textarea')).map((el) => ({
    tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '', id: el.id || '',
    placeholder: el.placeholder || '', cls: el.className || '', visible: vis(el),
  }));
  const buttons = Array.from(document.querySelectorAll('button,a[role="button"],[type="submit"]')).map((el) => ({
    tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 40),
    id: el.id || '', cls: el.className || '', visible: vis(el),
  }));
  return { url: location.href, title: document.title, inputs, buttons };
})()`

type Info = {
  url: string; title: string
  inputs: { tag: string; type: string; name: string; id: string; placeholder: string; cls: string; visible: boolean }[]
  buttons: { tag: string; text: string; id: string; cls: string; visible: boolean }[]
}

async function main() {
  console.log('Abrindo Portal do Afiliado... loga na janela que abrir.')
  await openLinkBuilder()
  const browser = await getMlBrowser()

  const deadline = Date.now() + 300_000
  let dumped = false
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000))

    // re-acha a aba certa todo ciclo (login abre/fecha abas; frames detacham)
    let info: Info | null = null
    try {
      const pages = await browser.pages()
      const cands = []
      for (const p of pages) {
        const u = p.url()
        if (!u || u === 'about:blank') continue
        cands.push(p)
      }
      // prioridade: linkbuilder > afiliados > qualquer mercadolivre
      const pick =
        cands.find((p) => /linkbuilder/i.test(p.url())) ??
        cands.find((p) => /afiliados/i.test(p.url())) ??
        cands.find((p) => /mercadolivre|mercadolibre/i.test(p.url())) ??
        cands[0]
      if (!pick) continue
      info = (await pick.evaluate(DUMP_JS)) as Info
    } catch (e) {
      console.log(`[skip] ${(e as Error).message.slice(0, 60)}`) // navegando/detached -> tenta de novo
      continue
    }
    if (!info) continue

    const onLogin = /\/login|\/lgz\/|\/registration/i.test(info.url)
    const hasUrlField = info.inputs.some(
      (i) => i.visible && /url|link|produto/i.test(`${i.placeholder} ${i.name} ${i.id} ${i.cls}`),
    )
    const onLinkBuilder = /linkbuilder/i.test(info.url)
    const ready = !onLogin && (hasUrlField || (onLinkBuilder && info.inputs.length > 0))
    console.log(`[${new Date().toISOString()}] url=${info.url.slice(0, 80)} | inputs=${info.inputs.length} btn=${info.buttons.length} | login=${onLogin} campoURL=${hasUrlField} pronto=${ready}`)

    if (ready) {
      const out = path.join(config.dataDir, '..', 'ml-inspect.json')
      fs.writeFileSync(out, JSON.stringify(info, null, 2))
      dumped = true
      console.log(`\nDespejado em ${out}.`)
      break
    }
  }

  if (!dumped) console.log('Timeout sem achar o LinkBuilder. Confirme que logou e chegou no gerador.')
  await closeMlBrowser()
  process.exit(0)
}

main().catch((e) => {
  console.error('erro:', (e as Error).message)
  process.exit(1)
})
