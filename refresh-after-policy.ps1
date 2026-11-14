# 有新保单进来之后，把对外材料里的数字一次性对齐。
#
# 为什么要它：第三张保单落地后，池子余额、保费合计、保单张数、结清/在保拆分
# 全变，而四处引用（两份 deck、README、执行卡）任何一处漏改，都是一句当着评委
# 说的话对不上屏幕。
#
# 什么时候跑：第三张保单买完立刻跑一次（计划 2026-11-14 晚），
# 11-16 早上如果又买了新单，也跑一次。

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Say($n, $msg) {
  Write-Host ""
  Write-Host "[$n/5] $msg" -ForegroundColor Cyan
}

Say 1 "按链上实测回写池子/保单数字（两份 deck、README、执行卡）"
& python "07-测试工具\update-chain-numbers.py"
if ($LASTEXITCODE -ne 0) { throw "步骤 1 失败：update-chain-numbers.py" }

Say 2 "重导两份 deck 为 PDF（PowerPoint COM）"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "07-测试工具\export-deck-pdf-1113.ps1"
if ($LASTEXITCODE -ne 0) { throw "步骤 2 失败：export-deck-pdf-1113.ps1" }

Say 3 "抓一份新的只读链上快照"
& node "12-开发归档\2026-11-05-待办收口\只读保单快照.js"
if ($LASTEXITCODE -ne 0) { throw "步骤 3 失败：只读保单快照.js" }

Say 4 "重建断网包（zip + 离线验收）"
& python "07-测试工具\生成断网备份-1113.py"
if ($LASTEXITCODE -ne 0) { throw "步骤 4 失败：生成断网备份-1113.py" }

Say 5 "刷新上台读数卡"
Push-Location "04-脚本"
try {
  & node "..\07-测试工具\stage-card.js" --write
  if ($LASTEXITCODE -ne 0) { throw "步骤 5 失败：stage-card.js" }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "全部完成。接着跑一次 morning-check.bat 确认七区划都可投。" -ForegroundColor Green
