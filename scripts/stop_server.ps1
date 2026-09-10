# 서버 종료 — Windows 에서는 pkill -f 가 듣지 않는다(프로세스명이 python.exe).
# 서버를 두 번 띄우면 먼저 뜬 쪽이 포트를 잡고 있어 코드 수정이 반영되지 않는다.
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*run_server*' } |
  ForEach-Object { Write-Host "stopping PID $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force }
