import fs from 'node:fs'
import path from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer'
import { config } from './config.js'
import { resolveChrome } from './chrome.js'

const AFFILIATE_HOME = 'https://www.mercadolivre.com.br/afiliados/linkbuilder'

let browser: Browser | null = null
let lbPage: Page | null = null

/**
 * Remove locks de Singleton orfaos no perfil. Se o processo anterior morreu
 * sem fechar limpo (kill no Windows nao dispara shutdown), o lock fica e o
 * chrome recusa "profile in use". Limpa antes de subir.
 */
function clearStaleLocks(dir: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('Singleton')) fs.rmSync(path.join(dir, f), { force: true })
    }
  } catch {
    /* dir nao existe ainda = 1a vez, ok */
  }
}

/** Sobe (ou reusa) o navegador do Portal do Afiliado. Sessao persiste em disco. */
export async function getMlBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser
  clearStaleLocks(config.mlSessionDir)
  browser = await puppeteer.launch({
    headless: config.mlHeadless,
    userDataDir: config.mlSessionDir,
    executablePath: resolveChrome(),
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  return browser
}

/**
 * Abre o LinkBuilder numa UNICA aba dedicada. Se o ML abriu abas de login/redirect
 * (acontece quando a sessao expira), fecha as sobrando pra nao navegar a aba errada.
 */
export async function openLinkBuilder(): Promise<Page> {
  const b = await getMlBrowser()
  const pages = await b.pages()
  if (!lbPage || lbPage.isClosed()) {
    lbPage = pages.find((p) => !p.isClosed()) ?? (await b.newPage())
  }
  // mata abas extras (about:blank, popups de login) — sobra so a dedicada
  for (const p of pages) {
    if (p !== lbPage && !p.isClosed()) await p.close().catch(() => {})
  }
  await lbPage.goto(AFFILIATE_HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  return lbPage
}

export async function closeMlBrowser(): Promise<void> {
  lbPage = null
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
}
