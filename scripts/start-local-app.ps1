param([int]$Port = 3107)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mutex = New-Object System.Threading.Mutex($false, 'Local\TradersAddaLocalServer')
$locked = $false
try {
    $locked = $mutex.WaitOne(0)
    if (!$locked) { Write-Output 'Traders Adda launcher is already running.'; exit 0 }
    Set-Location -LiteralPath $root
    if (!(Test-Path -LiteralPath '.next\BUILD_ID')) {
        throw 'Production build missing. Run npm run build before starting the scheduled task.'
    }
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 15
        if ($health.app -eq 'traders-adda') {
            Write-Output "Traders Adda is already running on port $Port."
            exit 0
        }
        throw "Port $Port is occupied by another application; no process was stopped."
    }
    $logDir = Join-Path $root '.cache\startup'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $node = (Get-Command node -ErrorAction Stop).Source
    $process = Start-Process -FilePath $node -ArgumentList @(
        '--use-system-ca', 'node_modules\next\dist\bin\next', 'start', '-p', "$Port", '-H', '127.0.0.1'
    ) -WorkingDirectory $root -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $logDir "$stamp.stdout.log") `
        -RedirectStandardError (Join-Path $logDir "$stamp.stderr.log")
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Traders Adda exited with code $($process.ExitCode). See $logDir." }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
