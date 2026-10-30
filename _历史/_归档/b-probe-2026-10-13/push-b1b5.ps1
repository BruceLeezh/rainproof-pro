# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI, so Chinese literals
# would be mangled. All Chinese lives in UTF-8 data files: push-b1b5-files.txt / commit-msg-b1b5.txt
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$repo = Join-Path $root 'rainproof'
$tok = (Get-Content -LiteralPath (Join-Path $env:TEMP '_ghpat.txt') -Raw).Trim()
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'dsh' }
$paths = [IO.File]::ReadAllLines((Join-Path $here 'push-b1b5-files.txt'), [Text.Encoding]::UTF8) | Where-Object { $_.Trim().Length -gt 0 }
$msg = [IO.File]::ReadAllText((Join-Path $here 'commit-msg-b1b5.txt'), [Text.Encoding]::UTF8)
$api = 'https://api.github.com/repos/juice-butterfly/rainproof'
$expectedParent = '71909512123c09a1fc83d995f18e753c304acbda'

function Api($method, $uri, $bodyObj) {
  if ($null -ne $bodyObj) {
    $json = $bodyObj | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    Invoke-RestMethod -Method $method -Uri $uri -Headers $H -Body $bytes -ContentType 'application/json; charset=utf-8'
  } else {
    Invoke-RestMethod -Method $method -Uri $uri -Headers $H
  }
}

$ref = Api 'GET' ($api + '/git/ref/heads/main') $null
$parent = $ref.object.sha
Write-Host ('remote main parent = ' + $parent)
if ($parent -ne $expectedParent) { throw ('ABORT: remote main moved (got ' + $parent + ', expected ' + $expectedParent + ') - re-merge before pushing') }
$pcommit = Api 'GET' ($api + '/git/commits/' + $parent) $null
$baseTree = $pcommit.tree.sha

$entries = @()
foreach ($p in $paths) {
  $full = Join-Path $repo ($p -replace '/', '\')
  $text = [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8) -replace "`r`n", "`n"
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))
  $blob = Api 'POST' ($api + '/git/blobs') @{ content = $b64; encoding = 'base64' }
  $local = ''
  try { $local = (& git -C $repo rev-parse ('HEAD:' + $p) 2>$null).Trim() } catch { $local = '' }
  $verdict = if ($local -eq '') { 'no-local-ref' } elseif ($blob.sha -eq $local) { 'OK' } else { 'MISMATCH' }
  Write-Host ('  ' + $blob.sha.Substring(0, 10) + '  ' + $verdict + '  ' + $p)
  if ($verdict -eq 'MISMATCH') { throw ('ABORT: blob content differs from local commit HEAD for ' + $p + ' (api ' + $blob.sha + ' vs local ' + $local + ')') }
  $entries += @{ path = $p; mode = '100644'; type = 'blob'; sha = $blob.sha }
}

$tree = Api 'POST' ($api + '/git/trees') @{ base_tree = $baseTree; tree = $entries }
Write-Host ('new tree   = ' + $tree.sha)
$newCommit = Api 'POST' ($api + '/git/commits') @{ message = $msg; tree = $tree.sha; parents = @($parent) }
Write-Host ('new commit = ' + $newCommit.sha)
$res = Api 'PATCH' ($api + '/git/refs/heads/main') @{ sha = $newCommit.sha; force = $false }
Write-Host ('ref updated -> ' + $res.object.sha)

# verify: read back the commit and confirm every path points at the blob we uploaded
$chk = Api 'GET' ($api + '/git/commits/' + $newCommit.sha) $null
$treeFull = Api 'GET' ($api + '/git/trees/' + $chk.tree.sha) $null
foreach ($p in $paths) {
  $node = $treeFull.tree | Where-Object { $_.path -eq (($p -split '/')[-1]) }
  Write-Host ('  verify ' + $p + ' -> ' + ($(if ($node) { $node.sha } else { 'MISSING' })))
}
Write-Host ('DONE new main = ' + $newCommit.sha)
