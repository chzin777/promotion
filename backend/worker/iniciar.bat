@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
chcp 65001 >nul

echo ============================================
echo   Promotion Bot - setup e automacao
echo ============================================
echo.

REM 1. dependencias
if not exist "node_modules\" (
  echo [1/5] Instalando dependencias... ^(demora na 1a vez^)
  call npm install
) else (
  echo [1/5] Dependencias OK.
)

REM 2. .env
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo [2/5] .env criado a partir do exemplo.
) else (
  echo [2/5] .env OK.
)

REM 3. login WhatsApp (se nao tiver sessao salva)
if not exist ".wwebjs_auth\session-promotion\" (
  echo [3/5] WhatsApp sem sessao - abrindo login. Escaneie o QR no terminal...
  call npm run wa-login
) else (
  echo [3/5] WhatsApp ja logado.
)

REM 4. grupo ainda vazio? lista os grupos e para pra voce preencher
findstr /r /c:"^WHATSAPP_GROUP_ID=$" ".env" >nul
if not errorlevel 1 (
  echo.
  echo [!] WHATSAPP_GROUP_ID esta vazio no .env. Listando seus grupos:
  echo.
  call npm run groups
  echo.
  echo [!] Copie o id do grupo ^(...@g.us^), cole em WHATSAPP_GROUP_ID no .env
  echo     e rode este arquivo de novo.
  echo.
  pause
  exit /b 0
)

REM 5. login Mercado Livre (se nao tiver sessao salva)
if not exist ".ml_auth\" (
  echo [4/5] Mercado Livre sem sessao - abrindo o Chrome. Faca login na conta de afiliado...
  call npm run ml-login
) else (
  echo [4/5] Mercado Livre ja logado.
)

REM 6. Amazon nao tem login - so depende da AMAZON_TAG no .env. Avisa se vazia.
findstr /r /c:"^AMAZON_TAG=$" ".env" >nul
if not errorlevel 1 (
  echo [i] Amazon DESATIVADA: AMAZON_TAG vazio no .env - vai postar so Mercado Livre.
  echo     Para ativar: cole sua tag ^(xxxxx-20^) em AMAZON_TAG no .env e rode de novo.
  echo.
)

REM 7. roda a automacao
echo [5/5] Tudo pronto. Iniciando automacao. ^(Ctrl+C encerra e salva a sessao^)
echo.
call npm start

endlocal
