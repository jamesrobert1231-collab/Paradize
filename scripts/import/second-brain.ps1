param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
& (Join-Path $repoRoot 'services/sunny-local/provision.ps1') | Out-Null
$sourceItem=Get-Item -LiteralPath $Source
if($sourceItem.Extension -ne '.docx' -or $sourceItem.Length -gt 10MB -or ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'A local DOCX below 10 MiB is required; linked sources need separate review.'}
$stream=[IO.File]::Open($sourceItem.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
$memory=[IO.MemoryStream]::new()
try{$stream.CopyTo($memory)}finally{$stream.Dispose()}
$originalBytes=$memory.ToArray()
$memory.Position=0
Add-Type -AssemblyName System.IO.Compression
$archive=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read,$true)
try{
 $parts=@($archive.Entries | Where-Object FullName -eq 'word/document.xml')
 if($parts.Count -ne 1 -or $parts[0].Length -gt 2MB){throw 'DOCX body is missing, duplicated or oversized'}
 $settings=[Xml.XmlReaderSettings]::new()
 $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
 $settings.XmlResolver=$null
 $settings.MaxCharactersInDocument=2MB
 $partStream=$parts[0].Open()
 $reader=[Xml.XmlReader]::Create($partStream,$settings)
 try{$document=[Xml.XmlDocument]::new();$document.XmlResolver=$null;$document.Load($reader)}finally{$reader.Dispose();$partStream.Dispose()}
 $ns=[Xml.XmlNamespaceManager]::new($document.NameTable)
 $ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
 $paragraphs=@(foreach($paragraph in $document.SelectNodes('//w:body//w:p',$ns)){
   $pieces=@(foreach($textNode in $paragraph.SelectNodes('.//w:t | .//w:tab | .//w:br',$ns)){
    if($textNode.LocalName -eq 'tab'){"`t"}elseif($textNode.LocalName -eq 'br'){"`n"}else{$textNode.InnerText}
   })
   $pieces -join ''
 })
 $text=$paragraphs -join "`n"
 if($text.Length -gt 200000 -or [string]::IsNullOrWhiteSpace($text)){throw 'Extracted text is empty or oversized'}
}finally{$archive.Dispose();$memory.Dispose()}
$stage=Join-Path $repoRoot ('.runtime/sunny/import-'+[Guid]::NewGuid().ToString('N')+'.json')
$packet=@{source=$sourceItem.FullName;title=$sourceItem.BaseName;text=$text;originalBase64=[Convert]::ToBase64String($originalBytes)}
try{
 [IO.File]::WriteAllText($stage,($packet|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
 & (Join-Path $repoRoot '.runtimes/node-v24.14.0-win-x64/node.exe') (Join-Path $repoRoot 'scripts/import/knowledge-packet.mjs') $stage (Join-Path $repoRoot '.runtime/sunny/knowledge')
 if($LASTEXITCODE -ne 0){throw 'Knowledge import failed; originals retained'}
}finally{if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage}}
