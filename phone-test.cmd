@echo off
rem Open SportSnap on a phone over HTTPS: backend + Vite + Cloudflare quick tunnel.
rem Any *.trycloudflare.com hostname is allowed, so nothing needs editing per run.
set "ROOT=%~dp0"

netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul || start "SportSnap backend" cmd /k "cd /d "%ROOT%backend" && .venv\Scripts\activate && uvicorn app.main:app --port 8000"

netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul && (
  echo Port 5173 dang bi chiem. Tat server Vite cu roi chay lai.
  pause
  exit /b 1
)
start "SportSnap frontend" cmd /k "cd /d "%ROOT%frontend" && set __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.trycloudflare.com&& npm run dev"

echo Cho link https://....trycloudflare.com ben duoi, mo tren dien thoai. Ctrl+C de dung.
cloudflared tunnel --url http://localhost:5173
