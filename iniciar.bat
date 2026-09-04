@echo off
REM Sobe os 3 servicos (frontend + backend + parser) e abre o navegador.
REM Feche esta janela (ou Ctrl+C) para parar tudo.
cd /d "%~dp0"
echo.
echo   Iniciando o sistema Extrato -^> Dominio...
echo   Frontend: http://localhost:5173
echo   (aguarde uns segundos e o navegador abre sozinho)
echo.
timeout /t 4 /nobreak >nul & start "" http://localhost:5173
npm run dev
