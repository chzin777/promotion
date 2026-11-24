# Promotion — Bot de promoções de afiliados no WhatsApp

Automação que **descobre ofertas** (Mercado Livre, Amazon e Shopee), **gera o link de afiliado** e **posta no grupo do WhatsApp** sozinha, em intervalos e horários configuráveis. Inclui um painel web para acompanhar e ajustar o bot.

> ⚠️ Envio automático em massa viola os termos do WhatsApp e pode causar banimento. Use um número dedicado.

## Arquitetura

| Parte | Pasta | O que faz |
|-------|-------|-----------|
| **Painel** | raiz (`app/`) | Next.js 16: escolha de grupos, configurações e status (`/api/groups`, `/api/settings`) |
| **Worker** | `backend/worker/` | Node + `whatsapp-web.js` + Puppeteer: login no WhatsApp/ML, descoberta de produtos, geração de links e envio |

Painel e worker conversam por arquivos em `backend/worker/data/`, por isso rodam no **mesmo host** (em produção, no mesmo container). As sessões do WhatsApp e do Mercado Livre ficam salvas em disco — o login é feito uma vez por máquina.

## Como rodar localmente

**Windows (mais simples):** dê duplo clique em `backend/worker/iniciar.bat`. Ele instala dependências, cria o `.env`, abre o login do WhatsApp (QR no terminal), lista seus grupos, abre o login do Mercado Livre e inicia a automação.

**Manual:**

```bash
# painel
npm install
npm run dev          # painel em http://localhost:3000
npm run dev:all      # painel + worker juntos

# worker
cd backend/worker
npm install
cp .env.example .env
npm run wa-login     # QR do WhatsApp
npm run groups       # lista grupos para pegar o WHATSAPP_GROUP_ID
npm run ml-login     # login no Portal de Afiliados do Mercado Livre
npm run start        # inicia a automação
```

Outros scripts do worker: `status`, `preview`, `feed`, `ml-discover`, `ml-generate`, `ml-links`, `ml-inspect`, `link`, `logout`, `test`.

## Variáveis de ambiente

Worker (`backend/worker/.env`) — veja `backend/worker/.env.example`:

| Variável | Descrição |
|----------|-----------|
| `WHATSAPP_GROUP_ID` | Grupo de destino das ofertas |
| `WA_CLIENT_ID` | Identificador da sessão do WhatsApp |
| `SEND_INTERVAL_MINUTES` / `SEND_INTERVAL_MINUTES_POOL` | Intervalo entre envios |
| `ACTIVE_HOURS_START` / `ACTIVE_HOURS_END` | Janela de horário em que o bot posta |
| `FEED_COUNT`, `FEED_AM_HOUR`, `FEED_PM_HOUR` | Quantidade e horários de coleta de ofertas |
| `ML_HEADLESS` | Navegador do Mercado Livre sem janela |
| `AMAZON_TAG`, `AMAZON_FEED_COUNT`, `AMAZON_HEADLESS` | Afiliado Amazon |
| `SHOPEE_APP_ID`, `SHOPEE_APP_SECRET`, `SHOPEE_FEED_COUNT` | Afiliado Shopee |

Servidor (`.env.server`) — veja `.env.server.example`.

## Deploy

Um único container Docker (painel + worker) em VPS Linux, com redeploy automático via GitHub Actions (`.github/workflows/deploy.yml`). Passo a passo completo em [`DEPLOY.md`](DEPLOY.md).

> O painel **não tem senha**: não exponha a porta 3000 publicamente — acesse por túnel SSH.

## Mais documentação

- [`DEPLOY.md`](DEPLOY.md) — servidor, Docker e redeploy automático
- [`backend/worker/README.md`](backend/worker/README.md) — detalhes do worker
- `backend/worker/data/PROMPT-DIARIO.md` — modelo das mensagens diárias
