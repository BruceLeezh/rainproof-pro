@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-v6-preview.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8096/design-preview/"
