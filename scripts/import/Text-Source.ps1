function Read-TextSource([string]$Source) {
    $ErrorActionPreference='Stop'
    $absolute=[IO.Path]::GetFullPath($Source)
    if([IO.Path]::GetExtension($absolute).ToLowerInvariant() -notin @('.txt','.md')){throw 'Select a UTF-8 .txt or .md source'}
    $cursor=$absolute
    while($cursor){
        $item=Get-Item -LiteralPath $cursor -Force
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked source paths require separate review'}
        $cursor=[IO.Path]::GetDirectoryName($cursor)
    }
    $stream=[IO.File]::Open($absolute,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        if($stream.Length -lt 1 -or $stream.Length -gt 800003){throw 'Text source byte limit exceeded'}
        $bytes=New-Object byte[] ([int]$stream.Length)
        $offset=0
        while($offset -lt $bytes.Length){
            $read=$stream.Read($bytes,$offset,$bytes.Length-$offset)
            if($read -eq 0){throw 'Source ended unexpectedly'}
            $offset+=$read
        }
        if($stream.ReadByte() -ne -1){throw 'Source changed size'}
        $start=0
        if($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191){$start=3}
        $decoder=[Text.UTF8Encoding]::new($false,$true)
        $text=$decoder.GetString($bytes,$start,$bytes.Length-$start)
        if([string]::IsNullOrWhiteSpace($text) -or $text.Length -gt 200000 -or $text -match '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]'){throw 'Empty, binary, or oversized text source'}
        return @{source=$absolute;title=[IO.Path]::GetFileNameWithoutExtension($absolute);text=$text;originalBase64=[Convert]::ToBase64String($bytes);extraction='utf8-text-verbatim'}
    } finally {$stream.Dispose()}
}
