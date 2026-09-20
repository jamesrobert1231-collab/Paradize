param([switch]$Editor)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
. (Join-Path $PSScriptRoot 'Sunny-HealthContract.ps1')
& (Join-Path $root 'services/sunny-local/provision.ps1') | Out-Null
$node=Join-Path $root '.runtimes/node-v24.14.0-win-x64/node.exe'
if(-not(Test-Path -LiteralPath $node)){throw 'Run scripts/globe/setup-runtime.ps1 to provision the isolated Node runtime.'}
$ollamaReady=$false
try { $null=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3; $ollamaReady=$true } catch {}
if(-not $ollamaReady){
    $ollama=Join-Path $env:LOCALAPPDATA 'Programs/Ollama/ollama.exe'
    if(Test-Path -LiteralPath $ollama){
        Start-Process -FilePath $ollama -ArgumentList @('serve') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root '.runtime/sunny/ollama-stdout.log') -RedirectStandardError (Join-Path $root '.runtime/sunny/ollama-stderr.log') | Out-Null
    }
}
$headers=@{Authorization='Bearer '+[IO.File]::ReadAllText($env:PARADIZE_SUNNY_TOKEN_FILE).Trim()}
$ready=$false
$health=$null
try { $health=Invoke-RestMethod 'http://127.0.0.1:4318/health' -Headers $headers -TimeoutSec 7; $ready=Test-SunnyHealthContract $health } catch {}
if($null -ne $health -and -not $ready){throw 'The running Sunny service is incompatible. Close it through its owning launcher before restarting PARADIZE. No island was launched.'}
if(-not $ready){
    Start-Process -FilePath $node -ArgumentList @((Join-Path $root 'services/sunny-local/server.mjs')) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root '.runtime/sunny/stdout.log') -RedirectStandardError (Join-Path $root '.runtime/sunny/stderr.log') | Out-Null
    for($attempt=0;$attempt -lt 10;$attempt++){
        Start-Sleep -Milliseconds 500
        try {$health=Invoke-RestMethod 'http://127.0.0.1:4318/health' -Headers $headers -TimeoutSec 6;$ready=Test-SunnyHealthContract $health;if($ready){break}}catch{}
    }
}
if(-not $ready){throw 'A compatible Sunny service could not be confirmed. No island was launched; existing processes were left intact.'}
if($Editor){
    $unity='C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe'
    Start-Process -FilePath $unity -ArgumentList @('-projectPath',(Join-Path $root 'apps/paradize-unity'))
}else{
    $player=Join-Path $root 'apps/paradize-unity/Builds/Windows/PARADIZE.exe'
    if(-not(Test-Path -LiteralPath $player)){throw 'The Windows player has not been built. Use -Editor to open Unity.'}
    Start-Process -FilePath $player -WorkingDirectory (Split-Path $player)
}
