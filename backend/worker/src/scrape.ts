import axios from 'axios'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export type Meta = { title: string | null; image: string | null; price: string | null }

/**
 * Le a pagina e extrai titulo + imagem (og:tags) + preco.
 * Funciona tanto no link de afiliado (meli.la, sem preco confiavel) quanto na
 * pagina canonica do produto (/p/MLB..., que TEM preco).
 */
export async function scrapeMeta(url: string): Promise<Meta> {
  try {
    const { data: html } = await axios.get<string>(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 15_000,
      responseType: 'text',
      maxRedirects: 10,
    })
    return {
      title: ogContent(html, 'og:title'),
      image: ogContent(html, 'og:image'),
      price: parsePrice(html),
    }
  } catch (e) {
    console.warn('[scrape] falha ao ler pagina:', (e as Error).message)
    return { title: null, image: null, price: null }
  }
}

/** Extrai o preco da pagina canonica do produto. null se nao achar. */
function parsePrice(html: string): string | null {
  // 1. meta itemprop="price" content="1299.90"
  const meta =
    html.match(/itemprop=["']price["'][^>]*content=["']([\d.]+)["']/i) ??
    html.match(/content=["']([\d.]+)["'][^>]*itemprop=["']price["']/i)
  // 2. JSON embutido "price":1299.9 (pega o 1o, que e o do produto principal)
  const json = html.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/i)
  const raw = meta?.[1] ?? json?.[1]
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  const [int, dec] = n.toFixed(2).split('.')
  const intSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `R$ ${intSep},${dec}`
}

/** Le o content de uma og:<prop> independente da ordem dos atributos. */
function ogContent(html: string, prop: string): string | null {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m =
    html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i')) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${p}["']`, 'i'))
  return m ? decode(m[1]) : null
}

/** Decodifica as entidades HTML mais comuns que aparecem em og:title. */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim()
}
