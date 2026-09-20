param([Parameter(Mandatory=$true)][string]$ExportFile,[Parameter(Mandatory=$true)][string]$ExpectedOrigin)
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot)
$destination=Join-Path $root '.runtime\tech-help'
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$allowed=@($owner.Value,$system.Value)
foreach($candidate in @((Join-Path $root '.runtime'),$destination)) {
    if(Test-Path -LiteralPath $candidate) {
        $item=Get-Item -LiteralPath $candidate -Force
        if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Staging directories must be regular directories.'}
    } else {
        New-Item -ItemType Directory -Path $candidate | Out-Null
    }
}
$acl=Get-Acl -LiteralPath $destination
if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value){throw 'Staging directory belongs to another owner.'}
if(@(Get-ChildItem -LiteralPath $destination -Force).Count -eq 0) {
    $acl.SetAccessRuleProtection($true,$false)
    foreach($existing in @($acl.Access)){$acl.RemoveAccessRuleSpecific($existing)}
    foreach($sid in @($owner,$system)){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
    $item=[IO.DirectoryInfo]::new($destination)
    if($item.PSObject.Methods['SetAccessControl']){$item.SetAccessControl($acl)}else{[IO.FileSystemAclExtensions]::SetAccessControl($item,$acl)}
}
function Assert-Private($itemPath) {
    $item=Get-Item -LiteralPath $itemPath -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked staging entries are forbidden.'}
    $security=Get-Acl -LiteralPath $itemPath
    if($security.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value){throw 'Unexpected staging owner.'}
    foreach($rule in $security.Access) {
        if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed){throw 'Staging contains an unexpected access grant.'}
    }
}
Assert-Private $destination
if(-not (Get-Acl -LiteralPath $destination).AreAccessRulesProtected){throw 'Staging directory must have protected inheritance.'}
foreach($child in Get-ChildItem -LiteralPath $destination -Force){Assert-Private $child.FullName}
$node=Join-Path $root '.runtimes\node-v24.14.0-win-x64\node.exe'
if(-not(Test-Path -LiteralPath $node)){throw 'The project Node runtime is unavailable.'}
$result=& $node (Join-Path $PSScriptRoot 'tech-help.mjs') $ExportFile $ExpectedOrigin $destination
if($LASTEXITCODE -ne 0){throw 'Tech Help export could not be staged; original input retained.'}
foreach($child in Get-ChildItem -LiteralPath $destination -Force){Assert-Private $child.FullName}
$result
