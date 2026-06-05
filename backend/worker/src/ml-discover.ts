import { discoverProductUrls } from './discovery.js'
import { closeMlBrowser } from './ml.js'

/** Teste de descoberta. Uso: npm run ml-discover -- 20 */
async function main() {
  const n = Number(process.argv[2] || 20)
  const urls = await discoverProductUrls(n)
  console.log(`\n${urls.length} produtos descobertos:`)
  urls.forEach((u, i) => console.log(`${i + 1}. ${u}`))
  await closeMlBrowser()
  process.exit(0)
}

main().catch((e) => {
  console.error('erro:', (e as Error).message)
  process.exit(1)
})
