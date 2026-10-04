@echo off
cd /d "%~dp0"
echo [webradar] installing npm dependencies (first run only) ...
call npm install
if errorlevel 1 (
    echo.
    echo [webradar] npm install FAILED - check that Node.js is installed ^(node -v^)
    pause
    exit /b 1
)
echo.
echo [webradar] done. Now run start.bat
pause
