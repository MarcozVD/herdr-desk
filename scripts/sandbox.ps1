param([ValidateSet('start','stop','status')][string]$Action = 'status',
      [string]$Session = 'herdr-desk-dev')
$ErrorActionPreference = 'Stop'
Get-ChildItem Env: | Where-Object { $_.Name -like 'HERDR_*' } | ForEach-Object { Remove-Item -Path ("Env:" + $_.Name) }
$herdr = (Get-Command herdr).Source
switch ($Action) {
  'start' {
    Start-Process -FilePath $herdr -ArgumentList @('--session', $Session, 'server') -WindowStyle Hidden
    for ($i = 0; $i -lt 50; $i++) {
      $s = (& $herdr session list --json | ConvertFrom-Json).sessions | Where-Object { $_.name -eq $Session -and $_.running }
      if ($s) { "ready $Session $($s.socket_path)"; exit 0 }
      Start-Sleep -Milliseconds 100
    }
    throw "sandbox $Session no arranco"
  }
  'stop'   { & $herdr session stop $Session --json; & $herdr session delete $Session --json }
  'status' { & $herdr session list --json }
}
