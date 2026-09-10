@echo off
REM 서버 종료 — Windows 에서는 pkill -f 가 듣지 않는다(프로세스명이 python.exe).
REM 서버를 두 번 띄우면 먼저 뜬 쪽이 포트를 잡고 있어 코드 수정이 반영되지 않는다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_server.ps1"
