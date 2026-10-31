<#
.SYNOPSIS
  Keeps this PC from going to sleep until a clock time (default 15:30 local, the NSE close), then lets it sleep again.
  Started by the 'Traders Adda Keep Awake' task at 08:40 on weekdays. Does not change any power setting; it only
  asks Windows not to idle-sleep while this script runs. Closing the lid or a forced policy sleep can still sleep the PC.
#>
param([string]$Until = '15:30')
$ErrorActionPreference = 'Stop'
$end = [datetime]::Today.Add([TimeSpan]::Parse($Until))
if ((Get-Date) -ge $end) { return }
Add-Type -Namespace Native -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
[void][Native.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)
try {
    while ((Get-Date) -lt $end) { Start-Sleep -Seconds 30 }
} finally {
    [void][Native.Power]::SetThreadExecutionState($ES_CONTINUOUS)
}
