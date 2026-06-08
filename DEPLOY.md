# Deploy — online 24/7 com redeploy automatico do GitHub

Arquitetura: **1 container** roda painel (Next.js, porta 3000) + worker (whatsapp-web.js
+ Puppeteer). Eles conversam por arquivos em `backend/worker/data`, entao tem que
ficar no mesmo host. Sessoes (WhatsApp/ML) vivem em **volumes** e sobrevivem a redeploy.

Funciona em qualquer VPS Linux com Docker. Gratis de verdade + always-on + Chromium:
**Oracle Cloud Always Free** (VM ARM Ampere, 24GB RAM, free pra sempre).

---

## 1. Criar a VM (Oracle Always Free)

1. cloud.oracle.com -> Compute -> Instances -> Create.
2. Image: **Ubuntu 22.04**. Shape: **Ampere A1 (ARM)**, ex. 2 OCPU / 12GB (free).
3. Baixe a chave SSH da instancia.
4. Networking -> Security List -> abrir porta 22 (SSH). **NAO** abra a 3000 ao mundo
   (o painel nao tem senha — qualquer um controlaria o bot). Acesse o painel por
   tunel SSH (passo 6).

## 2. Instalar Docker na VM

```bash
ssh ubuntu@SEU_IP
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
```

## 3. Clonar o repo + configurar

```bash
git clone https://github.com/SEU_USER/promotion.git ~/promotion
cd ~/promotion
cp .env.server.example .env.server
nano .env.server   # preencha WHATSAPP_GROUP_ID e o resto
```

## 4. Subir a primeira vez (manual)

```bash
docker compose up -d --build      # demora alguns min no 1o build
docker compose logs -f promotion  # acompanhe o boot
```

**Login WhatsApp:** o QR aparece nesses logs (ASCII) e tambem em
`/app/backend/worker/qr-wa.png` dentro do volume. Escaneie pelo celular
(Aparelhos conectados > Conectar). A sessao salva no volume — nao re-escaneia
em redeploys.

**Login Mercado Livre:** decidido depois. Como o server e headless, a forma
simples e logar na sua maquina (`npm run ml-login`) e copiar a pasta `.ml_auth`
pro volume `ml_session` (ex. via `docker cp`).

## 5. Auto-deploy do GitHub (push na main -> redeploy)

Em **GitHub > repo > Settings > Secrets and variables > Actions**, crie:

| Secret        | Valor                                  |
|---------------|----------------------------------------|
| `SSH_HOST`    | IP da VM                               |
| `SSH_USER`    | `ubuntu`                               |
| `SSH_KEY`     | conteudo da chave **privada** SSH      |
| `DEPLOY_PATH` | `/home/ubuntu/promotion`               |
| `SSH_PORT`    | `22` (opcional)                        |

Pronto. `.github/workflows/deploy.yml` ja faz: na push pra `main`, conecta por
SSH, `git pull` + `docker compose up -d --build`. As sessoes nos volumes
persistem entre deploys.

## 6. Acessar o painel (sem expor a porta)

Do seu PC, tunel SSH:

```bash
ssh -L 3000:localhost:3000 ubuntu@SEU_IP
```

Abra http://localhost:3000. Configure plataformas/intervalo e clique em iniciar.

---

## Notas

- **Risco WhatsApp:** web.js e nao-oficial; rodar 24/7 de IP de datacenter tem
  risco de ban maior que num celular. Aceitavel pra testar.
- **ARM:** a imagem usa o Chromium do sistema (`/usr/bin/chromium`) porque o
  Puppeteer nao tem build de Chrome pra linux-arm64. Ja configurado no Dockerfile.
- **Atualizar manualmente:** `cd ~/promotion && git pull && docker compose up -d --build`.
- **Ver logs:** `docker compose logs -f promotion`.
- **Reset sessao WhatsApp:** `docker compose down && docker volume rm promotion_wa_session && docker compose up -d`.
