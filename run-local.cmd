@echo off
rem Chay SportSnap tren may tinh cuc bo (localhost)
set "ROOT=%~dp0"

echo Dang khoi dong SportSnap tren may tinh...

rem 1. Khoi dong Backend neu chua chay
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul || start "SportSnap Backend" cmd /k "cd /d "%ROOT%backend" && .venv\Scripts\activate && uvicorn app.main:app --reload --port 8000"

rem 2. Khoi dong Frontend neu chua chay
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul || start "SportSnap Frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

echo Dang mo trinh duyet...
timeout /t 2 >nul
start http://localhost:5173
