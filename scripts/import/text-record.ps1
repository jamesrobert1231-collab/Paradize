param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $PSScriptRoot 'Text-Source.ps1')
# Validate and lock-read the source before provisioning or changing the index.
$packet=Read-TextSource $Source
& (Join-Path $repoRoot 'services/sunny-local/provision.ps1') | Out-Null
$stage=Join-Path $repoRoot ('.runtime/sunny/import-'+[Guid]::NewGuid().ToString('N')+'.json')
try {
    [IO.File]::WriteAllText($stage,($packet|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
    & (Join-Path $repoRoot '.runtimes/node-v24.14.0-win-x64/node.exe') (Join-Path $repoRoot 'scripts/import/knowledge-packet.mjs') $stage (Join-Path $repoRoot '.runtime/sunny/knowledge')
    if($LASTEXITCODE -ne 0){throw 'Knowledge import failed; original source retained'}
} finally {if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage}}
