# Promotion Bot — afiliados Mercado Livre no WhatsApp

Bot que **descobre produtos no Mercado Livre, gera o link de afiliado e posta no
grupo do WhatsApp** sozinho, 1 a cada X minutos, dentro de um horário.

- **WhatsApp** via `whatsapp-web.js` (WhatsApp Web de verdade, sem janela — só QR no terminal).
- **Mercado Livre** via navegador automatizado no Portal do Afiliado (gera os `meli.la`).
- Sessões dos dois ficam **salvas em disco** — você loga **uma vez** por máquina.

> ⚠️ Envio automático em massa viola os termos do WhatsApp e tem risco de ban.
> Use um número dedicado.

---

## Setup rápido (1 comando)

Duplo clique em **`iniciar.bat`** (ou rode no terminal). Ele faz tudo:

1. instala dependências (1ª vez)
2. cria o `.env` a partir do exemplo
3. se o WhatsApp não estiver logado → abre o **login do WhatsApp** (QR no terminal)
4. se faltar o grupo no `.env` → **lista seus grupos** e pede pra você colar o id
5. se o Mercado Livre não estiver logado → abre o **Chrome pra você logar** no afiliado
6. **roda a automação**

Se já estiver tudo logado, ele pula direto pro passo 6 (só roda).

> Rode o `iniciar.bat` de novo depois de colar o `WHATSAPP_GROUP_ID` no `.env`.

---

## Setup manual (passo a passo)

Pré-requisito: **Node.js 20+** instalado.

```powershell
cd backend/worker
npm install
copy .env.example .env
```

### 1. Logar no WhatsApp (1x)
```powershell
npm run wa-login
```
Mostra um **QR no terminal**. No celular: *Aparelhos conectados → Conectar um
aparelho* → escaneia. Conectou, ele salva a sessão (`.wwebjs_auth`) e encerra.
(Também salva um `qr-wa.png` como backup, caso o terminal corte o QR.)

### 2. Definir o grupo destino
```powershell
npm run groups
```
Lista os grupos com o id `...@g.us`. Copie o do grupo certo e cole em
`WHATSAPP_GROUP_ID` no `.env`.

### 3. Logar no Mercado Livre (1x)
```powershell
npm run ml-login
```
Abre o **Chrome visível**. Faça login na **sua conta de afiliado**. Quando o
LinkBuilder carregar logado, ele salva a sessão (`.ml_auth`) e encerra sozinho.

### 4. Rodar a automação
```powershell
npm start
```
Reconecta os dois sem pedir login de novo e começa a postar.

---

## Como funciona depois de rodando

- A cada `SEND_INTERVAL_MINUTES`, posta **1 produto** no grupo (foto + título +
  preço + link de afiliado), dentro da janela `ACTIVE_HOURS_START`–`END`.
- **2x por dia** (`FEED_AM_HOUR` e `FEED_PM_HOUR`) descobre produtos novos no
  **Mercado Livre e na Amazon**, gera os links e enfileira **intercalado** (mesmo
  rodízio). Não repete produto já visto.
  - **Mercado Livre**: precisa logar 1x (`npm run ml-login`); gera `meli.la`.
  - **Amazon**: só precisa da `AMAZON_TAG` no `.env` — sem login. Gera o link com
    `?tag=suatag`. Se `AMAZON_TAG` ficar vazio, posta só ML.
- A descrição **varia entre 20 mensagens** diferentes (sorteadas por envio).
- Você também pode adicionar links na mão em `data/produtos.xlsx` (cola só o link;
  o bot busca título/foto/preço).

### Encerrar
**Ctrl+C** no terminal. Isso fecha o Chrome do ML de forma limpa e **salva a
sessão**. Não mate pela força (Gerenciador de Tarefas) — no Windows isso pode
deixar o Chrome órfão e travar o próximo start com "profile in use".
(O bot já limpa locks órfãos no startup, mas Ctrl+C é o jeito certo.)

---

## Configuração (`.env`)

