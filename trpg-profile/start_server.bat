@echo off
cd /d "%~dp0"
set PORT=8765
start "" cmd /c "timeout /t 1 >nul && start http://localhost:%PORT%"
py -m http.server %PORT%
pause
