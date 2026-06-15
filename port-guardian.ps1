# Agent Browsers — port guardian
# Guarantees grid.cjs owns its port at all times: restarts it within seconds if it
# dies, and evicts any other process that has squatted the port during a gap.
# Registered as a per-user Scheduled Task (AtLogon, restart-on-failure). Same-user
# process kills + user-scope task => no elevation needed.
param(
  [int]$Port = 8090,
  [string]$BindHost = "127.0.0.1"
)
$ErrorActionPreference = "SilentlyContinue"
$grid      = Join-Path $PSScriptRoot "grid.cjs"   # portable: resolves next to this script
$node      = (Get-Command node).Source
$tailscale = "C:\Program Files\Tailscale\tailscale.exe"

function Get-Listeners {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
}
function Is-GridPid([int]$ProcId) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcId" -ErrorAction SilentlyContinue
  return ($p -and $p.CommandLine -like "*grid.cjs*")
}
function GridIsOnPort {
  foreach ($c in Get-Listeners) { if (Is-GridPid $c.OwningProcess) { return $true } }
  return $false
}

while ($true) {
  if (-not (GridIsOnPort)) {
    # 1) evict anything that isn't our grid squatting the reserved port
    foreach ($c in Get-Listeners) {
      if (-not (Is-GridPid $c.OwningProcess)) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Milliseconds 500
    # 2) (re)bind grid to the reserved port
    Start-Process -FilePath $node -ArgumentList $grid, $BindHost, $Port -WindowStyle Hidden
    Start-Sleep -Seconds 2
    # 3) keep the PWA hostname pointed at the reserved port
    if (Test-Path $tailscale) {
      & $tailscale serve --bg --https=443 ("http://127.0.0.1:{0}" -f $Port) 2>$null | Out-Null
    }
  }
  Start-Sleep -Seconds 5
}
