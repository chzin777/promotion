import { formatMessage, type Item } from './products.js'
import { getGroupIds } from './settings.js'
import { MessageMedia, type WAClient } from './wa.js'

/** Grupos de destino: painel (settings.json) com fallback .env. Lanca se vazio. */
function requireGroups(): string[] {
  const ids = getGroupIds()
  if (!ids.length) {
    throw new Error('Nenhum grupo. Defina no painel ou em WHATSAPP_GROUP_ID no .env (id ...@g.us)')
  }
  return ids
}

/** Estado da conexao (so loga). */
export async function checkConnection(client: WAClient): Promise<string> {
  const state = await client.getState().catch(() => null)
  console.log('Estado conexao WhatsApp:', state ?? 'desconhecido')
  return state ?? 'unknown'
}

/** Envia texto pra todos os grupos. */
export async function sendText(client: WAClient, text: string) {
  const groups = requireGroups()
  for (const id of groups) await client.sendMessage(id, text)
}

/** Envia imagem (por URL) com legenda pra todos os grupos. */
export async function sendImage(client: WAClient, imageUrl: string, caption: string) {
  const groups = requireGroups()
  const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true })
  for (const id of groups) await client.sendMessage(id, media, { caption })
}

/**
 * Envia um item pra todos os grupos: foto+legenda se houver imagem, senao texto.
 * A imagem e baixada uma vez e reusada em cada grupo; se falhar, cai pra texto.
 */
export async function sendItem(client: WAClient, item: Item) {
  const groups = requireGroups()
  const text = formatMessage(item)
  const image = item.image?.trim() || null

  let media: InstanceType<typeof MessageMedia> | null = null
  if (image) {
    try {
      media = await MessageMedia.fromUrl(image, { unsafeMime: true })
    } catch (e) {
      console.warn('[wa] falha ao baixar imagem, manda so texto:', (e as Error).message)
    }
  }

  for (const id of groups) {
    if (media) {
      try {
        await client.sendMessage(id, media, { caption: text })
        continue
      } catch (e) {
        console.warn(`[wa] falha na imagem em ${id}, manda so texto:`, (e as Error).message)
      }
    }
    await client.sendMessage(id, text)
  }
}

type GroupChatLike = {
  isGroup: boolean
  archived?: boolean
  name?: string
  id: { _serialized: string }
  participants?: { id?: { _serialized?: string } }[]
}

/**
 * Lista os grupos onde a conta AINDA participa. getChats() devolve o cache
 * inteiro — inclui grupos que voce ja saiu e arquivados. Filtra por:
 *  - e grupo e nao esta arquivado
 *  - seu proprio numero esta na lista de participantes (saiu = removido daqui)
 */
export async function listGroups(client: WAClient) {
  const me = client.info?.wid?._serialized
  const chats = (await client.getChats()) as unknown as GroupChatLike[]
  return chats
    .filter((c) => c.isGroup && !c.archived)
    .filter((c) => {
      if (!me) return true // sem identidade resolvida, nao arrisca esconder tudo
      const parts = c.participants
      if (!Array.isArray(parts) || parts.length === 0) return false // sem metadata = grupo morto/saiu
      return parts.some((p) => p.id?._serialized === me)
    })
    .map((c) => ({ id: c.id._serialized, subject: c.name ?? '' }))
    .sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'))
}
