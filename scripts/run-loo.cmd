@echo off
rem Leave-one-out evaluation against Gemini, run after the daily quota resets.
rem Both passes are resumable: predictions are cached per reel, so re-running
rem picks up whatever the quota cut short.
cd /d "%~dp0.."

where node >nul 2>&1 || set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"

set LOG=data\loo-%DATE:/=-%.log
echo Reels Analyzer - leave-one-out evaluation > "%LOG%"

echo === content only, predicting shares === >> "%LOG%"
set PROVIDER=gemini
set MODE=content
set TARGET=shares
node scripts\learn-eval.mjs >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo === content only, predicting reach === >> "%LOG%"
set TARGET=reach
node scripts\learn-eval.mjs >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo Done. Results also cached in data\learn-eval-gemini-*.json >> "%LOG%"
