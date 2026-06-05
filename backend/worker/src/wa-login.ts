import { startClient } from './wa.js'

/**
 * Login do WhatsApp (1x por maquina). Mostra o QR no terminal, espera voce
 * escanear e, assim que conectar, salva a sessao em .wwebjs_auth e encerra.
 * Depois disso o `npm start` reconecta sozinho sem QR.
 */
async function main(): Promise<void> {
  console.log('=== Login WhatsApp ===')
  console.log('Escaneie o QR abaixo no app: Aparelhos conectados > Conectar um aparelho.')
  console.log('Assim que conectar, a sessao e salva e isto encerra sozinho.\n')

  const client = await startClient() // resolve no evento "ready" (apos escanear)
  console.log('\n✅ WhatsApp conectado. Sessao salva em .wwebjs_auth. Pode rodar `npm start`.')
  await client.destroy().catch(() => {})
  process.exit(0)
}

void main().catch((e) => {
  console.error('Erro no login do WhatsApp:', (e as Error).message)
  process.exit(1)
})
