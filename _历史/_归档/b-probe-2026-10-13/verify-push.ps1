# ASCII-only: verifies the pushed commit's tree contains all 7 files with the expected blob shas.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$tok = (Get-Content -LiteralPath (Join-Path $env:TEMP '_ghpat.txt') -Raw).Trim()
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'dsh' }
$api = 'https://api.github.com/repos/juice-butterfly/rainproof'
$paths = [IO.File]::ReadAllLines((Join-Path $here 'push-b1b5-files.txt'), [Text.Encoding]::UTF8) | Where-Object { $_.Trim().Length -gt 0 }

$ref = Invoke-RestMethod -Uri ($api + '/git/ref/heads/main') -Headers $H
$sha = $ref.object.sha
$commit = Invoke-RestMethod -Uri ($api + '/git/commits/' + $sha) -Headers $H
Write-Host ('main = ' + $sha)
Write-Host ('message = ' + ($commit.message -split "`n")[0])
Write-Host ('tree = ' + $commit.tree.sha + '  parent = ' + $commit.parents[0].sha + '  files in tree = ' + $commit.tree.sha)
$tree = Invoke-RestMethod -Uri ($api + '/git/trees/' + $commit.tree.sha + '?recursive=1') -Headers $H
Write-Host ('tree entries (recursive) = ' + $tree.tree.Count + '  truncated = ' + $tree.truncated)
$want = @{}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $here 'blobs.txt'), [Text.Encoding]::UTF8)) {
  if ($line.Trim()) { $kv = $line.Split(' '); $want[$kv[1]] = $kv[0] }
}
$missing = 0
foreach ($p in $paths) {
  $node = $tree.tree | Where-Object { $_.path -eq $p }
  if (-not $node) { Write-Host ('  MISSING  ' + $p); $missing++; continue }
  $expect = $want[$p]
  $mark = if ($expect -and $node.sha -eq $expect) { 'OK      ' } elseif ($expect) { 'DIFFERS ' } else { 'present ' }
  if ($mark -eq 'DIFFERS ') { $missing++ }
  Write-Host ('  ' + $mark + $node.sha.Substring(0, 10) + '  ' + $p)
}
Write-Host ('VERIFY ' + $(if ($missing) { 'FAILED (' + $missing + ')' } else { 'PASSED' }))
