# Daily checks: full offline gates, operational health, then a read-only feed round.
# No --send here. Each stage records its own exit code; rejection is not success.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$scriptRoot = $PSScriptRoot
$logPath = Join-Path $scriptRoot '../02-作战与答辩/自动完善-定时日志.txt'
$utf8 = [Text.UTF8Encoding]::new($false)
function Write-OpsLog([string]$Text) {
    [IO.File]::AppendAllText($logPath, $Text + [Environment]::NewLine, $utf8)
}
function Invoke-OpsStep([string]$Label, [string]$Executable, [string[]]$StepArguments, [string]$WorkDirectory) {
    Write-OpsLog ('----- {0} start {1}' -f $Label, (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
    Push-Location $WorkDirectory
    try {
        & $Executable @StepArguments 2>&1 | ForEach-Object { Write-OpsLog ([string]$_) }
        $stepExit = $LASTEXITCODE
        if ($null -eq $stepExit) { $stepExit = 1 }
        Write-OpsLog "----- $Label exit=$stepExit"
        return $stepExit
    } finally { Pop-Location }
}
Write-OpsLog ('===== {0} OpsDaily start =====' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
$gateExit = Invoke-OpsStep -Label 'gates' -Executable 'npm.cmd' -StepArguments @('test') -WorkDirectory (Join-Path $scriptRoot '../07-测试工具')
$notifyExit = Invoke-OpsStep -Label 'health' -Executable 'node' -StepArguments @('notify.js', '--blocks', '60000') -WorkDirectory $scriptRoot
$feedExit = Invoke-OpsStep -Label 'feed-dry-run' -Executable 'node' -StepArguments @('push-rainfall-v6.js') -WorkDirectory $scriptRoot
Write-OpsLog "----- OpsDaily summary: gates=$gateExit health=$notifyExit feed=$feedExit"
if ($gateExit -ne 0 -or $notifyExit -ne 0 -or $feedExit -ne 0) { exit 2 }
exit 0