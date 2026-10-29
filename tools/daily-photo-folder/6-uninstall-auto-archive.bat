@echo off
REM ============================================================
REM  Remove the scheduled auto-archive task.
REM  Right-click -> "Run as administrator" is recommended.
REM ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-AutoArchiveTask.ps1" -Uninstall
echo.
pause
