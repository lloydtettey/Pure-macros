@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting CalTrack...
start "" http://localhost:3000
call npm start
