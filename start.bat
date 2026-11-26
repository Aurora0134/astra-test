@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [astra-test] Node.js 22 or newer was not found.
  echo [astra-test] Install Node.js from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v 2^>nul') do set "NODE_MAJOR=%%a"
if not defined NODE_MAJOR set "NODE_MAJOR=0"
if %NODE_MAJOR% LSS 22 (
  echo [astra-test] Node.js 22 or newer is required. Detected major version: %NODE_MAJOR%
  echo [astra-test] Please update Node.js from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

node server\index.js %*
if errorlevel 1 (
  echo [astra-test] The server exited unexpectedly. Review the message above.
  pause
  exit /b 1
)

endlocal
