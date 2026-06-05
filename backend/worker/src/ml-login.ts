import { config } from './config.js'
import { openLinkBuilder, closeMlBrowser } from './ml.js'

/**
 * Login do Portal do Afiliado ML (1x por maquina). Abre o Chrome VISIVEL,
 * espera voce logar na sua conta de afiliado e, quando o LinkBuilder aparecer
 * logado (campo #url-0), salva a sessao em .ml_auth e encerra limpo.
 * Depois disso o worker gera links sozinho (pode ate rodar com ML_HEADLESS=true).
 */
async function main(): Promise<void> {
  config.mlHeadless = false // login PRECISA da janela visivel, ignora o .env aqui

  console.log('=== Login Mercado Livre (Portal do Afiliado) ===')
  console.log('Vai abrir o Chrome. Faca login na SUA conta de afiliado do ML.')
  console.log('Quando o LinkBuilder carregar logado, salvo a sessao e encerro sozinho.')
  console.log('(timeout: 5 min — se passar, e so rodar de novo)\n')

  const page = await openLinkBuilder()

  const TIMEOUT_MS = 5 * 60_000
  const startedAt = Date.now()
  let logged = false
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const el = await page.$('#url-0').catch(() => null) // campo so existe logado
    if (el) { logged = true; break }
    await new Promise((r) => setTimeout(r, 2000))
  }

  if (logged) {
    console.log('\n✅ Logado! Sessao salva em .ml_auth. Pode rodar `npm start`.')
  } else {
    console.log('\n⏱️ Nao detectei o login no tempo. Rode `npm run ml-login` de novo.')
  }
  await closeMlBrowser() // fecha limpo = cookies vao pro disco
  process.exit(logged ? 0 : 1)
}

void main().catch((e) => {
  console.error('Erro no login do ML:', (e as Error).message)
  process.exit(1)
})
