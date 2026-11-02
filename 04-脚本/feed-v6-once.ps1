# One scheduled V6 round. Top-up failure must not prevent the feed attempt.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$scriptRoot = $PSScriptRoot
$logPath = Join-Path $scriptRoot '../02-作战与答辩/自动完善-定时日志.txt'
$utf8 = [Text.UTF8Encoding]::new($false)
function Write-FeedLog([string]$Text) {
    [IO.File]::AppendAllText($logPath, $Text + [Environment]::NewLine, $utf8)
}
function Invoke-LoggedNode([string[]]$NodeArguments) {
    & node @NodeArguments 2>&1 | ForEach-Object { Write-FeedLog ([string]$_) }
    return $LASTEXITCODE
}
Push-Location $scriptRoot
try {
    Write-FeedLog ('===== {0} Feed start =====' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
    $fundExit = Invoke-LoggedNode -NodeArguments @('fund-v6-ops-gas.js', '--send')
    Write-FeedLog "Gas top-up exit=$fundExit"
    $feedExit = Invoke-LoggedNode -NodeArguments @('push-rainfall-v6.js', '--send')
    Write-FeedLog "Feed exit=$feedExit (2=data rejected; 1=execution failure; 0=success)"
    if ($feedExit -ne 0) { exit $feedExit }
    if ($fundExit -ne 0) { exit $fundExit }
    exit 0
} finally { Pop-Location }
