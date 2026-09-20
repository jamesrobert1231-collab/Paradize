[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$NodeSource,
    [Parameter(Mandatory=$true)][string]$PythonSource,
    [switch]$VerifyOnly
)

# Captures code subsets only. This is NOT a user-data backup, runnable release,
# migration of features, or activation of accounts, sessions, schedulers or grants.
# Existing destination bytes are never replaced. No source code is executed.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$destinationRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'vendor/local'))
$capturedUtc = [DateTime]::UtcNow.ToString('o')
$captureId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$textExtensions = @('.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.scss', '.json', '.webmanifest', '.md', '.txt', '.toml', '.svg', '.yaml', '.yml')
$excludedDirectories = @('.git', '.cache', '__pycache__', 'node_modules', '.venv', 'venv', '.pytest_cache', '.mypy_cache', 'dist', 'build', 'coverage', 'artifacts', 'outputs', 'logs', 'uploads', 'stores', 'sessions', 'secrets', 'credentials', 'backups')
$utf8 = New-Object Text.UTF8Encoding($false, $true)

function Assert-ContainedPath([string]$Path, [string]$Root) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $boundary = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    if (-not $absolute.Equals($boundary, [StringComparison]::OrdinalIgnoreCase) -and
        -not $absolute.StartsWith($boundary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escaped its permitted root: $absolute"
    }
    return $absolute
}

