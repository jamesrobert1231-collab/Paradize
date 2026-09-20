param([string]$RuntimeDirectory = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.runtime\sunny'))
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$resolvedDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
$expectedDirectory = [IO.Path]::GetFullPath((Join-Path $workspace '.runtime\sunny'))
if ($resolvedDirectory -ne $expectedDirectory) { throw 'Token provisioning is limited to this project .runtime\sunny directory.' }
foreach ($candidate in @((Join-Path $workspace '.runtime'), $resolvedDirectory)) {
    if (Test-Path -LiteralPath $candidate) {
        if ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime directories must not be links.' }
    } else { New-Item -ItemType Directory -Path $candidate | Out-Null }
}
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
function Set-OwnerAccess($item, $security) {
    # Set-Acl can request audit privileges in the host. Persist only modified
    # access rules through the filesystem API; do not change owner or audit ACLs.
    if ($item.PSObject.Methods['SetAccessControl']) { $item.SetAccessControl($security) }
    else { [IO.FileSystemAclExtensions]::SetAccessControl($item, $security) }
}
$acl = Get-Acl -LiteralPath $resolvedDirectory
if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value) { throw 'Runtime directory must belong to the current owner.' }
$acl.SetAccessRuleProtection($true, $false)
foreach ($existing in @($acl.Access)) { if ($null -ne $existing) { $acl.RemoveAccessRuleSpecific($existing) } }
foreach ($sid in @($owner, $system)) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
Set-OwnerAccess ([IO.DirectoryInfo]::new($resolvedDirectory)) $acl
$tokenPath = Join-Path $resolvedDirectory 'token'
if (Test-Path -LiteralPath $tokenPath) {
    if ((Get-Item -LiteralPath $tokenPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Token file must not be a link.' }
    if ([IO.File]::ReadAllText($tokenPath).Trim() -notmatch '^[a-f0-9]{64}$') { throw 'Existing token is invalid. Investigate before replacing it.' }
} else {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
    [IO.File]::WriteAllText($tokenPath, $token, [Text.UTF8Encoding]::new($false))
    [Array]::Clear($bytes, 0, $bytes.Length)
    $token = $null
}
$fileAcl = Get-Acl -LiteralPath $tokenPath
if ($fileAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value) { throw 'Token must belong to the current owner.' }
$fileAcl.SetAccessRuleProtection($true, $false)
foreach ($existing in @($fileAcl.Access)) { if ($null -ne $existing) { $fileAcl.RemoveAccessRuleSpecific($existing) } }
foreach ($sid in @($owner, $system)) { $fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow')) }
Set-OwnerAccess ([IO.FileInfo]::new($tokenPath)) $fileAcl
$verified = Get-Acl -LiteralPath $tokenPath
if (-not $verified.AreAccessRulesProtected) { throw 'Owner token ACL inheritance was not disabled.' }
foreach ($rule in $verified.Access) {
    $ruleSid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -eq 'Allow' -and $ruleSid -notin @($owner.Value, $system.Value)) { throw 'Owner token has unexpected access grants.' }
}
$env:PARADIZE_SUNNY_TOKEN_FILE = $tokenPath
$env:PARADIZE_SUNNY_PORT = '4318'
Write-Output $tokenPath
