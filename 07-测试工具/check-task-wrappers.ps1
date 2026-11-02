# Load only function definitions; never execute a scheduled task or a chain script.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$testOutput = Join-Path $projectRoot '12-开发归档/2026-11-02/临时/task-wrapper-test.log'
$logPath = $testOutput
$utf8 = [Text.UTF8Encoding]::new($false)
foreach ($relative in @('04-脚本/feed-v6-once.ps1', '04-脚本/ops-daily.ps1')) {
    $parseErrors = $null
    $parseTokens = $null
    $tree = [Management.Automation.Language.Parser]::ParseFile((Join-Path $projectRoot $relative), [ref]$parseTokens, [ref]$parseErrors)
    if ($parseErrors.Count -ne 0) { throw 'PowerShell syntax error' }
    foreach ($definition in $tree.FindAll({param($element) $element -is [Management.Automation.Language.FunctionDefinitionAst]}, $true)) {
        . ([scriptblock]::Create($definition.Extent.Text))
    }
}
$script:seenArguments = @()
function node {
    $script:seenArguments = @($args)
    $global:LASTEXITCODE = 2
    'fixture-output'
}
$result = Invoke-LoggedNode -NodeArguments @('push-rainfall-v6.js', '--send')
if ($result -ne 2 -or $script:seenArguments.Count -ne 2 -or $script:seenArguments[1] -ne '--send') { throw 'Feed arguments or exit code lost' }
$result = Invoke-OpsStep -Label 'fixture-stage' -Executable 'node' -StepArguments @('notify.js', '--blocks', '60000') -WorkDirectory $projectRoot
if ($result -ne 2 -or $script:seenArguments.Count -ne 3) { throw 'Ops arguments or exit code lost' }
if (-not ([IO.File]::ReadAllText($testOutput).Contains('fixture-stage exit=2'))) { throw 'Stage exit code not recorded' }
'PASS: native PowerShell arguments, exit codes and per-stage logs (mock node; no chain writes)'
