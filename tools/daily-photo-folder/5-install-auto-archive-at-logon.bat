@echo off
REM ============================================================
REM  Install the auto-archiver as a Windows Scheduled Task:
REM  starts at logon, self-restarts every 15 min if it died,
REM  runs hidden, never more than one instance.
REM  Right-click -> "Run as administrator" is recommended.
REM ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-AutoArchiveTask.ps1"
echo.
pause
