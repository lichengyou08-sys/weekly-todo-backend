@echo off
echo Starting Weekly Todo Server...
echo.

cd /d C:\Users\LiChengyou\PyCharmMiscProject\weekly-todo-backend

echo [1/2] Starting Node.js Server...
start "Node.js Server" cmd /k "npm start"

echo [2/2] Waiting for server...
timeout /t 5 /nobreak >nul

echo.
echo Starting Cloudflare Tunnel...
start "Cloudflare Tunnel" cmd /k "C:\Users\LiChengyou\Downloads\cloudflared.exe tunnel --url http://localhost:3000"

echo.
echo ===================================
echo Server is starting...
echo Wait for Cloudflare Tunnel URL
echo ===================================
echo.
pause
