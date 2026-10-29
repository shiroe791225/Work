@echo off
REM ============================================================
REM  Create today's dated folder AND move loose photos/videos
REM  from the parent folder into it.
REM  Double-click to run. Keep this .bat next to the .ps1 file.
REM ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0New-DailyPhotoFolder.ps1" -MovePhotos -Open
echo.
pause
