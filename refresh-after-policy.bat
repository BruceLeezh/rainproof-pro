@echo off
rem ASCII-only wrapper: cmd.exe mangles UTF-8, so the real logic lives in the
rem .ps1 (UTF-8 with BOM), which handles the Chinese folder names correctly.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0refresh-after-policy.ps1"
if errorlevel 1 (
  echo.
  echo FAILED - see the step that threw above.
  pause
  exit /b 1
)
echo.
echo DONE - now run morning-check.bat
pause
