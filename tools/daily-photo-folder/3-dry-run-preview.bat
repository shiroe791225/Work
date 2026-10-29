@echo off
REM ============================================================
REM  DRY RUN: shows what would be created / moved. Changes nothing.
REM  Run this first if you are unsure.
REM ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0New-DailyPhotoFolder.ps1" -MovePhotos -WhatIf
echo.
pause
