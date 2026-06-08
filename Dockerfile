# Promotion bot — painel (Next.js) + worker (whatsapp-web.js + Puppeteer)
# Imagem unica: os dois processos compartilham o filesystem (eles conversam por
# arquivos em backend/worker/data). Chromium do sistema (necessario em ARM, ex:
# Oracle Ampere — o Puppeteer nao publica build de Chrome pra linux-arm64).
FROM node:22-bookworm-slim

# Chromium + fontes (emoji do WhatsApp) + tini (reaper de sinais/zumbis)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer e whatsapp-web.js usam o Chromium do sistema (nao baixam o proprio)
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# 1) deps do painel. npm install (nao ci): o lock gerado no Windows nao registra
# os fallbacks wasm linux-only (@emnapi/*, lightningcss) -> ci estrito quebraria.
# --include=dev: NODE_ENV=production pularia devDeps, mas o build do painel precisa
# do tailwind/typescript e o worker roda via tsx (devDep) em runtime.
COPY package.json package-lock.json ./
RUN npm install --include=dev --no-audit --no-fund

# 2) deps do worker
COPY backend/worker/package.json backend/worker/package-lock.json* ./backend/worker/
RUN npm install --prefix backend/worker --include=dev --no-audit --no-fund

# 3) codigo + build do painel
COPY . .
RUN npm run build

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/start.mjs"]
