@echo off
REM ============================================================
REM  Create today's dated construction-photo folder (no file move)
REM  Double-click to run. Keep this .bat next to the .ps1 file.
REM ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0New-DailyPhotoFolder.ps1" -Open
echo.
pause
