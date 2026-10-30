# ops-daily.ps1 —— 雨证本地每日例检（G19：替代已停用的 GitHub Actions CI）
# 干三件事：① 门禁全量回归（npm test）② 链上健康巡检（notify.js，异常码 2）③ 喂价轮询干跑（记录决策与留痕）
# 输出追加到 ..\02-作战与答辩\自动完善-定时日志.txt（只追加，不覆盖）
# 任务动作（2026-10-30 起）：wscript.exe "..\04-脚本\_silent\opsdaily.vbs"，隐藏窗口运行。
#   本 .ps1 只放业务逻辑，不要再把 powershell.exe 直接登记成任务动作 —— 那样每天 09:00 会弹控制台窗口。
# 重建任务（每天 09:00，失败不重试、错过下次再跑）：
#   $a = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument '"C:\Users\lenovo\Desktop\汉客松\雨证\04-脚本\_silent\opsdaily.vbs"'
#   $t = New-ScheduledTaskTrigger -Daily -At 09:00
#   Register-ScheduledTask -TaskName "RainProof-OpsDaily" -Action $a -Trigger $t
# 卸载：Unregister-ScheduledTask -TaskName "RainProof-OpsDaily" -Confirm:$false
# 查看：Get-ScheduledTask -TaskName "RainProof-OpsDaily" | Get-ScheduledTaskInfo

$ErrorActionPreference = "Continue"
# 子系统（node / npm test）的输出是 UTF-8，而 PowerShell 默认按控制台代码页(cp936)解码，
# 中文会变成「鍚姩」那类乱码。这一行让下面所有 `& cmd /c "..."` 的抓取按 UTF-8 解码。
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log  = Join-Path $root "..\02-作战与答辩\自动完善-定时日志.txt"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# 守卫：.ps1 若被存成「无 BOM 的 UTF-8」，Windows PowerShell 5.1 会按 GBK 解码，中文目录名读坏，
# 日志就被写进别处的乱码文件名里，还不报错。这里直接失败，不静默产垃圾。
if (-not (Test-Path -LiteralPath (Split-Path $log))) { Write-Host "❌ 日志目录不存在：{0}（.ps1 可能丢了 UTF-8 BOM）" -f (Split-Path $log); exit 3 }

"===== $stamp 例检开始 =====" | Add-Content -Path $log -Encoding UTF8

# ① 门禁（全量）
Push-Location (Join-Path $root "..\07-测试工具")
$gate = & cmd /c "npm test 2>&1" | Select-Object -Last 6
$gateExit = $LASTEXITCODE
$gate | Add-Content -Path $log -Encoding UTF8
$gateRed = ($gateExit -ne 0)
Pop-Location

# ② 巡检（异常退出码 2）—— 窗口 60000 块（约 2 天）：500 块会让事件摘要永远为空，把「没扫到」误当「没发生」
$notify = & cmd /c "node `"$root\notify.js`" --blocks 60000 2>&1"
$notify | Add-Content -Path $log -Encoding UTF8
$notifyBad = ($LASTEXITCODE -ne 0)

# ③ 喂价干跑（决策+留痕；--send 才会上链，本例检永不带）
$feed = & cmd /c "node `"$root\push-rainfall-v6.js`" 2>&1" | Select-Object -Last 10
$feed | Add-Content -Path $log -Encoding UTF8

$feedBad = ($LASTEXITCODE -ne 0)
$verdict = if ($gateRed -or $notifyBad -or $feedBad) { "⚠ 存在异常（门禁红或巡检告警）——按《运营手册》§六应急处理" } else { "✅ 全部正常" }
"----- 例检结论：$verdict" | Add-Content -Path $log -Encoding UTF8
if ($gateRed -or $notifyBad -or $feedBad) { exit 2 } else { exit 0 }
