$ErrorActionPreference = 'Stop'
if ([TimeZoneInfo]::Local.Id -ne 'India Standard Time') {
    throw 'This schedule requires Windows timezone India Standard Time (08:45 IST). No task was installed.'
}
$name = 'Traders Adda Local Startup'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    throw "Task '$name' already exists. Inspect it before replacing it."
}
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$launcher = Join-Path $PSScriptRoot 'start-local-app.ps1'
$root = Split-Path -Parent $PSScriptRoot
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -NonInteractive -File `"$launcher`"" -WorkingDirectory $root
$triggers = @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:45'),
    (New-ScheduledTaskTrigger -AtLogOn -User $user)
)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings `
    -Principal $principal -Description 'Local-only Traders Adda: weekdays 08:45 IST and user login. No wake timer, elevated rights or public access.' | Out-Null
Write-Output "Installed '$name'. Runs while this user is logged in; no password or elevation stored."
