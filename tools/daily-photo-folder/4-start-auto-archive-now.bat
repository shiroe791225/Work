@echo off
REM ============================================================
REM  Start the resident auto-archiver in a visible window.
REM  Drop photos into the parent folder - they are filed
REM  automatically within ~20-30 seconds.
REM  Close the window or press Ctrl+C to stop.
REM ============================================================
chcp 65001 >nul
title Daily construction photo auto-archive
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Watch-DailyPhotoFolder.ps1"
echo.
pause
