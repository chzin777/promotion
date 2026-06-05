# Backend — envio automático de links no WhatsApp

Roda no teu PC, 24h. Dois processos:

- **Evolution API** (Docker) — conexão WhatsApp.
- **worker** (Node) — lê o JSON do dia e envia 1 link a cada intervalo no grupo.

```
backend/
  docker-compose.yml      Evolution API + Postgres
  .env                    chave da Evolution (copie de .env.example)
  worker/
    src/                  código do worker
    data/
      AAAA-MM-DD.json     teu arquivo diário (gerado pela IA)
      PROMPT-DIARIO.md    prompt pra IA montar o JSON
    .env                  config do worker (copie de .env.example)
```

## 1. Subir a Evolution API

Precisa de Docker Desktop instalado e rodando.

```powershell
cd backend
copy .env.example .env        # edite e troque a chave
docker compose up -d
docker compose ps             # confirma evolution-api + postgres "Up"
```

## 2. Conectar o WhatsApp (1x)

1. Abra o manager: http://localhost:8080/manager
2. Entre com a `EVOLUTION_API_KEY` do `.env`.
3. Crie uma instância chamada **promotion** (mesmo nome do worker/.env).
4. Escaneie o QR com o WhatsApp do número que vai postar.

> Use um número dedicado/descartável. Envio automático viola os termos do WhatsApp e tem risco de ban.

## 3. Configurar o worker

```powershell
cd backend/worker
copy .env.example .env        # preencha EVOLUTION_API_KEY (mesma do passo 1)
npm install
npm run status                # deve mostrar state: open
npm run groups                # lista grupos -> copie o JID ...@g.us
```

Cole o JID em `WHATSAPP_GROUP_ID` no `worker/.env`. Ajuste `SEND_INTERVAL_MINUTES`
e a janela `ACTIVE_HOURS_START/END` se quiser.

## 4. Rotina diária

1. Gera os 48 links no painel de afiliado do ML.
2. Cola no prompt `data/PROMPT-DIARIO.md` numa IA → recebe o JSON.
3. Salva como `data/AAAA-MM-DD.json` (data de hoje).
4. Confere: `npm run preview` (mostra as mensagens que vão sair).
5. Worker pega sozinho e envia 1 a cada intervalo.

## 5. Rodar o worker

```powershell
npm start
```

Teste rápido antes: `npm test` (manda 1 mensagem de teste no grupo).

### Deixar 24h

- O worker precisa ficar rodando. Opções: deixar o terminal aberto, ou usar
  `pm2` (`npm i -g pm2 && pm2 start "npm start" --name promotion-worker`).
- Docker já sobe sozinho após reboot (`restart: always`).
- Windows: desative suspensão/hibernação pra não cair de madrugada.
- O `data/.state.json` guarda a posição — se reiniciar, continua de onde parou.
