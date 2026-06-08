import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import type { Item } from './products.js'
import { linkKey, productKey, readState, wasSent } from './state.js'

const queueFile = path.join(config.dataDir, 'auto-queue.json')

/** Fila de promos geradas automaticamente (descoberta -> link afiliado). */
export function readQueue(): Item[] {
  try {
    const data = JSON.parse(fs.readFileSync(queueFile, 'utf8'))
    return Array.isArray(data) ? (data as Item[]) : []
  } catch {
    return []
  }
}

/** Remove da fila automatica itens ja enviados. */
export function pruneQueue(): void {
  const state = readState()
  const cur = readQueue()
  const kept = cur.filter((i) => !wasSent(i, state))
  if (kept.length === cur.length) return
  fs.mkdirSync(path.dirname(queueFile), { recursive: true })
  fs.writeFileSync(queueFile, JSON.stringify(kept, null, 2))
}

/** Adiciona itens novos na fila, dedupando por link, produto e historico de envio. */
export function appendQueue(items: Item[]): number {
  const state = readState()
  const cur = readQueue()
  const seenLinks = new Set(cur.map((i) => linkKey(i.link)))
  const seenProducts = new Set(cur.map((i) => productKey(i.link, i.productUrl)))
  const add = items.filter((i) => {
    if (!i.link?.trim()) return false
    if (wasSent(i, state)) return false
    const lk = linkKey(i.link)
    const pk = productKey(i.link, i.productUrl)
    if (seenLinks.has(lk) || seenProducts.has(pk)) return false
    seenLinks.add(lk)
    seenProducts.add(pk)
    return true
  })
  if (add.length) {
    fs.mkdirSync(path.dirname(queueFile), { recursive: true })
    fs.writeFileSync(queueFile, JSON.stringify([...cur, ...add], null, 2))
  }
  return add.length
}
