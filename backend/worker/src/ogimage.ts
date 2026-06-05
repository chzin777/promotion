import axios from 'axios'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Busca a og:image da pagina do produto. null se falhar. */
export async function fetchOgImage(productUrl: string): Promise<string | null> {
  try {
    const { data: html } = await axios.get<string>(productUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 15_000,
      responseType: 'text',
      maxRedirects: 5,
    })
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    return m ? m[1] : null
  } catch (e) {
    console.warn('[ogimage] falha ao buscar imagem:', (e as Error).message)
    return null
  }
}
