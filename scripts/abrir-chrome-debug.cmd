@echo off
REM Abre Chrome com debug para coleta CDP (produtos + videos)
set PROFILE=%~dp0..\cookies\chrome-debug-profile
set TAG=%~1
if "%TAG%"=="" set TAG=achadinhos

echo Perfil: %PROFILE%
echo.
echo 1. Chrome vai abrir
echo 2. Faca login no TikTok se pedir
echo 3. Hashtag: https://www.tiktok.com/tag/%TAG%
echo 4. Role o feed para carregar videos
echo.
echo Depois rode:
echo   node src/test-videos.js --cdp --hashtags %TAG%
echo   node src/test-discover.js --cdp
echo.

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" "https://www.tiktok.com/tag/%TAG%"
