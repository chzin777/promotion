Monte um JSON no padrão abaixo com os produtos que vou colar.

Regras:
- Raiz: { "date": "AAAA-MM-DD", "items": [...] }  (use a data de hoje)
- Cada item: { "title", "price", "oldPrice", "code", "link", "productUrl", "image", "message" }
- "link" (obrigatório) = short link de afiliado, formato https://meli.la/xxxxx
- "productUrl" = URL da PÁGINA REAL do produto no Mercado Livre (ex: https://www.mercadolivre.com.br/.../p/MLB123...). O worker usa essa página pra pegar a FOTO do produto automaticamente.
- "code" = código do buscador no formato FNC9A8-XXXX.
- "image" = null (o worker resolve a imagem pelo productUrl).
- "message" = null (só preencha se eu pedir legenda custom).
- NÃO invente preços, consulte o link e insira o título do produto.
- Saída: só o JSON puro, sem comentário, sem cercas de código.

Padrão:
{
  "date": "AAAA-MM-DD",
  "items": [
    {
      "title": "Nome do produto",
      "price": "R$ 99,90",
      "oldPrice": "R$ 199,90",
      "code": "FNC9A8-B78A",
      "link": "https://meli.la/xxxxx",
      "productUrl": "https://www.mercadolivre.com.br/produto/p/MLB123456789",
      "image": null,
      "message": null
    }
  ]
}

Meus produtos de hoje (pra cada um: título, preço, código, link de afiliado e link da página do produto):
https://meli.la/1WL5XwZ
https://meli.la/2ny8pJz
https://meli.la/26JNzye
