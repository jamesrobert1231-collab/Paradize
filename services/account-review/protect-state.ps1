$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$maximumBytes = 2 * 1024 * 1024
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$allowed = @($owner.Value, $system.Value)

function Assert-Ancestors([string]$Directory) {
    $current = [IO.DirectoryInfo]::new($Directory)
    while ($null -ne $current) {
        if (Test-Path -LiteralPath $current.FullName) {
            $item = Get-Item -LiteralPath $current.FullName -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'Linked or non-directory storage paths are forbidden.'
            }
        }
        $current = $current.Parent
    }
}

function Assert-Private([string]$ItemPath, [bool]$Directory) {
    $item = Get-Item -LiteralPath $ItemPath -Force
    if ([bool]$item.PSIsContainer -ne $Directory -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Storage entries must have the expected type and cannot be links.'
    }
    $acl = Get-Acl -LiteralPath $ItemPath
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value) {
        throw 'Storage belongs to another Windows owner.'
    }
    if ($Directory -and -not $acl.AreAccessRulesProtected) { throw 'Storage directory inheritance must be protected.' }
    $ownerGrant = $false
    $systemGrant = $false
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne 'Allow') { throw 'Unexpected storage deny rule.' }
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin $allowed) { throw 'Storage has an unexpected access grant.' }
        $fullControl = [Security.AccessControl.FileSystemRights]::FullControl
        if (($rule.FileSystemRights -band $fullControl) -eq $fullControl -and
            -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) {
            if ($sid -eq $owner.Value) { $ownerGrant = $true }
            if ($sid -eq $system.Value) { $systemGrant = $true }
        }
    }
    if (-not $ownerGrant -or -not $systemGrant) { throw 'Required private storage permissions are missing.' }
}

function Protect-Directory([string]$Directory, [bool]$Provision) {
    if ($Directory -notmatch '^[A-Za-z]:[\\/]' -or $Directory.Substring(2).Contains(':')) {
        throw 'Storage requires an absolute local Windows path.'
    }
    $resolved = [IO.Path]::GetFullPath($Directory).TrimEnd([char[]]'\/')
    if ($resolved.Length -le 3) { throw 'A dedicated storage directory is required.' }
    Assert-Ancestors $resolved
    if (-not (Test-Path -LiteralPath $resolved)) {
        if (-not $Provision) { throw 'Storage directory is missing.' }
        [IO.Directory]::CreateDirectory($resolved) | Out-Null
    }
    Assert-Ancestors $resolved
    $acl = Get-Acl -LiteralPath $resolved
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value) {
        throw 'Storage belongs to another Windows owner.'
    }
    if ($Provision) {
        # Never repair a nonempty directory with unexpectedly broad access.
        # A new/empty directory is the only provisioning surface.
        if (@(Get-ChildItem -LiteralPath $resolved -Force).Count -eq 0) {
            $acl.SetAccessRuleProtection($true, $false)
            foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
            foreach ($sid in @($owner, $system)) {
                $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
                    $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
            }
            Set-Acl -LiteralPath $resolved -AclObject $acl
        }
    }
    Assert-Private $resolved $true
    foreach ($name in @('state.sqlite', 'state.sqlite-journal', 'state.sqlite-wal', 'state.sqlite-shm')) {
        $entry = Join-Path $resolved $name
        if (Test-Path -LiteralPath $entry) { Assert-Private $entry $false }
    }
}

try {
    $inputJson = [Console]::In.ReadToEnd()
    if ($inputJson.Length -gt 4 * $maximumBytes) { throw 'Protection request is too large.' }
    $request = ConvertFrom-Json -InputObject $inputJson
    $operation = [string]$request.operation
    if ($operation -notin @('provision', 'validate', 'encrypt', 'decrypt')) { throw 'Unknown protection operation.' }
    Protect-Directory ([string]$request.directory) ($operation -eq 'provision')
    if ($operation -in @('provision', 'validate')) {
        [Console]::Out.Write('{"ok":true}')
        exit 0
    }
    Add-Type -AssemblyName System.Security
    $entropy = [Text.Encoding]::UTF8.GetBytes('PARADIZE.account-review.state.v1')
    if ($operation -eq 'encrypt') {
        $plain = [Text.UTF8Encoding]::new($false, $true).GetBytes([string]$request.payload)
        if ($plain.Length -gt $maximumBytes) { throw 'State exceeds the 2 MiB limit.' }
        try {
            $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy,
                [Security.Cryptography.DataProtectionScope]::CurrentUser)
            [Console]::Out.Write((@{ value = [Convert]::ToBase64String($cipher) } | ConvertTo-Json -Compress))
        } finally { [Array]::Clear($plain, 0, $plain.Length) }
    } else {
        $cipher = [Convert]::FromBase64String([string]$request.payload)
        if ($cipher.Length -gt $maximumBytes + 65536) { throw 'Encrypted state is too large.' }
        $plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $entropy,
            [Security.Cryptography.DataProtectionScope]::CurrentUser)
        try {
            if ($plain.Length -gt $maximumBytes) { throw 'State exceeds the 2 MiB limit.' }
            $value = [Text.UTF8Encoding]::new($false, $true).GetString($plain)
            [Console]::Out.Write((@{ value = $value } | ConvertTo-Json -Compress))
        } finally { [Array]::Clear($plain, 0, $plain.Length) }
    }
} catch {
    # Do not echo input, decrypted state, or exception details into logs.
    [Console]::Error.Write('Account review storage protection failed. Check the path, owner, permissions, and encrypted state.')
    exit 1
}
