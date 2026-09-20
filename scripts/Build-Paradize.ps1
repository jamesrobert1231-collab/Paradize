param([string]$UnityEditor='C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$project=Join-Path $root 'apps/paradize-unity'
# The dressed-character build observed about 4 GiB of transient storage pressure.
# Retain the agreed 10 GiB operational reserve throughout another heavy build.
$buildDrive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($root))
if($buildDrive.AvailableFreeSpace -lt 14GB){throw 'Build admission paused: at least 14 GiB free is required for the measured working margin plus the 10 GiB operational reserve.'}
if(-not(Test-Path -LiteralPath $UnityEditor)){throw 'Unity 6000.6.0f1 is required. Select its installed editor path.'}
$log=Join-Path $root '.build/unity-build.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
$arguments=@('-batchmode','-projectPath',('"'+$project+'"'),'-executeMethod','Paradize.Editor.IslandBuild.QualifyAndBuild','-quit','-logFile',('"'+$log+'"'))
$process=Start-Process -FilePath $UnityEditor -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
if($process.ExitCode -ne 0){throw ('Unity qualification/build failed. See '+$log)}
$checks=@('PARADIZE_VERIFY_PASS','PARADIZE_OCEAN_MATH_PASS','PARADIZE_ISLAND_VALIDATION_PASS','PARADIZE_BUILD_READY')
$result=[IO.File]::ReadAllText($log)
foreach($check in $checks){if(-not $result.Contains($check)){throw ('Required evidence missing: '+$check+'. See '+$log)}}
Write-Output ('Built '+(Join-Path $project 'Builds/Windows/PARADIZE.exe'))
Write-Output ('Evidence: '+$log)
