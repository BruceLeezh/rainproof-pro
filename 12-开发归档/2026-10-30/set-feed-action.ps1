# Feed task: fund confirm wallets first, then feed. `&` (not &&): a funding
# failure must not stop the feed round.
# 2026-10-30：任务动作改为 wscript + _silent\feed.vbs 隐藏窗口运行，避免桌面弹 cmd 黑框。
# 业务命令串（工作目录、node 参数、日志重定向）已全部搬进 feed.vbs，此处只登记入口。
# 不要再把 -Execute "cmd" 写回来，否则每次 :15/:45 都会弹可见控制台窗口。
$ErrorActionPreference = "Stop"
$base = "C:\Users\lenovo\Desktop\汉客松\雨证·Rainproof"
$entry = Join-Path $base "04-脚本\_silent\feed.vbs"

Set-ScheduledTask -TaskName "RainProof-Feed" -Action (New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument "`"$entry`"") | Out-Null

$a = (Get-ScheduledTask -TaskName "RainProof-Feed").Actions[0]
Write-Output "execute      : $($a.Execute)"
Write-Output "arguments    : $($a.Arguments)"
Write-Output "entry exists : $(Test-Path -LiteralPath $entry)"
Write-Output "next run     : $((Get-ScheduledTaskInfo -TaskName 'RainProof-Feed').NextRunTime)"
