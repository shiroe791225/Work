@echo off
REM ============================================================
REM  DRY RUN - preview only. Nothing is created, nothing is moved.
REM  Run this FIRST to confirm the behaviour.
REM ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Watch-DailyPhotoFolder.ps1" -RunOnce -WhatIf
echo.
pause
