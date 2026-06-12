# Start Agent Browsers (multi-session mission control). Durable: survives this shell closing.
# grid.cjs self-discovers every Chromium debug port, so no CDP port is needed here.
param(
  [string]$BindHost = '127.0.0.1',
  [int]$BindPort = 8090
)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot

# 1. stop any existing grid, then launch a fresh one DETACHED (hidden, logs to file)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*grid.cjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
Start-Process -FilePath 'node' -WindowStyle Hidden -WorkingDirectory $dir `
  -ArgumentList 'grid.cjs', "$BindHost", "$BindPort" `
  -RedirectStandardOutput "$dir\grid.log" -RedirectStandardError "$dir\grid.err"
Start-Sleep -Seconds 2

# 2. ensure the tailnet proxy is up (tailnet-only HTTP/2; NOT Funnel)
tailscale serve --bg $BindPort | Out-Null

# 3. report (derive the phone URL from this machine's MagicDNS name — no hardcoding)
$h = try { Invoke-WebRequest -Uri "http://127.0.0.1:$BindPort/api/health" -UseBasicParsing -TimeoutSec 4 | Select-Object -ExpandProperty Content } catch { '(grid not responding yet)' }
$dns = try { ((tailscale status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.') } catch { $null }
Write-Host "grid health: $h"
if ($dns) { Write-Host "PHONE URL  : https://$dns/   (tailnet only)" }
Write-Host "LOCAL URL  : http://127.0.0.1:$BindPort/"
