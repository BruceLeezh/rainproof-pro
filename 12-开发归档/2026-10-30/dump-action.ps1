$a = (Get-ScheduledTask -TaskName "RainProof-Feed").Actions[0].Arguments
"len=" + $a.Length
$bad = 0
for ($i = 0; $i -lt $a.Length; $i++) { if ([int]$a[$i] -gt 255) { $bad++ } }
"chars above U+00FF: " + $bad
"first 60 codepoints: " + (($a.Substring(0, [Math]::Min(60, $a.Length)).ToCharArray() | ForEach-Object { "U+{0:X4}" -f [int]$_ }) -join " ")