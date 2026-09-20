param([string]$UnityEditor='C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe')
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot)
$source=Join-Path $root '.build/characters/human-candidate.fbx'
$report=Get-Content -LiteralPath (Join-Path $root '.build/characters/human-candidate.json') -Raw | ConvertFrom-Json
if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $report.fbxSha256){throw 'Human candidate hash differs from its build report.'}
$project=Join-Path $root 'apps/paradize-unity'
$destination=Join-Path $project 'Assets/Paradize/Candidates/Human'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item -LiteralPath $source -Destination $destination
Copy-Item -LiteralPath (Join-Path $root 'vendor/assets/makehuman-core/LICENSE.ASSETS.md') -Destination $destination
Copy-Item -LiteralPath (Join-Path $root 'vendor/assets/makehuman-core/provenance.json') -Destination $destination
$selectedRoot=Join-Path $root 'vendor/assets/makehuman-system-selected'
$selected=Get-Content -LiteralPath (Join-Path $selectedRoot 'provenance.json') -Raw | ConvertFrom-Json
$textureRoot=Join-Path $destination 'Textures'
New-Item -ItemType Directory -Force -Path $textureRoot | Out-Null
foreach($entry in $selected.files | Where-Object { $_.path -match '\.png$' }){
    $texture=Join-Path $selectedRoot $entry.path
    if((Get-FileHash -LiteralPath $texture -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256){throw 'Selected texture hash mismatch'}
    Copy-Item -LiteralPath $texture -Destination $textureRoot
}
Copy-Item -LiteralPath (Join-Path $selectedRoot 'provenance.json') -Destination (Join-Path $destination 'appearance-provenance.json')
$log=Join-Path $root '.build/human-unity-validation.log'
$arguments=@('-batchmode','-projectPath',('"'+$project+'"'),'-executeMethod','Paradize.Editor.HumanCandidateValidation.Verify','-quit','-logFile',('"'+$log+'"'))
$run=Start-Process -FilePath $UnityEditor -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
if($run.ExitCode -ne 0){throw ('Character import failed. See '+$log)}
if(-not([IO.File]::ReadAllText($log).Contains('PARADIZE_HUMAN_IMPORT_PASS'))){throw ('Character evidence marker is missing. See '+$log)}
Write-Output 'Character import mechanics passed. Visual realism and runtime activation remain unqualified.'
