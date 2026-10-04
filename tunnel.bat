@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   CS2 Web-Radar - public tunnel
echo ============================================================
echo.
echo Prereq: relay running WITH the built front-end.
echo   1) npm run build
echo   2) node ws\app.js      (page + WebSocket on port 3360)
echo   3) verify http://localhost:3360 locally first
echo.
echo Then run this script to expose 3360 to the internet.
echo.

set CF_LOCAL=%~dp0tools\bin\cloudflared.exe
set NG_LOCAL=%~dp0tools\bin\ngrok.exe

set HAS_CF=
set HAS_NG=
if exist "%CF_LOCAL%" set HAS_CF=1
if exist "%NG_LOCAL%" set HAS_NG=1
if not defined HAS_CF (where cloudflared >nul 2>nul && set HAS_CF=1)
if not defined HAS_NG (where ngrok       >nul 2>nul && set HAS_NG=1)

if defined HAS_CF (echo   [x] cloudflared  found) else (echo   [ ] cloudflared  NOT found)
if defined HAS_NG (echo   [x] ngrok        found) else (echo   [ ] ngrok        NOT found)
echo.
echo   cloudflared : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
echo   ngrok       : https://ngrok.com/download
echo   (put the exe in tools\bin\ and this script will use it automatically)
echo.

set CHOICE=
set /p CHOICE=Choose tunnel [1=cloudflared  2=ngrok] : 

if "%CHOICE%"=="1" goto CF
if "%CHOICE%"=="2" goto NG
echo Invalid choice.
pause
exit /b 1

:CF
if not defined HAS_CF goto NOCF
echo.
echo Starting cloudflared ...
echo Copy the https://xxxx.trycloudflare.com URL and open it on your phone.
echo Page and WebSocket share this single URL - no extra config.
echo.
if exist "%CF_LOCAL%" (
    "%CF_LOCAL%" tunnel --url http://localhost:3360 --no-autoupdate
) else (
    cloudflared tunnel --url http://localhost:3360
)
goto DONE

:NOCF
echo.
echo [ERROR] cloudflared not found (neither tools\bin\cloudflared.exe nor PATH).
pause
exit /b 1

:NG
if not defined HAS_NG goto NONG
echo.
echo Starting ngrok ...
echo Open the https://xxxx.ngrok-free.app URL on your phone.
echo.
if exist "%NG_LOCAL%" (
    "%NG_LOCAL%" http 3360
) else (
    ngrok http 3360
)
goto DONE

:NONG
echo.
echo [ERROR] ngrok not found (neither tools\bin\ngrok.exe nor PATH).
pause
exit /b 1

:DONE
echo.
echo Tunnel closed.
pause
endlocal