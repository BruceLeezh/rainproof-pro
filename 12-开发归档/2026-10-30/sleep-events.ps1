# 查 2026-10-29 夜间到 10-30 上午的睡眠/唤醒事件，用来确认喂价停摆是不是「机器睡了」。
$ev = Get-WinEvent -FilterHashtable @{LogName='System'; Id=42,107,1} -MaxEvents 40 -ErrorAction SilentlyContinue |
      Where-Object { $_.TimeCreated -gt (Get-Date "2026-10-29 20:00") }
foreach ($e in $ev) {
  $tag = switch ($e.Id) { 42 {"睡眠"} 107 {"唤醒"} 1 {"启动"} default {"$($e.Id)"} }
  "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f $e.TimeCreated, $tag
}