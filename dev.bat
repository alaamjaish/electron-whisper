@echo off
title LocalTranscriber Logs
echo ======================================
echo   LocalTranscriber - Dev Mode
echo   Press Alt+Shift+L to record
echo ======================================
echo.
set ELECTRON_RUN_AS_NODE=
npm run dev 2>&1
pause
