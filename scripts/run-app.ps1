<#
.SYNOPSIS
  Manually start, stop, rebuild or check Traders Adda (http://localhost:3107).

.EXAMPLE
  .\scripts\run-app.ps1            # start (builds first if no build exists)
  .\scripts\run-app.ps1 rebuild    # stop, npm run build, start (after code changes)
  .\scripts\run-app.ps1 stop
  .\scripts\run-app.ps1 status
  .\scripts\run-app.ps1 dev        # development mode with hot reload (port 3000, foreground)
#>
param(
    [ValidateSet('start', 'stop', 'restart', 'rebuild', 'status', 'dev')]
    [string]$Action = 'start',
    [int]$Port = 3107
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$task = 'Traders Adda Local Startup'
Set-Location -LiteralPath $root

function Get-AppProcess {
    $pid_ = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
    if (!$pid_) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid_"
    [pscustomobject]@{ Id = $pid_; IsNext = ($proc.CommandLine -match 'next.*start') }
}

function Show-Status {
    $app = Get-AppProcess
    if (!$app) { Write-Host "Traders Adda is NOT running on port $Port." -ForegroundColor Yellow; return }
    try {
        $fyers = Invoke-RestMethod "http://localhost:$Port/api/fyers/status" -TimeoutSec 15
        $login = if ($fyers.connected) { 'connected' } else { 'NOT connected - log in at http://localhost:' + $Port + '/api/fyers/login' }
        Write-Host "Traders Adda is running: http://localhost:$Port (PID $($app.Id)). Fyers: $login" -ForegroundColor Green
    } catch {
        Write-Host "Port $Port is in use (PID $($app.Id)) but the app is not answering yet." -ForegroundColor Yellow
    }
}

function Stop-App {
    $state = (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue).State
    if ($state -eq 'Running') { Stop-ScheduledTask -TaskName $task }
    $app = Get-AppProcess
    if ($app -and !$app.IsNext) { throw "Port $Port is used by another program (PID $($app.Id)); not stopping it." }
    if ($app) { Stop-Process -Id $app.Id -Force; Write-Host "Stopped Traders Adda (PID $($app.Id))." }
    else { Write-Host 'Traders Adda was not running.' }
}

function Start-App {
    if (Get-AppProcess) { Show-Status; return }
    if (!(Test-Path '.next\BUILD_ID')) { Write-Host 'No production build found, building (2-4 min)...'; npm run build; if ($LASTEXITCODE) { throw 'Build failed.' } }
    if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
        Start-ScheduledTask -TaskName $task
    } else {
        Start-Process powershell -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-File', (Join-Path $PSScriptRoot 'start-local-app.ps1'), '-Port', $Port) -WindowStyle Hidden
    }
    Write-Host 'Starting...'
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep 3
        try { Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 5 | Out-Null; break } catch { }
    }
    Show-Status
    Write-Host 'Logs: .cache\startup\'
}

switch ($Action) {
    'start'   { Start-App }
    'stop'    { Stop-App }
    'restart' { Stop-App; Start-App }
    'rebuild' { Stop-App; npm run build; if ($LASTEXITCODE) { throw 'Build failed; app left stopped.' }; Start-App }
    'status'  { Show-Status }
    'dev'     { Write-Host 'Dev mode on http://localhost:3000 (Ctrl+C to stop).'; $env:NODE_OPTIONS = '--use-system-ca'; npm run dev }
}
