import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  // transporte = whatsapp-web.js (navegador real). Sessao fica em disco e persiste.
  instance: process.env.WA_CLIENT_ID?.trim() || 'promotion',
  sessionDir: process.env.WA_SESSION_DIR?.trim() || path.join(__dirname, '..', '.wwebjs_auth'),
  // opcional no startup (o comando `groups` roda sem ele). Validado antes de enviar.
  groupId: process.env.WHATSAPP_GROUP_ID?.trim() ?? '',
  intervalMin: Number(process.env.SEND_INTERVAL_MINUTES ?? 30),
  // pool de intervalos (min) sorteado a cada envio pra variar o ritmo.
  // Ex: "11,7,15". Vazio = usa intervalMin fixo.
  intervalPoolMin: (process.env.SEND_INTERVAL_MINUTES_POOL?.trim() || '11,7,15')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),
  activeStart: Number(process.env.ACTIVE_HOURS_START ?? 0),
  activeEnd: Number(process.env.ACTIVE_HOURS_END ?? 24),
  // pasta com produtos.xlsx / arquivos diarios
  dataDir: process.env.DATA_DIR?.trim() || path.join(__dirname, '..', 'data'),
  // navegador do Portal do Afiliado ML (sessao separada do WhatsApp)
  mlSessionDir: process.env.ML_SESSION_DIR?.trim() || path.join(__dirname, '..', '.ml_auth'),
  mlHeadless: process.env.ML_HEADLESS?.trim() === 'true', // default false: abre janela pra logar
  // descoberta automatica: 2x por dia (manha + tarde), N produtos por vez
  feedCount: Number(process.env.FEED_COUNT ?? 20),
  feedAmHour: Number(process.env.FEED_AM_HOUR ?? 8),
  feedPmHour: Number(process.env.FEED_PM_HOUR ?? 14),
  // === Amazon (afiliado por tag na URL, sem login) ===
  // tag de afiliado (xxxxx-20). Vazio = nao posta Amazon.
  amazonTag: process.env.AMAZON_TAG?.trim() || '',
  amazonSessionDir: process.env.AMAZON_SESSION_DIR?.trim() || path.join(__dirname, '..', '.amazon_session'),
  amazonHeadless: process.env.AMAZON_HEADLESS?.trim() !== 'false', // default true: Amazon nao precisa logar
  amazonFeedCount: Number(process.env.AMAZON_FEED_COUNT ?? 10),
}
