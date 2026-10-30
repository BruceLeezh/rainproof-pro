
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\lenovo\Desktop\汉客松\雨证\04-脚本\_silent'
$map = @{
  'RainProof-Feed'      = 'feed.vbs'
  'RainProof-Keeper-V6' = 'keeper.vbs'
  'RainProof-OpsDaily'  = 'opsdaily.vbs'
}
foreach ($name in $map.Keys) {
  $vbs = Join-Path $root $map[$name]
  if (-not (Test-Path -LiteralPath $vbs)) { throw "缺少 $vbs" }
  $t = Get-ScheduledTask -TaskName $name
  $arg = '"' + $vbs + '"'
  $a = New-ScheduledTaskAction -Execute 'C:\Windows\System32\wscript.exe' -Argument $arg
  Set-ScheduledTask -TaskName $name -Action $a | Out-Null
  $t2 = Get-ScheduledTask -TaskName $name
  $ok = ($t2.Actions[0].Arguments -eq $arg)
  Write-Output ("{0} | 动作匹配={1} | {2}" -f $name, $ok, $t2.Actions[0].Arguments)
}
Write-Output '--- 自检：动作里不得再出现 雨证·Rainproof ---'
foreach ($name in $map.Keys) {
  $a = (Get-ScheduledTask -TaskName $name).Actions[0].Arguments
  if ($a -like '*雨证·Rainproof*') { Write-Output ("BAD " + $name) } else { Write-Output ("OK  " + $name) }
}
