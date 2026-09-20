$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot)
$runtimeRoot = Join-Path $root '.runtimes'
$name = 'node-v24.14.0-win-x64'
$hash = '313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66'
New-Item -ItemType Directory -Force $runtimeRoot | Out-Null
$zip = Join-Path $runtimeRoot "$name.zip"
if (-not (Test-Path -LiteralPath $zip)) {
    Invoke-WebRequest "https://nodejs.org/dist/v24.14.0/$name.zip" -OutFile $zip
}
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
    throw 'Node archive checksum mismatch; refusing extraction.'
}
$runtime = Join-Path $runtimeRoot $name
if (-not (Test-Path -LiteralPath $runtime)) { Expand-Archive -LiteralPath $zip -DestinationPath $runtimeRoot }
$node = Join-Path $runtime 'node.exe'
if ((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -ne '63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088') {
    throw 'Node executable checksum mismatch.'
}
& $node --version
if ($LASTEXITCODE -ne 0) { throw 'Node runtime verification failed.' }
