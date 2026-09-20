param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][int]$Part,[ValidateRange(1,64)][int]$PartMiB=64)
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot)
$staging=Join-Path $root '.build\drive-offload'
New-Item -ItemType Directory -Path $staging -Force | Out-Null
$item=Get-Item -LiteralPath $Source -Force
if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Source must be a regular installer file.'}
$partSize=[long]$PartMiB*1MB
$count=[int][math]::Ceiling($item.Length/[double]$partSize)
if($Part -lt 0 -or $Part -ge $count){throw 'Part is outside source bounds.'}
$output=Join-Path $staging ($item.Name+'.chunks'+$PartMiB+'MiB.part'+($Part+1).ToString('D3'))
$sourceStream=[IO.File]::Open($item.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
    $out=[IO.File]::Open($output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {
        $null=$sourceStream.Seek([long]$Part*$partSize,[IO.SeekOrigin]::Begin)
        $remaining=[math]::Min($partSize,$item.Length-[long]$Part*$partSize)
        $buffer=New-Object byte[] (1MB)
        while($remaining -gt 0){$read=$sourceStream.Read($buffer,0,[int][math]::Min($buffer.Length,$remaining));if($read -le 0){throw 'Source ended early.'};$out.Write($buffer,0,$read);$remaining-=$read}
        $out.Flush($true)
    } finally {$out.Dispose()}
} finally {$sourceStream.Dispose()}
[pscustomobject]@{Source=$item.FullName;SourceBytes=$item.Length;SourceModifiedUtc=$item.LastWriteTimeUtc.ToString('O');Part=$Part+1;PartCount=$count;PartBytes=(Get-Item -LiteralPath $output).Length;Path=$output;SHA256=(Get-FileHash -LiteralPath $output).Hash.ToLowerInvariant()} | ConvertTo-Json
