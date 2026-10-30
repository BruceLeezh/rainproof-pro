$log = "Microsoft-Windows-TaskScheduler/Operational"
Get-WinEvent -LogName $log -MaxEvents 600 -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -like "*RainProof-Feed*" -and $_.TimeCreated -gt (Get-Date "2026-10-29 22:00") } |
  Sort-Object TimeCreated |
  ForEach-Object { "{0:HH:mm:ss}  id={1}  {2}" -f $_.TimeCreated, $_.Id, (($_.Message -split "`n")[0]) } |
  Select-Object -Last 24