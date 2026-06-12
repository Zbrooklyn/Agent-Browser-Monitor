# Stop Agent Browsers (grid) + the tailnet proxy.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*grid.cjs*' } |
  ForEach-Object { Write-Host "killing grid PID $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
tailscale serve --https=443 off 2>$null | Out-Null
Write-Host "stopped (grid killed, tailnet proxy off)."
