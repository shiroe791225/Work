@echo off
REM ============================================================
REM  Create E:\...\04_daily photos\20261029 and move the photos
REM  downloaded from the chat (20261029_*.jpg) into it.
REM  Keep this .bat next to Import-PhotosToDateFolder.ps1
REM ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Import-PhotosToDateFolder.ps1"
