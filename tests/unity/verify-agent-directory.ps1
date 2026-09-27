param(
    [string]$UnityEditorData='C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data',
    [switch]$BaselineNavigationOnly
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$output=Join-Path ([IO.Path]::GetTempPath()) ('pz-agents-'+[guid]::NewGuid().ToString('N'))
$framework=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$dotnet=Join-Path $UnityEditorData 'DotNetSdk\dotnet.exe'
$compiler=Get-ChildItem -LiteralPath (Join-Path $UnityEditorData 'DotNetSdk\sdk') -Directory |
    Sort-Object Name -Descending | ForEach-Object {Join-Path $_.FullName 'Roslyn\bincore\csc.dll'} |
    Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | Select-Object -First 1
$mono=Join-Path $UnityEditorData 'MonoBleedingEdge\bin\mono.exe'
foreach($file in @($compiler,$mono,$dotnet)){if(!$file -or !(Test-Path -LiteralPath $file -PathType Leaf)){throw 'C# validation runtime unavailable'}}
New-Item -ItemType Directory -Path $output | Out-Null
$source=Get-Content -LiteralPath (Join-Path $root 'apps/paradize-unity/Assets/Paradize/Core/IslandSession.cs') -Raw
function SessionMethod([string]$signature) {
    # Compile the actual production methods unchanged against narrow camera/island
    # doubles. This does not execute Unity, render IMGUI, or run a coroutine.
    $pattern='(?ms)^        '+[regex]::Escape($signature)+'\r?\n        \{.*?^        \}'
    $match=[regex]::Match($source,$pattern)
    if(!$match.Success){throw "Session method not found: $signature"}
    return $match.Value
}
$parts=@('using System; using UnityEngine; namespace Paradize { public partial class IslandSession {')
foreach($name in @('Keys','Names','Details')) {
    $match=[regex]::Match($source,'(?ms)^        public static readonly string\[\] '+$name+' = \{.*?\};')
    if(!$match.Success){throw "Session district declaration not found: $name"}
    $parts+=$match.Value
}
$parts+=SessionMethod 'void Start()'
$parts+=SessionMethod 'public void Visit(int index)'
if(!$BaselineNavigationOnly){$parts+=SessionMethod 'public bool SelectAgent(string id)'}
$parts+='} }'
$session=Join-Path $output 'IslandSession.methods.cs'
[IO.File]::WriteAllText($session,($parts -join [Environment]::NewLine))
$exe=Join-Path $output 'IslandAgentDirectoryTests.exe'
$arguments=@('/nologo','/noconfig','/nostdlib+','/langversion:latest','/target:exe',('/out:'+$exe),$session,(Join-Path $PSScriptRoot 'IslandAgentDirectory.test.cs'))
foreach($reference in @('mscorlib.dll','System.dll','System.Core.dll')){$arguments+='/reference:'+(Join-Path $framework $reference)}
if(!$BaselineNavigationOnly){
    $arguments+='/define:DIRECTORY'
    $arguments+=Join-Path $root 'apps/paradize-unity/Assets/Paradize/Core/IslandAgentDirectory.cs'
}
& $dotnet $compiler @arguments
if($LASTEXITCODE -ne 0){throw 'Agent directory test compilation failed'}
& $exe
if($LASTEXITCODE -ne 0){throw 'Framework agent directory checks failed'}
& $mono $exe
if($LASTEXITCODE -ne 0){throw 'Mono agent directory checks failed'}
Write-Output ('Synthetic agent validation artifacts: '+$output)
