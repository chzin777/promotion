import { runFeed } from './feeder.js'
import { loadItems } from './products.js'

/** Teste do feeder: descobre+gera+enfileira N. Uso: npm run feed -- 3 */
async function main() {
  const n = Number(process.argv[2] || 3)
  const added = await runFeed(n)
  console.log(`\n>>> ${added} promos novas na fila.`)
  const items = loadItems()
  console.log(`Fila total agora: ${items.length} itens.`)
  items.slice(-n).forEach((it) => console.log(` - ${it.price || '?'} | ${it.title?.slice(0, 50) || it.link} -> ${it.link}`))
  process.exit(0)
}

main().catch((e) => {
  console.error('erro:', (e as Error).message)
  process.exit(1)
})
