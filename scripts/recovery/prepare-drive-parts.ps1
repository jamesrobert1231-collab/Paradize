[CmdletBinding(DefaultParameterSetName='Prepare')]
param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$ManifestPath,
    [Parameter(ParameterSetName='Prepare')][switch]$Prepare,
    [Parameter(ParameterSetName='Prepare')][ValidateRange(1,64)][int]$PartMiB=64,
    [Parameter(ParameterSetName='Prepare')][string]$BackupId=([guid]::NewGuid().ToString()),
    [Parameter(ParameterSetName='Prepare')][string]$ExpectedSourceSha256,
    [Parameter(Mandatory=$true,ParameterSetName='Stage')][switch]$Stage,
    [Parameter(Mandatory=$true,ParameterSetName='Stage')][ValidateRange(1,10000)][int]$Index,
    [Parameter(Mandatory=$true,ParameterSetName='Stage')][string]$DestinationDirectory
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'This helper requires Windows FileShare.Read locking.'}

function Assert-SafeName([string]$Name) {
    if(!$Name -or $Name.Length -gt 240 -or $Name -match '[\\/<>:"|?*\x00-\x1f\x7f]' -or
       $Name -match '^[. ]|[. ]$' -or $Name -match '^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])([. ]|$)') {throw 'Unsafe basename.'}
}
function Get-SafeExisting([string]$Path,[bool]$Directory) {
    $absolute=[IO.Path]::GetFullPath($Path)
    $cursor=$absolute
    while($true){
        $item=Get-Item -LiteralPath $cursor -Force
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Symlink and junction paths are forbidden.'}
        if($cursor -eq $absolute){
            if([bool]$item.PSIsContainer -ne $Directory){throw 'Unexpected input type.'}
        } elseif(!$item.PSIsContainer){throw 'Parent must be a directory.'}
        $parent=[IO.Path]::GetDirectoryName($cursor)
        if(!$parent -or $parent -eq $cursor){break}
        $cursor=$parent
    }
    return $absolute
}
function Assert-Absent([string]$Path){if([IO.File]::Exists($Path) -or [IO.Directory]::Exists($Path) -or (Test-Path -LiteralPath $Path)){throw 'Destination already exists.'}}
function Get-Hex([byte[]]$Bytes){return [BitConverter]::ToString($Bytes).Replace('-','').ToLowerInvariant()}
function Assert-Hash($Value){if($Value -isnot [string] -or $Value -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid expected SHA-256.'}}
function Assert-Integer($Value,[long]$Minimum,[long]$Maximum){
    if(($Value -isnot [int] -and $Value -isnot [long]) -or $Value -lt $Minimum -or $Value -gt $Maximum){throw 'Invalid manifest byte count or index.'}
}
function Read-Manifest([string]$Path){
    $path=Get-SafeExisting $Path $false
    $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        if($stream.Length -lt 1 -or $stream.Length -gt 4MB){throw 'Manifest byte limit exceeded.'}
        $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8,$true,4096,$true)
        try {
            $json=$reader.ReadToEnd()
            # PowerShell 7.5+ otherwise converts this exact snapshot timestamp to DateTime.
            if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$value=ConvertFrom-Json -InputObject $json -DateKind String}
            else {$value=ConvertFrom-Json -InputObject $json}
        } finally {$reader.Dispose()}
    } finally {$stream.Dispose()}
    if($value.version -ne 1 -or !$value.backupId){throw 'Invalid version 1 manifest.'}
    Assert-SafeName $value.sourceName
    Assert-Hash $value.sourceSha256
    Assert-Integer $value.sourceBytes 1 (10000L*64MB)
    if(!$value.parts -or $value.parts.Count -gt 10000){throw 'Invalid parts count.'}
    $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$offset=0; [int]$expectedIndex=1
    foreach($part in $value.parts){
        Assert-Integer $part.index 1 10000
        Assert-Integer $part.offset 0 (10000L*64MB)
        Assert-Integer $part.bytes 1 64MB
        Assert-SafeName $part.filename
        Assert-Hash $part.sha256
        if($part.index -ne $expectedIndex -or $part.offset -ne $offset -or !$names.Add($part.filename)){throw 'Invalid part sequence, offset or duplicate name.'}
        $offset += $part.bytes; $expectedIndex++
    }
    if($offset -ne $value.sourceBytes){throw 'Part byte total differs from source bytes.'}
    return $value
}

