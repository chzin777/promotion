import fs from 'node:fs'

/**
 * Acha um Chromium pra rodar SEM depender de download do puppeteer.
 * Prioridade:
 *   1. PUPPETEER_EXECUTABLE_PATH (Docker/Linux aponta /usr/bin/chromium)
 *   2. Google Chrome instalado (Windows) — melhor compatibilidade
 *   3. Microsoft Edge (vem em TODO Windows 10/11) — fallback garantido
 *   4. undefined -> deixa o puppeteer achar no cache dele (.cache/puppeteer)
 *
 * Resultado: numa maquina Windows limpa, NAO precisa baixar nada — usa o
 * Chrome ou Edge do sistema. Acaba com "Could not find Chrome" e conflito de versao.
 */
const WIN_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

let cached: string | undefined | null = null // null = ainda nao resolvido

export function resolveChrome(): string | undefined {
  if (cached !== null) return cached
  const env = process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
  if (env && fs.existsSync(env)) return (cached = env)
  if (process.platform === 'win32') {
    for (const p of WIN_CANDIDATES) {
      if (p && fs.existsSync(p)) {
        console.log(`[chrome] usando navegador do sistema: ${p}`)
        return (cached = p)
      }
    }
  }
  cached = undefined // puppeteer tenta o cache proprio
  return cached
}
