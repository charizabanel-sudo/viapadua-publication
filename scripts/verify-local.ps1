param([ValidateRange(1024,65535)][int]$Port = 55441)
$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataPath = Join-Path $projectPath 'tmp\portal-verification\pg-data'
$logPath = Join-Path $projectPath 'tmp\portal-verification\postgres.log'
foreach ($binary in @('initdb','pg_ctl','pg_isready','createdb','psql','npm','node')) {
  if (-not (Get-Command $binary -ErrorAction SilentlyContinue)) { throw "$binary must be on PATH. Install Node 22.13+ and PostgreSQL before running this script." }
}
function Run-Npm([string[]]$Arguments) {
  & npm @Arguments
  if ($LASTEXITCODE -ne 0) { throw "npm $($Arguments -join ' ') failed (exit $LASTEXITCODE)." }
}
$savedEnv = @{}
foreach ($key in @('DATABASE_URL','DIRECT_URL','TEST_DATABASE_URL','BROWSER_EXECUTABLE')) { $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
$startedHere = $false
Push-Location -LiteralPath $projectPath
try {
  & pg_isready -h 127.0.0.1 -p $Port *> $null
  if ($LASTEXITCODE -eq 0) { throw "Port $Port is in use. Choose a free port with -Port; this script will not touch an unknown server." }
  New-Item -ItemType Directory -Force -Path (Split-Path $dataPath) | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))) {
    & initdb -D $dataPath -U viapadua_test -A trust --encoding=UTF8 --no-locale
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the dedicated local test cluster.' }
  }
  & pg_ctl -D $dataPath -l $logPath -o "-h 127.0.0.1 -p $Port" -w start
  if ($LASTEXITCODE -ne 0) { throw "Could not start the test cluster. See $logPath" }
  $startedHere = $true
  $databaseExists = & psql -h 127.0.0.1 -p $Port -U viapadua_test -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname='viapadua_test'"
  if ($LASTEXITCODE -ne 0) { throw 'Could not check the test database.' }
  if ($databaseExists -ne '1') {
    & createdb -h 127.0.0.1 -p $Port -U viapadua_test viapadua_test
    if ($LASTEXITCODE -ne 0) { throw 'Could not create viapadua_test.' }
  }
  # All schema changes and fixture mutations below are restricted to this dedicated local cluster.
  $env:TEST_DATABASE_URL = "postgresql://viapadua_test@127.0.0.1:$Port/viapadua_test"
  $env:DATABASE_URL = $env:TEST_DATABASE_URL
  $env:DIRECT_URL = $env:TEST_DATABASE_URL
  if (-not $env:BROWSER_EXECUTABLE) {
    foreach ($candidateBrowser in @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe','C:\Program Files\Google\Chrome\Application\chrome.exe')) {
      if (Test-Path -LiteralPath $candidateBrowser) { $env:BROWSER_EXECUTABLE = $candidateBrowser; break }
    }
  }
  Run-Npm @('run','check')
  Run-Npm @('run','build')
  Run-Npm @('run','db:migrate')
  Run-Npm @('run','test:db')
  Run-Npm @('run','test:browser')
  Run-Npm @('run','users:audit')
  Write-Output 'All isolated checks passed. No production database was used.'
} finally {
  if ($startedHere) { & pg_ctl -D $dataPath -m fast -w stop }
  foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key,$savedEnv[$key],'Process') }
  Pop-Location
}
