@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-v6-preview.ps1" -OpenBrowser
if errorlevel 1 pause
