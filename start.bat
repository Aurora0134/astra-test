@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [astra-test] Node.js 20 or newer was not found.
  echo [astra-test] Install Node.js from https://nodejs.org/ and run this file again.
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
