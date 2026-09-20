[CmdletBinding()]
param(
    [string]$PackageRoot = (Join-Path $env:APPDATA 'npm/node_modules/@nanonets/graft')
)
$ErrorActionPreference = 'Stop'
# Graft 0.18.0 eagerly loads Kotlin even for repositories without Kotlin.
# Defer that one native grammar; Kotlin still fails explicitly if it is used.
$package = Get-Content -LiteralPath (Join-Path $PackageRoot 'package.json') -Raw | ConvertFrom-Json
if ($package.name -ne '@nanonets/graft' -or $package.version -ne '0.18.0') {
    throw 'This compatibility repair is qualified only for @nanonets/graft 0.18.0.'
}
$target = Join-Path $PackageRoot 'dist/graph/extract.js'
$source = [IO.File]::ReadAllText($target)
$oldImport = 'import Kotlin from "tree-sitter-kotlin";'
$newImport = 'import { createRequire as createKotlinRequire } from "node:module";'
$oldGrammar = '    kotlin: Kotlin,'
$newGrammar = '    get kotlin() { return createKotlinRequire(import.meta.url)("tree-sitter-kotlin"); },'
if ($source.Contains($newImport) -and $source.Contains($newGrammar) -and -not $source.Contains($oldImport)) {
    Write-Output 'Graft Kotlin lazy-loading repair is already applied.'
    exit 0
}
if (-not $source.Contains($oldImport) -or -not $source.Contains($oldGrammar) -or $source.Contains('createKotlinRequire')) {
    throw 'Unrecognized extractor; no changes made.'
}
$backup = "$target.paradize-backup-0.18.0"
if (Test-Path -LiteralPath $backup) { throw 'An earlier backup exists; inspect it before replacing this extractor.' }
Copy-Item -LiteralPath $target -Destination $backup
[IO.File]::WriteAllText($target, $source.Replace($oldImport, $newImport).Replace($oldGrammar, $newGrammar), [Text.UTF8Encoding]::new($false))
Write-Output 'Repaired Graft Kotlin loading; the original extractor is preserved beside it.'