function Assert-NoReparseAncestors([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrEmpty($cursor)) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Reparse-point path is not eligible for source capture: $cursor"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-BytesSha256([byte[]]$Bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Get-Relative([string]$Path, [string]$Root) {
    $absolute = Assert-ContainedPath $Path $Root
    return $absolute.Substring($Root.TrimEnd('\', '/').Length + 1).Replace('\', '/')
}

function Get-ExclusionReason([IO.FileInfo]$File) {
    if ($File.Name -like '.env*') { return 'environment-or-secret-file' }
    if ($File.Name -match '^(credentials?|secrets?|tokens?|sessions?|auth(?:entication)?)(?:\.(?:json|ya?ml|txt|ini|conf))?$') { return 'credential-or-session-file' }
    if ($File.Extension.ToLowerInvariant() -notin $textExtensions -and $File.Name -ne '.gitignore') { return 'non-text-or-non-source-extension' }
    if ($File.Length -gt 16MB) { return 'oversize-source-requires-review' }
    try { $content = [IO.File]::ReadAllText($File.FullName, $utf8) }
    catch { return 'not-valid-utf8-text' }
    if ($content.IndexOf([char]0) -ge 0) { return 'binary-content' }
    # High-confidence credential markers only; never emit matching values.
    $secretPattern = '(?m)-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\b(?:sk-proj-|sk-ant-api\d+-|sk-or-v1-)[A-Za-z0-9_-]{25,}|\bgh[pousr]_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bAKIA[A-Z0-9]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b'
    if ([regex]::IsMatch($content, $secretPattern)) { return 'credential-marker-requires-review' }
    return $null
}

function Get-CaptureInventory([string]$Name, [string]$Source, [string[]]$Directories, [string[]]$RootFiles) {
    $sourceRoot = [IO.Path]::GetFullPath($Source).TrimEnd('\', '/')
    Assert-NoReparseAncestors $sourceRoot
    if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) { throw "Missing authoritative source: $sourceRoot" }
    $target = Assert-ContainedPath (Join-Path $destinationRoot $Name) $destinationRoot
    Assert-NoReparseAncestors $target
    $files = New-Object 'Collections.Generic.List[object]'
    $excluded = New-Object 'Collections.Generic.List[object]'
    $candidates = New-Object 'Collections.Generic.List[System.IO.FileInfo]'
    foreach ($directory in $Directories) {
        $includedRoot = Assert-ContainedPath (Join-Path $sourceRoot $directory) $sourceRoot
        Assert-NoReparseAncestors $includedRoot
        if (-not (Test-Path -LiteralPath $includedRoot -PathType Container)) { throw "Required source directory is missing: $includedRoot" }
        $queue = New-Object 'Collections.Generic.Queue[string]'
        $queue.Enqueue($includedRoot)
        while ($queue.Count -gt 0) {
            $current = $queue.Dequeue()
            Assert-NoReparseAncestors $current
            foreach ($item in Get-ChildItem -LiteralPath $current -Force) {
                $relative = Get-Relative $item.FullName $sourceRoot
                if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                    $excluded.Add([ordered]@{ relativePath = $relative; reason = 'reparse-point-not-followed' })
                } elseif ($item.PSIsContainer) {
                    if ($item.Name -in $excludedDirectories) {
                        $excluded.Add([ordered]@{ relativePath = $relative + '/'; reason = 'cache-runtime-or-generated-directory-not-traversed' })
                    } else { $queue.Enqueue($item.FullName) }
                } else { $candidates.Add($item) }
            }
        }
    }
    foreach ($rootFile in $RootFiles) {
        $path = Assert-ContainedPath (Join-Path $sourceRoot $rootFile) $sourceRoot
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            $excluded.Add([ordered]@{ relativePath = $rootFile; reason = 'optional-root-file-not-present' })
            continue
        }
        Assert-NoReparseAncestors $path
        $candidates.Add((Get-Item -LiteralPath $path -Force))
    }
    foreach ($file in ($candidates | Sort-Object FullName)) {
        $relative = Get-Relative $file.FullName $sourceRoot
        $hashBeforeScreening = Get-Sha256 $file.FullName
        $reason = Get-ExclusionReason $file
        if ($null -ne $reason) {
            $excluded.Add([ordered]@{ relativePath = $relative; reason = $reason })
            continue
        }
        $destination = Assert-ContainedPath (Join-Path $target $relative) $target
        Assert-NoReparseAncestors $file.FullName
        Assert-NoReparseAncestors $destination
        $sha = Get-Sha256 $file.FullName
        if ($sha -ne $hashBeforeScreening) { throw "Source changed while screening for capture: $($file.FullName)" }
        $status = 'pending-copy'
        if (Test-Path -LiteralPath $destination) {
            if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw "Destination is not a regular file: $destination" }
            if ((Get-Sha256 $destination) -ne $sha) { throw "Existing destination differs; preserved without overwriting: $destination" }
            $status = 'existing-bytes-verified'
        }
        $files.Add([ordered]@{
            relativePath = $relative; originalPath = $file.FullName; destinationPath = $destination
            bytes = [long]$file.Length; sha256 = $sha; originalLastWriteUtc = $file.LastWriteTimeUtc.ToString('o')
            capturedUtc = $capturedUtc; outcome = $status
        })
    }
    if ($files.Count -eq 0) { throw "Source inventory is unexpectedly empty: $Name" }
    $treeText = ($files | ForEach-Object { $_.relativePath + "`t" + $_.bytes + "`t" + $_.sha256 }) -join "`n"
    [long]$totalBytes = 0
    foreach ($entry in $files) { $totalBytes += $entry.bytes }
    return [ordered]@{
        schemaVersion = 1; name = $Name; captureId = $captureId; capturedUtc = $capturedUtc
        scope = 'source-code-subset'; sourceRoot = $sourceRoot; destinationRoot = $target
        limitations = @('Not a user-data backup.', 'Not a complete runnable release.', 'No feature migration, account authorization or scheduler activation.', 'Code subsets can refer to omitted assets, scripts, documentation, stores and dependencies.', 'Credential-marker screening is limited and does not establish exhaustive secret detection.')
        allowedDirectories = $Directories; allowedRootFiles = $RootFiles
        excludedByDefault = @('All source-root paths not explicitly selected.', 'Caches, generated artifacts, binary assets, databases, environment and credential files.', 'Reparse points are not followed.')
        fileCount = $files.Count; totalBytes = $totalBytes
        treeSha256 = Get-BytesSha256 ($utf8.GetBytes($treeText))
        treeHashFormat = 'UTF-8 without BOM; path<TAB>bytes<TAB>sha256 records ordered by source FullName; LF joins, no final LF.'
        files = $files.ToArray(); excluded = $excluded.ToArray()
    }
}

