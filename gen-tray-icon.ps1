# Generates badge.ico (the AgentBrowsers.exe icon) — a dark rounded square with a 2x2
# grid of phosphor-green tiles, matching the tray icon drawn in AgentBrowsersTray.cs.
# Also writes badge-preview.png if -Preview is passed.
param([switch]$Preview)
Add-Type -AssemblyName System.Drawing

function New-Badge([int]$N) {
  $sc  = $N / 32.0
  $bmp = New-Object Drawing.Bitmap $N, $N
  $g   = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([Drawing.Color]::Transparent)

  function RR($x, $y, $w, $h, $rad) {
    $p = New-Object Drawing.Drawing2D.GraphicsPath
    $d = $rad * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure(); $p
  }

  $bg = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 18, 21, 28))
  $g.FillPath($bg, (RR (1 * $sc) (1 * $sc) (30 * $sc) (30 * $sc) (5 * $sc)))

  $tile = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(62, 207, 142))
  $s = 11 * $sc; $gap = 2 * $sc; $x0 = 4 * $sc; $y0 = 4 * $sc
  for ($r = 0; $r -lt 2; $r++) {
    for ($c = 0; $c -lt 2; $c++) {
      $g.FillPath($tile, (RR ($x0 + $c * ($s + $gap)) ($y0 + $r * ($s + $gap)) $s $s (2 * $sc)))
    }
  }
  $g.Dispose(); $bmp
}

$dir = $PSScriptRoot

# 32px PNG wrapped in an .ico (PNG-in-ICO; supported Vista+)
$ic  = New-Badge 32
$ms  = New-Object IO.MemoryStream
$ic.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$out = New-Object IO.MemoryStream
$bw  = New-Object IO.BinaryWriter($out)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)     # reserved, type=icon, count
$bw.Write([byte]32); $bw.Write([byte]32); $bw.Write([byte]0); $bw.Write([byte]0)  # w,h,palette,reserved
$bw.Write([uint16]1); $bw.Write([uint16]32)                          # planes, bpp
$bw.Write([uint32]$png.Length); $bw.Write([uint32]22)                # size, offset
$bw.Write($png); $bw.Flush()
[IO.File]::WriteAllBytes("$dir\badge.ico", $out.ToArray())
Write-Host "Wrote $dir\badge.ico"

if ($Preview) {
  (New-Badge 256).Save("$dir\badge-preview.png", [Drawing.Imaging.ImageFormat]::Png)
  Write-Host "Wrote $dir\badge-preview.png"
}
