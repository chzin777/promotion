import { formatMessage, type Item } from './products.js'
import { getGroupId } from './settings.js'
import { MessageMedia, type WAClient } from './wa.js'

/** Grupo de destino: painel (settings.json) com fallback .env. Lanca se vazio. */
function requireGroup(): string {
  const id = getGroupId()
  if (!id) {
    throw new Error('Grupo vazio. Defina no painel ou em WHATSAPP_GROUP_ID no .env (id ...@g.us)')
  }
  return id
}

/** Estado da conexao (so loga). */
export async function checkConnection(client: WAClient): Promise<string> {
  const state = await client.getState().catch(() => null)
  console.log('Estado conexao WhatsApp:', state ?? 'desconhecido')
  return state ?? 'unknown'
}

/** Envia texto pro grupo. */
export async function sendText(client: WAClient, text: string) {
  const groupId = requireGroup()
  return client.sendMessage(groupId, text)
}

/** Envia imagem (por URL) com legenda pro grupo. */
export async function sendImage(client: WAClient, imageUrl: string, caption: string) {
  const groupId = requireGroup()
  const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true })
  return client.sendMessage(groupId, media, { caption })
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
