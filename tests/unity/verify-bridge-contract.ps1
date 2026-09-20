param([string]$UnityEditorData='C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Data')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output=Join-Path ([IO.Path]::GetTempPath()) ('pz-contract-'+[guid]::NewGuid().ToString('N'))
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$mono=Join-Path $UnityEditorData 'MonoBleedingEdge\bin\mono.exe'
foreach($file in @($compiler,$mono)){if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw 'C# validation runtime unavailable'}}
New-Item -ItemType Directory -Path $output | Out-Null
$exe=Join-Path $output 'SunnyBridgeContractTests.exe'
& $compiler /nologo /target:exe ('/out:'+$exe) (Join-Path $root 'apps\paradize-unity\Assets\Paradize\Core\SunnyBridgeContract.cs') (Join-Path $PSScriptRoot 'SunnyBridgeContract.test.cs')
if($LASTEXITCODE -ne 0){throw 'Contract test compilation failed'}
& $exe
if($LASTEXITCODE -ne 0){throw 'Framework contract checks failed'}
& $mono $exe
if($LASTEXITCODE -ne 0){throw 'Mono contract checks failed'}
Write-Output ('Synthetic contract test artifacts: '+$output)
