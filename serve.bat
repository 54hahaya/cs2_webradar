@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   CS2 Web-Radar - serve (build + relay on one port)
echo ============================================================
echo.

call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] build failed.
    pause
    exit /b 1
)

echo.
echo Open on this PC : http://localhost:3360
echo Open on phone   : http://YOUR-PC-LAN-IP:3360
echo Then run tunnel.bat if you need access from outside the LAN.
echo.

node ws\app.js
pause
endlocal
