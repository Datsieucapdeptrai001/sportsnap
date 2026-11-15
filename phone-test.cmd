@echo off
rem Chay SportSnap tren dien thoai qua Cloudflare tunnel (HTTPS)
set "ROOT=%~dp0"

rem 1. Khoi dong Backend (FastAPI port 8000) neu chua chay
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul || start "SportSnap Backend" cmd /k "cd /d "%ROOT%backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"

rem 2. Khoi dong Frontend (Vite port 5173) neu chua chay
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul || start "SportSnap Frontend" cmd /k "cd /d "%ROOT%frontend" && npm.cmd run dev"

echo Dang kiem tra va cho may chu san sang...
ping 127.0.0.1 -n 4 >nul

echo =====================================================================
echo Dang tao duong dan HTTPS qua Cloudflare Tunnel...
echo Hay cho link co dang: https://xxxx.trycloudflare.com xuat hien ben duoi.
echo Mo link do tren trinh duyet dien thoai (Chrome / Safari) de mo app.
echo =====================================================================
cloudflared tunnel --url http://127.0.0.1:5173
