import crypto from 'node:crypto'
import axios from 'axios'
import { config } from './config.js'
import type { Promo } from './affiliate.js'

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql'

/**
 * Assina a requisicao da Shopee Affiliate Open API.
 * factor = AppId + Timestamp + Payload + Secret  ->  SHA256 hex.
 * Header: Authorization: SHA256 Credential=<appId>, Timestamp=<ts>, Signature=<sign>
 */
function authHeader(payload: string): { Authorization: string; 'Content-Type': string } {
  const ts = Math.floor(Date.now() / 1000)
  const sign = crypto.createHash('sha256').update(config.shopeeAppId + ts + payload + config.shopeeSecret).digest('hex')
  return {
    Authorization: `SHA256 Credential=${config.shopeeAppId}, Timestamp=${ts}, Signature=${sign}`,
    'Content-Type': 'application/json',
  }
}

type GqlResp<T> = { data?: T; errors?: { message: string }[] }

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const payload = JSON.stringify({ query, variables })
  const { data } = await axios.post<GqlResp<T>>(ENDPOINT, payload, {
    headers: authHeader(payload),
    timeout: 20_000,
  })
  if (data.errors?.length) throw new Error('Shopee API: ' + data.errors.map((e) => e.message).join('; '))
  if (!data.data) throw new Error('Shopee API: resposta sem data')
  return data.data
}

type OfferNode = {
  itemId: number
  shopId: number
  productName: string
  priceMin: string
  priceMax: string
  imageUrl: string
  offerLink: string // link de afiliado pronto
  productLink: string // url canonica (tem shopid/itemid -> dedup estavel)
  priceDiscountRate: number
  sales: number
}

type ProductOfferV2 = {
  productOfferV2: {
    nodes: OfferNode[]
    pageInfo: { page: number; limit: number; hasNextPage: boolean }
  }
}

const OFFER_QUERY = `query Offers($limit: Int, $page: Int, $keyword: String, $sortType: Int) {
  productOfferV2(limit: $limit, page: $page, keyword: $keyword, sortType: $sortType) {
    nodes {
      itemId shopId productName priceMin priceMax imageUrl
      offerLink productLink priceDiscountRate sales
    }
    pageInfo { page limit hasNextPage }
  }
}`

// vieses de busca (mesma pegada do Amazon: roupas/utilidades/casa) + geral
const KEYWORDS = ['', 'cozinha', 'casa', 'tenis', 'fone', 'organizador']

function brPrice(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return ''
  const [int, dec] = n.toFixed(2).split('.')
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

/** Id canonico Shopee pra dedupe: SHP<shopId>_<itemId>. */
export function shopeeId(url: string): string {
  // .../product/<shopid>/<itemid>  ou  ...-i.<shopid>.<itemid>
  const m = url.match(/\/product\/(\d+)\/(\d+)/) ?? url.match(/i\.(\d+)\.(\d+)/) ?? url.match(/\/(\d{6,})\/(\d{6,})/)
  return m ? `SHP${m[1]}_${m[2]}` : ''
}

/**
 * Descobre ofertas Shopee via API oficial. Retorna Promos prontas (offerLink ja
 * e o link de afiliado, nome/preco/imagem vem da API — sem scrape). Dedupa por
 * itemId e respeita o exclude (ids ja vistos/enviados).
 */
export async function discoverShopeePromos(limit: number, exclude: Set<string> = new Set()): Promise<Promo[]> {
  if (!config.shopeeAppId || !config.shopeeSecret) {
    console.warn('[shopee] SHOPEE_APP_ID/SECRET vazios — pulando.')
    return []
  }
  const out: Promo[] = []
  const seen = new Set<string>()
  for (const keyword of KEYWORDS) {
    if (out.length >= limit) break
    let data: ProductOfferV2
    try {
      data = await gql<ProductOfferV2>(OFFER_QUERY, { limit: 30, page: 1, keyword, sortType: 2 })
    } catch (e) {
      console.warn(`[shopee] busca "${keyword || 'geral'}" falhou:`, (e as Error).message)
      continue
    }
    const nodes = data.productOfferV2?.nodes ?? []
    console.log(`[shopee] "${keyword || 'geral'}": ${nodes.length} ofertas`)
    for (const n of nodes) {
      if (out.length >= limit) break
      const id = shopeeId(n.productLink) || `SHP${n.shopId}_${n.itemId}`
      if (exclude.has(id) || seen.has(id)) continue
      if (!n.offerLink) continue
      seen.add(id)
      out.push({
        productUrl: n.productLink,
        link: n.offerLink,
        title: (n.productName || '').trim(),
        image: (n.imageUrl || '').trim(),
        price: brPrice(n.priceMin),
        oldPrice: '',
      })
    }
  }
  return out
}
