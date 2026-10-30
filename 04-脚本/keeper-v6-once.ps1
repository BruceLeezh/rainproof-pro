# keeper-v6-once.ps1 —— 计划任务 RainProof-Keeper-V6 的一轮包装（每 30 分钟一次）
# 为什么不让 PowerShell 抓输出再写盘：
#   ① 抓取要把 node 的 UTF-8 字节按控制台代码页(cp936)解码 → 中文日志变「鍚姩」乱码；
#   ② 抓取会把整轮输出缓冲到进程退出，任务被杀（如 10-29 09:45 那次 ^C）时一个字都不落盘。
# 改为 cmd 层重定向：node 的字节直接落盘，两个毛病一起没有。
$ErrorActionPreference = "Continue"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$log    = Join-Path $scriptRoot '..\02-作战与答辩\V6-keeper.log'
$keeper = Join-Path $scriptRoot 'keeper.js'

# 守卫：.ps1 若被存成「无 BOM 的 UTF-8」，Windows PowerShell 5.1 会按 GBK 解码，中文目录名读坏，
# 日志就被写进别处的乱码文件名里，还不报错。这里直接失败，不静默产垃圾。
if (-not (Test-Path -LiteralPath (Split-Path $log))) { Write-Host "❌ 日志目录不存在：{0}（.ps1 可能丢了 UTF-8 BOM）" -f (Split-Path $log); exit 3 }
$stamp  = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# 表头单独写，明确 UTF-8 无 BOM，避免每次 append 又叠一个 BOM
[IO.File]::AppendAllText($log, "`n===== $stamp 轮询开始 =====`n", (New-Object System.Text.UTF8Encoding($false)))

$line = 'node "{0}" --v6 --once --settle >> "{1}" 2>&1' -f $keeper, $log
cmd /c $line
exit $LASTEXITCODE