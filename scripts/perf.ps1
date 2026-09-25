param([string]$Exe = "target\debug\herdr-desk.exe",
      [string]$Session = 'herdr-desk-dev',
      [int]$TimeoutSec = 20,
      [int]$IdleSampleSec = 30)
$ErrorActionPreference = 'Stop'

# No heredar HERDR_*: la sesion se elige explicitamente (D10)
Get-ChildItem Env: | Where-Object { $_.Name -like 'HERDR_*' } | ForEach-Object { Remove-Item -Path ("Env:" + $_.Name) }
$env:HERDR_DESK_SESSION = $Session

$exePath = (Resolve-Path $Exe).Path
Get-Process herdr-desk -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force; Start-Sleep -Milliseconds 500 }

$log = Join-Path $env:TEMP "herdr-desk-perf-$PID.log"
$err = Join-Path $env:TEMP "herdr-desk-perf-$PID.err.log"
Remove-Item $log, $err -ErrorAction SilentlyContinue

function Get-TreeIds([int]$RootId) {
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootId)
  $queue = [System.Collections.Generic.Queue[int]]::new()
  $queue.Enqueue($RootId)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$current" -ErrorAction SilentlyContinue
    foreach ($c in $children) {
      if ($ids.Add([int]$c.ProcessId)) { $queue.Enqueue([int]$c.ProcessId) }
    }
  }
  return @($ids)
}

$boot = [System.Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $exePath -RedirectStandardOutput $log -RedirectStandardError $err -PassThru -WindowStyle Hidden

try {
  # 1) tail del log hasta ready
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
  $readyLine = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($p.HasExited) { throw "herdr-desk salio antes de estar ready" }
  if (Test-Path $log) {
    [string]$readyLine = ((Get-Content $log -ErrorAction SilentlyContinue) | Where-Object { $_ -match '\[herdr-desk\] ready' } | Select-Object -First 1)
    if ($readyLine) { break }
  }
    Start-Sleep -Milliseconds 50
  }
  if (-not $readyLine) { throw "timeout sin ready en $TimeoutSec s" }
  $bootMs = $boot.ElapsedMilliseconds

  # 2) esperar 5 s y sumar memoria privada del arbol (exe + WebView2)
  Start-Sleep -Seconds 5
  $ids = Get-TreeIds $p.Id
  $tree = Get-Process -Id $ids -ErrorAction SilentlyContinue
  $ramMB = [math]::Round((($tree | Measure-Object -Property PrivateMemorySize64 -Sum).Sum / 1MB), 1)
  $webviews = @($tree | Where-Object { $_.ProcessName -like 'msedgewebview2*' }).Count

  # 3) CPU en reposo
  $cpuBefore = ($tree | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Start-Sleep -Seconds $IdleSampleSec
  $sw.Stop()
  $treeNow = Get-Process -Id $ids -ErrorAction SilentlyContinue
  $cpuAfter = ($treeNow | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
  $cpuPct = [math]::Round((100 * ($cpuAfter - $cpuBefore) / $sw.Elapsed.TotalSeconds), 2)

  # 4) JSON
  Write-Output (@{
    exe          = $exePath
    session      = $Session
    boot_ms      = $bootMs
    ready_line   = $readyLine
    ram_private_mb = $ramMB
    webview_processes = $webviews
    idle_cpu_percent_30s = $cpuPct
    build        = if ($exePath -match 'release') { 'release' } else { 'debug' }
  } | ConvertTo-Json -Compress)
} finally {
  if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) {
    $ids = Get-TreeIds $p.Id
    foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  }
}
