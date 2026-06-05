import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import type { Item } from './products.js'

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

/** Adiciona itens novos na fila, dedupando por link. */
export function appendQueue(items: Item[]): number {
  const cur = readQueue()
  const seen = new Set(cur.map((i) => i.link))
  const add = items.filter((i) => i.link && !seen.has(i.link))
  if (add.length) {
    fs.mkdirSync(path.dirname(queueFile), { recursive: true })
    fs.writeFileSync(queueFile, JSON.stringify([...cur, ...add], null, 2))
  }
  return add.length
}
