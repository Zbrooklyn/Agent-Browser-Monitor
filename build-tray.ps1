# Build the Agent Browsers tray app (Windows). Produces AgentBrowsers.exe next to this
# script using the .NET Framework C# compiler (no SDK or npm install needed).
$ErrorActionPreference = "Stop"
$csc = Get-ChildItem "C:\Windows\Microsoft.NET\Framework64\v4*\csc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $csc) { $csc = Get-ChildItem "C:\Windows\Microsoft.NET\Framework\v4*\csc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $csc) { Write-Error "No C# compiler (csc.exe) found. Install the .NET Framework 4.x."; exit 1 }

$dir = $PSScriptRoot

# ensure the app icon exists (the 2x2 grid badge)
if (-not (Test-Path "$dir\badge.ico")) {
  powershell -ExecutionPolicy Bypass -File "$dir\gen-tray-icon.ps1"
}
$cscArgs = @('/nologo', '/target:winexe',
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Management.dll')
if (Test-Path "$dir\badge.ico") { $cscArgs += "/win32icon:$dir\badge.ico" }
$cscArgs += "/out:$dir\AgentBrowsers.exe"
$cscArgs += "$dir\AgentBrowsersTray.cs"

& $csc.FullName $cscArgs

if ($LASTEXITCODE -eq 0) {
  Write-Host "Built $dir\AgentBrowsers.exe"
  Write-Host "Run it now:  Start-Process `"$dir\AgentBrowsers.exe`""
  Write-Host "Auto-start at logon: put a .vbs in shell:startup that launches the exe (see README)."
} else {
  Write-Error "Build failed (exit $LASTEXITCODE)"
}
