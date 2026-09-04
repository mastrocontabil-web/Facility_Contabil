@echo off
REM Configura o projeto numa maquina nova (roda uma vez, depois use iniciar.bat).
REM Precisa de Node.js 20+ e Python 3.12+ instalados.
cd /d "%~dp0"

where node >nul 2>nul || (echo [ERRO] Node.js nao encontrado. Instale de https://nodejs.org & pause & exit /b 1)
where python >nul 2>nul || (echo [ERRO] Python nao encontrado. Instale de https://python.org & pause & exit /b 1)

echo.
echo === 1/3  Instalando dependencias do frontend + backend (npm)...
call npm install || (echo [ERRO] npm install falhou & pause & exit /b 1)

echo.
echo === 2/3  Criando o ambiente Python do parser...
if not exist "parser\.venv" python -m venv parser\.venv
call parser\.venv\Scripts\python -m pip install --upgrade pip -q
call parser\.venv\Scripts\pip install -r parser\requirements.txt -q || (echo [ERRO] pip install falhou & pause & exit /b 1)

echo.
echo === 3/3  Conferindo os .env...
if not exist "backend\.env"  echo   [AVISO] falta backend\.env  (copie de backend\.env.example)
if not exist "frontend\.env" echo   [AVISO] falta frontend\.env (copie de frontend\.env.example)
if not exist "parser\.env"   echo   [AVISO] falta parser\.env   (copie de parser\.env.example)

echo.
echo === Pronto. Rode "iniciar.bat" para subir o sistema.
pause
