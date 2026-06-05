import { config } from './config.js'
import { formatMessage, type Item } from './products.js'
import { MessageMedia, type WAClient } from './wa.js'

function requireGroup(): void {
  if (!config.groupId) {
    throw new Error('WHATSAPP_GROUP_ID vazio no .env. Rode `npm run groups` e cole o id ...@g.us')
  }
}

/** Estado da conexao (so loga). */
export async function checkConnection(client: WAClient): Promise<string> {
  const state = await client.getState().catch(() => null)
  console.log('Estado conexao WhatsApp:', state ?? 'desconhecido')
  return state ?? 'unknown'
}

/** Envia texto pro grupo. */
export async function sendText(client: WAClient, text: string) {
  requireGroup()
  return client.sendMessage(config.groupId, text)
}

/** Envia imagem (por URL) com legenda pro grupo. */
export async function sendImage(client: WAClient, imageUrl: string, caption: string) {
  requireGroup()
  const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true })
  return client.sendMessage(config.groupId, media, { caption })
}

/** Envia um item: foto+legenda se houver imagem, senao texto puro. */
export async function sendItem(client: WAClient, item: Item) {
  const text = formatMessage(item)
  const image = item.image?.trim() || null
  if (image) {
    try {
      return await sendImage(client, image, text)
    } catch (e) {
      console.warn('[wa] falha na imagem, manda so texto:', (e as Error).message)
    }
  }
  return sendText(client, text)
}

/** Lista grupos (pra descobrir o id ...@g.us). */
export async function listGroups(client: WAClient) {
  const chats = await client.getChats()
  return chats
    .filter((c) => c.isGroup)
    .map((c) => ({ id: c.id._serialized, subject: c.name }))
}