$sourcePath=Get-SafeExisting $Source $false
$sourceName=[IO.Path]::GetFileName($sourcePath)
Assert-SafeName $sourceName
$manifestFile=[IO.Path]::GetFullPath($ManifestPath)
$sourceStream=$null; $out=$null; $temporary=$null; $wholeHash=$null; $partHash=$null
try {
    if($Stage){
        $manifest=Read-Manifest $manifestFile
        if($Index -gt $manifest.parts.Count){throw 'Part index is outside manifest bounds.'}
        $part=$manifest.parts[$Index-1]
        $outputDirectory=Get-SafeExisting $DestinationDirectory $true
        $outputFile=Join-Path $outputDirectory $part.filename
        Assert-Absent $outputFile
    } else {
        if(!$BackupId -or $BackupId.Length -gt 256 -or $BackupId -match '[\x00-\x1f\x7f]'){throw 'Invalid backup identifier.'}
        if($ExpectedSourceSha256){Assert-Hash $ExpectedSourceSha256}
        $outputDirectory=Get-SafeExisting ([IO.Path]::GetDirectoryName($manifestFile)) $true
        Assert-SafeName ([IO.Path]::GetFileName($manifestFile))
        Assert-Absent $manifestFile
    }
    # Windows denies writes and deletion through other handles for this snapshot's lifetime.
    $sourceStream=[IO.File]::Open($sourcePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $null=Get-SafeExisting $sourcePath $false
    [long]$sourceBytes=$sourceStream.Length
    $modified=[IO.File]::GetLastWriteTimeUtc($sourcePath).ToString('O')
    if($sourceBytes -lt 1 -or $sourceBytes -gt (10000L*64MB)){throw 'Source byte limit exceeded.'}
    $buffer=New-Object byte[] (1MB)
    if($Stage){
        if($sourceName -cne $manifest.sourceName -or $sourceBytes -ne $manifest.sourceBytes -or $modified -cne $manifest.sourceModifiedUtc){throw 'Source differs from the prepared snapshot.'}
        $temporary=Join-Path $outputDirectory ('.paradize-part-'+[guid]::NewGuid().ToString()+'.tmp')
        $out=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $partHash=[Security.Cryptography.SHA256]::Create()
        $null=$sourceStream.Seek([long]$part.offset,[IO.SeekOrigin]::Begin)
        [long]$remaining=$part.bytes
        while($remaining -gt 0){
            $read=$sourceStream.Read($buffer,0,[int][Math]::Min($buffer.Length,$remaining))
            if($read -le 0){throw 'Source ended before the selected part.'}
            $null=$partHash.TransformBlock($buffer,0,$read,$buffer,0)
            $out.Write($buffer,0,$read); $remaining-=$read
        }
        $null=$partHash.TransformFinalBlock([byte[]]@(),0,0)
        $actual=Get-Hex $partHash.Hash
        if($actual -cne $part.sha256){throw 'Staged part SHA-256 differs from the prepared snapshot.'}
        if($sourceStream.Length -ne $sourceBytes -or [IO.File]::GetLastWriteTimeUtc($sourcePath).ToString('O') -cne $modified){throw 'Source changed during staging.'}
        $out.Flush($true); $out.Dispose(); $out=$null
        $null=Get-SafeExisting $outputDirectory $true
        [IO.File]::Move($temporary,$outputFile); $temporary=$null
        [pscustomobject]@{version=1;backupId=$manifest.backupId;index=$part.index;path=$outputFile;bytes=$part.bytes;sha256=$actual;sourceSnapshotSha256=$manifest.sourceSha256} | ConvertTo-Json
    } else {
        [long]$partBytes=[long]$PartMiB*1MB
        if([Math]::Ceiling($sourceBytes/[double]$partBytes) -gt 10000){throw 'Part count limit exceeded.'}
        $parts=[Collections.Generic.List[object]]::new()
        $wholeHash=[Security.Cryptography.SHA256]::Create()
        [long]$offset=0
        while($offset -lt $sourceBytes){
            $partHash=[Security.Cryptography.SHA256]::Create()
            [long]$bytes=[Math]::Min($partBytes,$sourceBytes-$offset)
            [long]$remaining=$bytes
            while($remaining -gt 0){
                $read=$sourceStream.Read($buffer,0,[int][Math]::Min($buffer.Length,$remaining))
                if($read -le 0){throw 'Source ended during snapshot preparation.'}
                $null=$wholeHash.TransformBlock($buffer,0,$read,$buffer,0)
                $null=$partHash.TransformBlock($buffer,0,$read,$buffer,0)
                $remaining-=$read
            }
            $null=$partHash.TransformFinalBlock([byte[]]@(),0,0)
            $filename=$sourceName+'.chunks'+$PartMiB+'MiB.part'+($parts.Count+1).ToString('D3')
            Assert-SafeName $filename
            $parts.Add([pscustomobject]@{index=$parts.Count+1;offset=$offset;filename=$filename;bytes=$bytes;sha256=(Get-Hex $partHash.Hash)})
            $partHash.Dispose(); $partHash=$null; $offset+=$bytes
        }
        $null=$wholeHash.TransformFinalBlock([byte[]]@(),0,0)
        $actual=Get-Hex $wholeHash.Hash
        if($ExpectedSourceSha256 -and $actual -cne $ExpectedSourceSha256){throw 'Source SHA-256 differs from the expected hash.'}
        if($sourceStream.Length -ne $sourceBytes -or [IO.File]::GetLastWriteTimeUtc($sourcePath).ToString('O') -cne $modified){throw 'Source changed during snapshot preparation.'}
        $manifest=[ordered]@{version=1;backupId=$BackupId;state='prepared';sourceName=$sourceName;sourceBytes=$sourceBytes;sourceSha256=$actual;sourceModifiedUtc=$modified;preparedAtUtc=[DateTime]::UtcNow.ToString('O');partBytes=$partBytes;parts=$parts.ToArray()}
        $manifestBytes=[Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 6))
        if($manifestBytes.Length -gt 4MB){throw 'Manifest byte limit exceeded.'}
        $temporary=Join-Path $outputDirectory ('.paradize-manifest-'+[guid]::NewGuid().ToString()+'.tmp')
        $out=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $out.Write($manifestBytes,0,$manifestBytes.Length); $out.Flush($true); $out.Dispose(); $out=$null
        $null=Get-SafeExisting $outputDirectory $true
        [IO.File]::Move($temporary,$manifestFile); $temporary=$null
        [pscustomobject]@{version=1;backupId=$BackupId;manifestPath=$manifestFile;sourceBytes=$sourceBytes;sourceSha256=$actual;partCount=$parts.Count;partBytes=$partBytes} | ConvertTo-Json
    }
} finally {
    if($out){$out.Dispose()}
    if($partHash){$partHash.Dispose()}
    if($wholeHash){$wholeHash.Dispose()}
    if($sourceStream){$sourceStream.Dispose()}
    # Only this invocation's uniquely named temporary file is eligible for cleanup.
    if($temporary -and [IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}
}
