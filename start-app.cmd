@echo off
rem Double-click launcher: starts the dev server on a fixed port and opens the browser.
rem Fixed port because 3000 is often taken by another project, and next dev then
rem silently moves to 3001/3002 — this way the URL below is always the right one.
title Reels Analyzer
cd /d "%~dp0"
set PORT=3210

rem Node is not on PATH in every shell
where node >nul 2>&1 || set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"

rem Already running (next dev holds a per-project lock, a second one just dies) — open it
curl -s -o nul http://localhost:%PORT%/api/health && goto open

start "Reels Analyzer - dev server" cmd /c "npm run dev -- -p %PORT%"

echo Starting Reels Analyzer on http://localhost:%PORT% ...
for /l %%i in (1,1,60) do (
  curl -s -o nul http://localhost:%PORT%/api/health && goto open
  ping -n 2 127.0.0.1 >nul
)

echo.
echo Server did not answer within ~60 seconds - check the "dev server" window for errors.
pause
exit /b 1

:open
start "" http://localhost:%PORT%
exit /b 0
