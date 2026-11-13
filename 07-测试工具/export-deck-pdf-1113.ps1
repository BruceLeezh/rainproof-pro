# 用 PowerPoint COM 把两份 deck 导出 PDF（2026-11-13）
$ErrorActionPreference = "Stop"
$base = "C:\Users\lenovo\Desktop\雨证\01-参赛材料\交付物\PPT"
$jobs = @(
  @{ src = "$base\神麻组-雨证-路演PPT-答辩版-2026-10-28.pptx"; out = "$base\雨证-V6-T1-答辩版-33页-2026-11-13.pdf" },
  @{ src = "$base\神麻组-雨证-路演PPT-精简版-2026-10-30.pptx"; out = "$base\雨证-V6-T1-精简版-15页-2026-11-13.pdf" }
)
$app = New-Object -ComObject PowerPoint.Application
foreach ($j in $jobs) {
  if (Test-Path $j.out) { Remove-Item $j.out -Force }
  $pres = $app.Presentations.Open($j.src, $true, $false, $false)
  $pres.SaveAs($j.out, 32)
  $pres.Close()
  Write-Output ("OK  " + (Split-Path $j.out -Leaf) + "  " + (Get-Item $j.out).Length + " bytes")
}
$app.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