| Variável | Default | O quê |
|---|---|---|
| `WHATSAPP_GROUP_ID` | *(vazio)* | **Obrigatório.** id do grupo `...@g.us` (use `npm run groups`). |
| `WA_CLIENT_ID` | `promotion` | id da sessão. Só mude se rodar mais de um bot. |
| `SEND_INTERVAL_MINUTES` | `15` | minutos entre envios. |
| `ACTIVE_HOURS_START` / `END` | `8` / `22` | janela de horário (24h). `0` e `24` = sempre. |
| `ML_HEADLESS` | `false` | `true` roda o Chrome do ML invisível. Só ligue **depois** de logar (`npm run ml-login`). |
| `FEED_COUNT` | `20` | quantos produtos do **ML** descobrir por slot. |
| `FEED_AM_HOUR` / `PM_HOUR` | `8` / `14` | horas dos 2 slots de descoberta. |
| `AMAZON_TAG` | *(vazio)* | sua tag de afiliado Amazon (`xxxxx-20`). Vazio = não posta Amazon. |
| `AMAZON_FEED_COUNT` | `10` | quantos produtos da **Amazon** descobrir por slot. |
| `AMAZON_HEADLESS` | `true` | Amazon não precisa logar. Ponha `false` se aparecer captcha. |

> Depois de logar no ML uma vez, dá pra setar `ML_HEADLESS=true` pra rodar sem a
> janela aparecer. Se a sessão do ML expirar, deixe em `false` de novo pra relogar.

---

## Passar pra outra pessoa / outra máquina

As sessões e segredos **não vão junto** (estão no `.gitignore`):
`.wwebjs_auth`, `.ml_auth`, `.env`, `data/*`. Cada pessoa usa o **WhatsApp e a
conta de afiliado dela**.

Na máquina nova, é só: copiar o projeto → rodar **`iniciar.bat`** → seguir os
prompts (QR do WhatsApp, escolher grupo, login do ML). Pronto.

Pra postar Amazon, a pessoa põe a **tag de afiliado dela** em `AMAZON_TAG` no
`.env` (Amazon não tem login no bot). Sem tag, roda só com Mercado Livre.

---

## Comandos úteis

| Comando | O quê |
|---|---|
| `npm start` | roda a automação. |
| `npm run setup` | instala o Chrome do Puppeteer (executado automaticamente). |
| `npm run wa-login` | loga no WhatsApp (QR) e encerra. |
| `npm run logout` | **desliga do WhatsApp** (deleta a sessão do disco). |
| `npm run ml-login` | loga no Mercado Livre (Chrome visível) e encerra. |
| `npm run groups` | lista os grupos pra achar o `...@g.us`. |
| `npm run feed` | força uma descoberta de produtos agora (teste). |
| `npm run status` | mostra o estado da conexão. |

---

## Troubleshooting

### ❌ "Could not find Chrome"

Se ver erro do Puppeteer sobre Chrome não encontrado:

```
Could not find Chrome (ver. 146.0.7680.31)...
```

**Solução:** instale o Chrome:
```powershell
npm run setup
```

Isso é executado automaticamente ao rodar `npm install`, mas se você está numa
**máquina compartilhada ou com cache de Puppeteer manuseado**, rode o comando
acima. Depois tente de novo.

### ❌ "Deslogar do WhatsApp"

Para **usar outra conta** numa máquina diferente, desliga de onde está:

```powershell
npm run logout
```

Isso **deleta a sessão salva** (`.wwebjs_auth`). Na próxima execução, vai pedir
um novo QR pra você escanear com a conta que quer.

### ⚠️ Ctrl+C vs. Force Kill

- ✅ **Ctrl+C**: encerrá gracefully, salva sessões, fecha Chrome de forma limpa.
- ❌ **Ctrl+Break** ou Task Manager: pode deixar Chrome órfão. Se isso acontecer,
  o bot tenta limpar sozinho no próximo start, mas é mais lento.

Use sempre **Ctrl+C**.