function Copy-CaptureFile($File, [string]$TargetRoot) {
    $destination = Assert-ContainedPath $File.destinationPath $TargetRoot
    Assert-NoReparseAncestors $File.originalPath
    Assert-NoReparseAncestors $destination
    if (Test-Path -LiteralPath $destination) {
        if ((Get-Sha256 $destination) -ne $File.sha256) { throw "Destination changed after preflight; preserved: $destination" }
        $File.outcome = 'existing-bytes-verified'
        return
    }
    $sourceStream = $null
    $destinationStream = $null
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        # A read-only sharing mode prevents another writer changing the source
        # between its second hash check and the byte-for-byte copy.
        $sourceStream = [IO.File]::Open($File.originalPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $nowHash = ([BitConverter]::ToString($algorithm.ComputeHash($sourceStream))).Replace('-', '').ToLowerInvariant()
        if ($nowHash -ne $File.sha256 -or $sourceStream.Length -ne $File.bytes) { throw "Source changed during capture preflight: $($File.originalPath)" }
        $sourceStream.Position = 0
        $parent = [IO.Path]::GetDirectoryName($destination)
        [IO.Directory]::CreateDirectory($parent) | Out-Null
        Assert-NoReparseAncestors $parent
        $destinationStream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $sourceStream.CopyTo($destinationStream)
        $destinationStream.Flush($true)
    }
    finally {
        if ($null -ne $destinationStream) { $destinationStream.Dispose() }
        if ($null -ne $sourceStream) { $sourceStream.Dispose() }
        $algorithm.Dispose()
    }
    if ((Get-Sha256 $destination) -ne $File.sha256) { throw "Copied bytes failed verification; destination retained for investigation: $destination" }
    $File.outcome = 'copied-and-hash-verified'
}

function Write-NewJson([string]$Path, $Value) {
    $resolved = Assert-ContainedPath $Path $destinationRoot
    Assert-NoReparseAncestors $resolved
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($resolved)) | Out-Null
    Assert-NoReparseAncestors ([IO.Path]::GetDirectoryName($resolved))
    $stream = [IO.File]::Open($resolved, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $bytes = $utf8.GetBytes(($Value | ConvertTo-Json -Depth 12))
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
}

Assert-ContainedPath $destinationRoot $repoRoot | Out-Null
Assert-NoReparseAncestors $destinationRoot
# Preflight both inventories before creating any destination files.
$captures = @(
    (Get-CaptureInventory 'sunny-node' $NodeSource @('src', 'public', 'test') @('package.json', 'README.md', '.gitignore')),
    (Get-CaptureInventory 'sunny-python-v1' $PythonSource @('app', 'tests') @('pyproject.toml', 'README.md', '.gitignore'))
)
$summary = New-Object 'Collections.Generic.List[object]'
foreach ($capture in $captures) {
    if ($VerifyOnly) {
        $missing = @($capture.files | Where-Object { $_.outcome -ne 'existing-bytes-verified' })
        if ($missing.Count -gt 0) { throw "Verification found $($missing.Count) uncopied files for $($capture.name)." }
    } else {
        foreach ($file in $capture.files) { Copy-CaptureFile $file $capture.destinationRoot }
    }
    $manifest = Join-Path $capture.destinationRoot ('manifests/capture-' + $captureId + '.json')
    if (-not $VerifyOnly) { Write-NewJson $manifest $capture }
    $summary.Add([ordered]@{
        name = $capture.name; scope = $capture.scope; fileCount = $capture.fileCount; totalBytes = $capture.totalBytes
        excludedEntries = $capture.excluded.Count; treeSha256 = $capture.treeSha256
        copied = @($capture.files | Where-Object { $_.outcome -eq 'copied-and-hash-verified' }).Count
        alreadyPresentVerified = @($capture.files | Where-Object { $_.outcome -eq 'existing-bytes-verified' }).Count
        manifest = $(if ($VerifyOnly) { $null } else { $manifest })
        manifestSha256 = $(if ($VerifyOnly) { $null } else { Get-Sha256 $manifest })
    })
}
$result = [ordered]@{ success = $true; verifyOnly = [bool]$VerifyOnly; capturedUtc = $capturedUtc; captures = $summary.ToArray() }
if (-not $VerifyOnly) { Write-NewJson (Join-Path $destinationRoot ('capture-report-' + $captureId + '.json')) $result }
$result | ConvertTo-Json -Depth 8
