# Stops leftover DevMind bun processes so a new API/worker can bind 8080/8081.
# Needed on Windows: bun --watch + a custom SIGINT handler often leaves the
# previous process alive after the terminal is closed (see bun#32400).

$ports = @(8080, 8081, 3000)
$killed = @{}

foreach ($port in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $procId = $c.OwningProcess
    if ($procId -and -not $killed.ContainsKey($procId)) {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      Write-Host "killing PID $procId ($($proc.ProcessName)) on port $port"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      $killed[$procId] = $true
    }
  }
}

# Catch bun --watch children that dropped the port but kept a BullMQ connection.
Get-CimInstance Win32_Process -Filter "Name='bun.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "apps\\(api|worker)|dev:api|dev:worker|devmind" } |
  ForEach-Object {
    if (-not $killed.ContainsKey($_.ProcessId)) {
      Write-Host "killing leftover bun PID $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      $killed[$_.ProcessId] = $true
    }
  }

if ($killed.Count -eq 0) {
  Write-Host "nothing to kill — 8080/8081/3000 are free"
} else {
  Write-Host "killed $($killed.Count) process(es)"
}
