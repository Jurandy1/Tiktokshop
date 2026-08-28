@echo off
setlocal
cd /d "%~dp0.."

set TAG=%~1
if "%TAG%"=="" set TAG=tiktokshop,achadinhos

echo.
echo ========================================
echo  TikTok - Busca automatica mais viral
echo ========================================
echo.

netstat -an | findstr /C:":9222" | findstr LISTENING >nul 2>&1
if errorlevel 1 (
  echo Chrome debug nao detectado na porta 9222.
  echo Abrindo Chrome com perfil salvo...
  call "%~dp0abrir-chrome-debug.cmd" %TAG%
  echo Aguardando Chrome carregar ^(30s^)...
  echo Role o feed da hashtag no Chrome antes do script continuar.
  timeout /t 30 /nobreak >nul
) else (
  echo Chrome debug ja esta ativo.
)

echo.
echo Coletando video mais viral ^(hashtag: %TAG%^)...
echo.

node src/sync-most-viral.js --cdp --hashtags %TAG% --require-product --enrich 1 --limit 50
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE%==0 (
  echo OK - veja output\most-viral-latest.json
) else (
  echo Falhou - confira login no TikTok e se a hashtag carregou no Chrome.
)

endlocal
exit /b %EXIT_CODE%
