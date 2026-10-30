[CmdletBinding()]
param([switch]$OpenBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\Users\lenovo\Desktop\汉客松\雨证·Rainproof'
$siteRoot = Join-Path $projectRoot 'site-dist'
$previewUrl = 'http://127.0.0.1:8096/'
$expectedContract = (Get-Content -LiteralPath (Join-Path $projectRoot 'deployment.json') -Raw -Encoding UTF8 | ConvertFrom-Json).contract

function Get-PreviewText([string]$RelativePath) {
    $request = [System.Net.HttpWebRequest]::Create($previewUrl + $RelativePath)
    $request.Proxy = $null
    $request.Timeout = 1500
    $response = $null
    $reader = $null
    try {
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        return $reader.ReadToEnd()
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Dispose() }
    }
}

function Test-V6Preview {
    try {
        $config = Get-PreviewText 'deployment.js'
        $index = Get-PreviewText ''
        return ($config.Contains($expectedContract) -and $index.Contains('index-v6.html'))
    } catch { return $false }
}

if (-not (Test-V6Preview)) {
    $listener = Get-NetTCPConnection -LocalPort 8096 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 8096 is already used by another service. It was left running.' }

    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    & $nodePath (Join-Path $projectRoot '07-测试工具\build-site.js')
    if ($LASTEXITCODE -ne 0) { throw 'Site build failed.' }
    if (-not (Test-Path -LiteralPath (Join-Path $siteRoot 'index.html'))) { throw 'Built index.html was not found.' }

    $pythonLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($pythonLauncher) {
        $pythonPath = (& $pythonLauncher.Source -3 -c 'import sys; print(sys.executable)' | Select-Object -Last 1)
        if ($LASTEXITCODE -ne 0) { throw 'Python 3 was not found.' }
    } else {
        $pythonPath = (Get-Command python.exe -ErrorAction Stop).Source
    }

    $arguments = @('-u', '-m', 'http.server', '8096', '--bind', '127.0.0.1', '--directory', ('"' + $siteRoot + '"'))
    $server = Start-Process -FilePath $pythonPath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'preview.stdout.log') -RedirectStandardError (Join-Path $PSScriptRoot 'preview.stderr.log')
    $healthy = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        if (Test-V6Preview) { $healthy = $true; break }
        if ($server.HasExited) { break }
    }
    if (-not $healthy) { throw 'Preview did not become ready. See preview.stderr.log in this folder.' }
    @{ url = $previewUrl; pid = $server.Id; siteRoot = $siteRoot; startedAt = [DateTimeOffset]::Now.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'preview-process.json') -Encoding UTF8
}

Write-Host ('V6 preview ready: ' + $previewUrl)
if ($OpenBrowser) { Start-Process $previewUrl }
