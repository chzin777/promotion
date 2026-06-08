@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
chcp 65001 >nul

for %%I in ("%~dp0..\..") do set "ROOT_DIR=%%~fI"

echo ============================================
echo   Promotion Bot - setup e automacao
echo ============================================
echo.

REM 0. Node.js instalado? (sem ele nada roda)
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js nao encontrado nesta maquina.
  echo     Instale o Node.js LTS: https://nodejs.org/  ^(baixe, instale, reabra este .bat^)
  echo.
  pause
  exit /b 1
)
echo [0/7] Node.js OK.

REM Navegador: usa o Chrome/Edge do sistema (resolveChrome no codigo).
REM Win10/11 sempre tem Edge -> nao precisa baixar Chromium.

REM 1. dependencias do worker
if not exist "node_modules\" (
  echo [1/7] Instalando dependencias do worker... ^(demora na 1a vez^)
  call npm install
) else (
  echo [1/7] Dependencias do worker OK.
)

REM 2. dependencias do painel web (raiz do projeto)
if not exist "%ROOT_DIR%\node_modules\" (
  echo [2/7] Instalando dependencias do painel web... ^(demora na 1a vez^)
  pushd "%ROOT_DIR%"
  call npm install
  popd
) else (
  echo [2/7] Dependencias do painel web OK.
)

REM 3. .env
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo [3/7] .env criado a partir do exemplo.
) else (
  echo [3/7] .env OK.
)

REM 4. login WhatsApp (se nao tiver sessao salva)
if not exist ".wwebjs_auth\session-promotion\" (
  echo [4/7] WhatsApp sem sessao - abrindo login. Escaneie o QR no terminal...
  call npm run wa-login
) else (
  echo [4/7] WhatsApp ja logado.
)

REM 5. grupo ainda vazio? lista os grupos e para pra voce preencher
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

REM 6. login Mercado Livre OPCIONAL (so precisa se for usar a plataforma ML)
if not exist ".ml_auth\" (
  echo.
  echo [5/7] Mercado Livre nao logado.
  echo     So precisa logar se for USAR o ML. Da pra pular e ligar/desligar
  echo     o ML depois no painel ^(secao Plataformas^).
  choice /c SN /t 8 /d N /m "Logar no Mercado Livre agora? S/N (pula sozinho em 8s)"
  if errorlevel 2 (
    echo [5/7] ML pulado. Se NAO for usar ML, desligue o toggle no painel.
  ) else (
    call npm run ml-login
  )
) else (
  echo [5/7] Mercado Livre ja logado.
)

REM 7. Amazon: tag de afiliado configuravel no painel web ^(secao Plataformas^).
echo [i] Tag Amazon: configure no painel http://localhost:3000 ^(com automacao parada^).
echo.

REM 8. painel + worker no mesmo terminal
echo [6/7] Iniciando painel e automacao neste terminal...
echo       Painel: http://localhost:3000
echo       Ctrl+C encerra os dois. ^(worker salva a sessao^)
echo.
pushd "%ROOT_DIR%"
call npm run dev:all
popd

echo.
echo [x] A automacao encerrou (codigo %errorlevel%). Veja o erro acima.
echo     Causa comum: porta 3000 ja em uso. Feche o outro painel e rode de novo.
pause

endlocal
