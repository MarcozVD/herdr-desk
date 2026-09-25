param([string]$Exe = "target\debug\herdr-desk.exe",
      [string]$Session = 'herdr-desk-dev',
      [int]$TimeoutSec = 15)
$ErrorActionPreference = 'Stop'

# No heredar HERDR_*: la sesion se elige explicitamente (D10)
Get-ChildItem Env: | Where-Object { $_.Name -like 'HERDR_*' } | ForEach-Object { Remove-Item -Path ("Env:" + $_.Name) }
$env:HERDR_DESK_SESSION = $Session

$exePath = (Resolve-Path $Exe).Path
Get-Process herdr-desk -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force; Start-Sleep -Milliseconds 500 }

$log = Join-Path $env:TEMP "herdr-desk-smoke-$PID.log"
$err = Join-Path $env:TEMP "herdr-desk-smoke-$PID.err.log"
Remove-Item $log, $err -ErrorAction SilentlyContinue

$p = Start-Process -FilePath $exePath -RedirectStandardOutput $log -RedirectStandardError $err -PassThru -WindowStyle Hidden
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
$readyLine = $null

try {
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($p.HasExited) { throw "herdr-desk salio antes de estar ready (exit=$($p.ExitCode))" }
    if (Test-Path $log) {
      $readyLine = (Get-Content $log -ErrorAction SilentlyContinue) | Where-Object { $_ -match '\[herdr-desk\] ready' } | Select-Object -First 1
      if ($readyLine) { break }
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $readyLine) {
    throw "timeout: no llego la linea ready en $TimeoutSec s"
  }
  Write-Output $readyLine
  Write-Output "SMOKE OK"
} finally {
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
