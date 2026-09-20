param(
    [string]$UnityEditorData = 'C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data',
    [switch]$SkipRuntimeCompile
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
# Keep synthetic fixture paths independent of checkout nesting. Framework's
# legacy file APIs otherwise exceed MAX_PATH before the behavior under test runs.
$output = Join-Path ([IO.Path]::GetTempPath()) ('pz-copy-' + [Guid]::NewGuid().ToString('N'))
$frameworkCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$mono = Join-Path $UnityEditorData 'MonoBleedingEdge\bin\mono.exe'
foreach ($required in @($frameworkCompiler, $mono)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw 'Required local C# validation runtime is unavailable.' }
}
New-Item -ItemType Directory -Path $output | Out-Null
$helper = Join-Path $root 'apps\paradize-unity\Assets\Paradize\Core\SourceCopyStore.cs'
$tests = Join-Path $PSScriptRoot 'SourceCopyStore.test.cs'
$testExe = Join-Path $output 'SourceCopyStoreTests.exe'
& $frameworkCompiler /nologo /target:exe ('/out:' + $testExe) $helper $tests
if ($LASTEXITCODE -ne 0) { throw 'Source copy helper test compilation failed.' }
# Independent expected Windows owner, passed only to synthetic fixtures. No bearer or live token file is read.
$fixtureOwner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& $testExe (Join-Path $output 'framework-fixture') $fixtureOwner
if ($LASTEXITCODE -ne 0) { throw '.NET Framework source copy tests failed.' }
& $mono $testExe (Join-Path $output 'mono-fixture') $fixtureOwner
if ($LASTEXITCODE -ne 0) { throw 'Unity Mono source copy tests failed.' }
if (-not $SkipRuntimeCompile) {
    $settings = Get-Content -LiteralPath (Join-Path $root 'apps\paradize-unity\ProjectSettings\ProjectSettings.asset') -Raw
    if ($settings -notmatch '(?m)^  apiCompatibilityLevel: 6\r?$' -or $settings -notmatch '(?m)^  apiCompatibilityLevelPerPlatform: \{\}\r?$') {
        throw 'Unity API profile changed; inspect the actual profile before changing these compilation references.'
    }
    $dotnet = Join-Path $UnityEditorData 'DotNetSdk\dotnet.exe'
    $compiler = Get-ChildItem -LiteralPath (Join-Path $UnityEditorData 'DotNetSdk\sdk') -Directory |
        Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'Roslyn\bincore\csc.dll' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    $netstandard = Join-Path $UnityEditorData 'NetStandard\ref\2.1.0\netstandard.dll'
    if (-not $compiler -or -not (Test-Path -LiteralPath $netstandard -PathType Leaf) -or -not (Test-Path -LiteralPath $dotnet -PathType Leaf)) {
        throw 'Installed Unity compiler or .NET Standard 2.1 reference assembly is unavailable.'
    }
    $arguments = @('/nologo', '/noconfig', '/nostdlib+', '/target:library', '/langversion:latest',
        ('/out:' + (Join-Path $output 'Paradize-runtime-check.dll')), ('/reference:' + $netstandard))
    $arguments += Get-ChildItem -LiteralPath (Join-Path $UnityEditorData 'Managed\UnityEngine') -Filter '*.dll' |
        ForEach-Object { '/reference:' + $_.FullName }
    $arguments += Get-ChildItem -LiteralPath (Join-Path $root 'apps\paradize-unity\Assets\Paradize') -Filter '*.cs' -Recurse |
        Where-Object { $_.FullName -notmatch '\\Editor\\' } | ForEach-Object { $_.FullName }
    & $dotnet $compiler @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Unity runtime source compilation failed.' }
    Write-Output 'UNITY_RUNTIME_SOURCE_COMPILE=passed (.NET Standard 2.1; player/editor not launched)'
}
Write-Output ('Synthetic validation artifacts: ' + $output)
