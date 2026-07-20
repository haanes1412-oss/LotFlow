@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is not found in PATH.
  echo Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 (
  echo Node.js 20 or newer is required. Current version:
  node --version
  pause
  exit /b 1
)

echo.
echo LotFlow
echo Ostav pustym token, chtoby zapustit demo-rezhim.
set /p "LZT_TOKEN=Vstav token LZT API ili prosto Enter: "

if not defined LZT_CURRENCY set "LZT_CURRENCY=rub"
echo.
echo Posle zapuska otkroy http://127.0.0.1:4173
npm start
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Server stopped with code %EXIT_CODE%.
echo Send a screenshot of this window without the token if the server did not start.
pause
exit /b %EXIT_CODE%
