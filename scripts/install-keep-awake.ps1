<#
.SYNOPSIS
  Installs the 'Traders Adda Keep Awake' scheduled task: on weekdays at 08:40 it wakes this PC from sleep or hibernate
  (if Windows allows wake timers) and keeps it awake until 15:30. Runs as you, only while you are logged in, with no
  password stored and no elevation. Remove it with: Unregister-ScheduledTask -TaskName 'Traders Adda Keep Awake' -Confirm:$false
.NOTES
  Wake timers must be allowed in your power plan; on battery power they are often off, so keep the laptop plugged in.
  A PC that is fully shut down cannot be woken by a task.
#>
$ErrorActionPreference = 'Stop'
if ([TimeZoneInfo]::Local.Id -ne 'India Standard Time') { throw 'This schedule needs the Windows timezone India Standard Time (08:40 IST). No task was installed.' }
$name = 'Traders Adda Keep Awake'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$script = Join-Path $PSScriptRoot 'keep-awake.ps1'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$script`" -Until 15:30" -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:40'
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 7)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Wakes this PC at 08:40 IST on weekdays and keeps it awake until 15:30 for Traders Adda live quotes, paper trading and the 09:00 email.' | Out-Null
Write-Output "Installed '$name': weekdays 08:40 IST (wake from sleep) until 15:30. Next run: $((Get-ScheduledTaskInfo -TaskName $name).NextRunTime)"
