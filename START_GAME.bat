@echo off
title Mini-game QR - Thay Tuan Anh
echo ==============================================
echo MINI-GAME QR - THAY TUAN ANH
echo ==============================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo May chua co Node.js.
  echo Hay cai Node.js LTS tu https://nodejs.org/
  pause
  exit /b
)
if not exist node_modules (
  echo Dang cai thu vien lan dau...
  call npm install
)
echo.
echo Dang khoi dong game...
start "" cmd /c "timeout /t 3 >nul & powershell -NoProfile -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object {$_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown'} ^| Select-Object -First 1 -ExpandProperty IPAddress); Start-Process ('http://'+$ip+':3000/host')""
call npm start
