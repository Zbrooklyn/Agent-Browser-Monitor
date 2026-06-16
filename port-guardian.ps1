# Agent Browsers — port guardian
# Guarantees grid.cjs owns its port at all times: restarts it within seconds if it
# dies, and evicts any other process that has squatted the port during a gap.
# Registered as a per-user Scheduled Task (AtLogon, restart-on-failure). Same-user
# process kills + user-scope task => no elevation needed.
param(
  [int]$Port = 8090,
  [string]$BindHost = "127.0.0.1",
  [int]$OwnerPid = 0          # if set, this guardian stops the server and exits when that process (the tray) is gone
)
$ErrorActionPreference = "SilentlyContinue"
$grid      = Join-Path $PSScriptRoot "grid.cjs"   # portable: resolves next to this script
$tailscale = "C:\Program Files\Tailscale\tailscale.exe"
$nodeUrl   = "https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip"   # portable Node, fetched once if none is installed
$nodeDir   = Join-Path $env:LOCALAPPDATA "AgentBrowsers\node"
$localNode = Join-Path $nodeDir "node.exe"
$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$outLog = Join-Path $logDir "grid.out.log"
$errLog = Join-Path $logDir "grid.err.log"

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
# Find a usable node.exe: system install first, then a cached portable copy, else fetch the
# portable Node zip once (no admin, no installer) into LocalAppData and cache node.exe there.
function Resolve-Node {
  $sys = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ($sys) { return $sys }
  if (Test-Path $localNode) { return $localNode }
  try {
    New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
    $zip = Join-Path $env:TEMP "abm-node.zip"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $zip -UseBasicParsing
    $ex = Join-Path $env:TEMP "abm-node-ex"
    Expand-Archive -Path $zip -DestinationPath $ex -Force
    $found = Get-ChildItem $ex -Recurse -Filter node.exe | Select-Object -First 1
    if ($found) { Copy-Item $found.FullName $localNode -Force }
    Remove-Item $zip, $ex -Recurse -Force -ErrorAction SilentlyContinue
  } catch {}
  if (Test-Path $localNode) { return $localNode }
  return $null
}

while ($true) {
  # if the owner (tray) is gone, stop the server and exit — nothing runs without the icon
  if ($OwnerPid -ne 0 -and -not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*grid.cjs*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    exit
  }
  if (-not (GridIsOnPort)) {
    # 1) evict anything that isn't our grid squatting the reserved port
    foreach ($c in Get-Listeners) {
      if (-not (Is-GridPid $c.OwningProcess)) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Milliseconds 500
    # 2) (re)bind grid to the reserved port, capturing its output. Rotate the previous run's
    #    logs first so the crash that caused this restart is preserved in *.prev.
    $node = Resolve-Node
    if ($node) {
      foreach ($lf in @($outLog, $errLog)) { if (Test-Path $lf) { Move-Item $lf "$lf.prev" -Force -ErrorAction SilentlyContinue } }
      Start-Process -FilePath $node -ArgumentList $grid, $BindHost, $Port -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
      Start-Sleep -Seconds 2
      # 3) keep the PWA hostname pointed at the reserved port
      if (Test-Path $tailscale) {
        & $tailscale serve --bg --https=443 ("http://127.0.0.1:{0}" -f $Port) 2>$null | Out-Null
      }
    }
  }
  Start-Sleep -Seconds 5
}
