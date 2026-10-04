@echo off
cd /d "%~dp0"
echo ============================================================
echo   CS2 Web-Radar
echo     ws relay  : ws://127.0.0.1:3360/cs2_webradar
echo     front-end : http://localhost:5173
echo ============================================================
echo.
echo 1) make sure the game is running
echo 2) inject our DLL (xmllite.dll) - it pushes data to the relay
echo 3) open http://localhost:5173 in your browser
echo.
call npm run dev
pause
