$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot)
& (Join-Path $PSScriptRoot 'setup-runtime.ps1')
$runtime = Join-Path $root '.runtimes/node-v24.14.0-win-x64'
$node = Join-Path $runtime 'node.exe'
$candidate = Join-Path $root '.build/globe'
if (-not (Test-Path -LiteralPath $candidate)) {
    & $node (Join-Path $PSScriptRoot 'prepare.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Source preparation failed' }
}
$previousPath = $env:PATH
try {
    $env:PATH = "$runtime;$previousPath"
    Push-Location $candidate
    try {
        & $node (Join-Path $runtime 'node_modules/npm/bin/npm-cli.js') ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
        & $node (Join-Path $PSScriptRoot 'compile.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Globe build failed' }
    } finally { Pop-Location }
    & $node (Join-Path $PSScriptRoot 'verify.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Release constraint verification failed' }
} finally { $env:PATH = $previousPath }
