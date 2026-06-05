import path from 'node:path'
import pkg from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import QRCode from 'qrcode'
import { config } from './config.js'

const { Client, LocalAuth, MessageMedia } = pkg
export type WAClient = InstanceType<typeof Client>
export { MessageMedia }

/**
 * Sobe o cliente whatsapp-web.js (WhatsApp Web de verdade, headless).
 * Resolve quando estiver 'ready'. Mostra QR no terminal no 1o uso; depois a
 * sessao fica salva em config.sessionDir e reconecta sozinho.
 */
export function startClient(): Promise<WAClient> {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: config.instance, dataPath: config.sessionDir }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  })

  const qrPng = path.join(config.sessionDir, '..', 'qr-wa.png')
  client.on('qr', (qr: string) => {
    console.log('\n📱 Escaneie o QR no WhatsApp (Aparelhos conectados > Conectar):\n')
    qrcode.generate(qr, { small: true })
    QRCode.toFile(qrPng, qr, { width: 400 }).then(
      () => console.log(`QR tambem salvo em ${qrPng}`),
      (e: Error) => console.warn('[wa] nao salvou PNG do QR:', e.message),
    )
  })
  client.on('auth_failure', (m: string) => console.error('[wa] auth_failure:', m))
  client.on('disconnected', (r: string) => console.warn('[wa] desconectado:', r))

  return new Promise<WAClient>((resolve, reject) => {
    client.once('ready', () => {
      console.log('[wa] conectado e pronto.')
      resolve(client)
    })
    client.initialize().catch(reject)
  })
}
