$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../scripts/Sunny-HealthContract.ps1')
$count=0
function Check($Health, [bool]$Expected, [string]$Label) {
    if ((Test-SunnyHealthContract $Health) -ne $Expected) { throw "Health compatibility failure: $Label" }
    $script:count++
}
function Current {
    return '{"service":"paradize-sunny-local","protocolVersion":2,"localOnlyPolicyRequired":true,"provider":"ollama","paidRequestsEnabled":false,"status":"ready"}' | ConvertFrom-Json
}
Check $null $false 'missing response'
Check ('{"provider":"ollama","paidRequestsEnabled":false,"status":"ready"}' | ConvertFrom-Json) $false 'previous bridge'
foreach($state in @('ready','stopped','model-unavailable','ollama-unavailable','local-only-unconfirmed')) {
    $h=Current; $h.status=$state; Check $h $true $state
}
foreach($state in @('denied','complete','unknown','READY')) {$h=Current;$h.status=$state;Check $h $false $state}
foreach($version in @('2',1,3,$null)) {$h=Current;$h.protocolVersion=$version;Check $h $false 'wrong protocol'}
foreach($value in @('false',0,$true,$null)) {$h=Current;$h.paidRequestsEnabled=$value;Check $h $false 'paid flag must be Boolean false'}
foreach($value in @('true',1,$false,$null)) {$h=Current;$h.localOnlyPolicyRequired=$value;Check $h $false 'policy flag must be Boolean true'}
$h=Current;$h.service='other-service';Check $h $false 'wrong service'
$h=Current;$h.provider='cloud';Check $h $false 'wrong provider'
Write-Output "$count health-contract checks passed"
