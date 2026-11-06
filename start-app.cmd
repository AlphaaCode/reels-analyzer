@echo off
rem Double-click launcher: runs the dev server in THIS window and opens the browser
rem once it answers. Close this window (or press Ctrl+C) to stop the server.
rem Fixed port because 3000 is often taken by another project, and next dev then
rem silently moves to 3001/3002 - this way the URL below is always the right one.
title Reels Analyzer
cd /d "%~dp0"
set PORT=3210

rem Helper mode: wait for the server, then open the browser (started below)
if "%~1"=="--open" goto waitopen

rem Node is not on PATH in every shell
where node >nul 2>&1 || set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"

rem Already running (next dev holds a per-project lock, a second one just dies) - just open it
curl -s -o nul http://localhost:%PORT%/api/health && goto open

echo Starting Reels Analyzer on http://localhost:%PORT% ...
echo The first start takes up to a minute. The browser opens by itself when it is ready.
echo Keep this window open while you use the app. Close it to stop the server.
echo.
start "" /b cmd /c ""%~f0" --open"
call npm run dev -- -p %PORT%

echo.
echo The server stopped. Scroll up for the reason.
pause
exit /b 1

:waitopen
for /l %%i in (1,1,300) do (
  curl -s -o nul http://localhost:%PORT%/api/health && goto open
  ping -n 2 127.0.0.1 >nul
)
exit /b 1

:open
start "" http://localhost:%PORT%
exit /b 0
