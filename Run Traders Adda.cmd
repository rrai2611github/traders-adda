@echo off
rem Double-click to start Traders Adda. Pass an action from a terminal: start | stop | restart | rebuild | status | dev
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-app.ps1" %*
if "%~1"=="" (
  start "" http://localhost:3107
  pause
)
