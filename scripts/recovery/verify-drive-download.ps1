param(
    [Parameter(Mandatory=$true)][string]$DownloadUrl,
    [Parameter(Mandatory=$true)][string]$DriveFileId,
    [Parameter(Mandatory=$true)][long]$ExpectedBytes,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [ValidateRange(1,120)][int]$HeaderTimeoutSeconds=30,
    [ValidateRange(1,120)][int]$ReadTimeoutSeconds=30,
    [ValidateRange(1,7200)][int]$OverallTimeoutSeconds=3600
)
$ErrorActionPreference='Stop'
$uri=$null
if(-not [Uri]::TryCreate($DownloadUrl,[UriKind]::Absolute,[ref]$uri) -or
    $uri.Scheme -ne 'https' -or
    -not $uri.Host.EndsWith('.oaiusercontent.com',[StringComparison]::OrdinalIgnoreCase) -or
    $uri.UserInfo.Length -ne 0 -or
    $DriveFileId -notmatch '^[a-zA-Z0-9_-]{10,200}$' -or
    $ExpectedBytes -lt 1 -or $ExpectedBytes -gt 8GB -or
    $ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$'){
    throw 'Invalid streamed download verification parameters.'
}
Add-Type -AssemblyName System.Net.Http
$handler=$null
$client=$null
$request=$null
$response=$null
$stream=$null
$cancellation=$null
$sha=$null
try {
    $handler=[Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect=$false
    $handler.UseCookies=$false
    $client=[Net.Http.HttpClient]::new($handler,$true)
    $client.Timeout=[Threading.Timeout]::InfiniteTimeSpan
    $cancellation=[Threading.CancellationTokenSource]::new()
    $cancellation.CancelAfter([TimeSpan]::FromSeconds($OverallTimeoutSeconds))
    $request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,$uri)
    $sha=[Security.Cryptography.SHA256]::Create()

    # Headers-only completion prevents buffering an entire installer in memory.
    $headers=$client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancellation.Token)
    if(-not $headers.Wait($HeaderTimeoutSeconds*1000,$cancellation.Token)){
        throw 'Download headers timed out.'
    }
    $response=$headers.GetAwaiter().GetResult()
    $null=$response.EnsureSuccessStatusCode()
    $contentLength=$response.Content.Headers.ContentLength
    if($null -ne $contentLength -and $contentLength -ne $ExpectedBytes){throw 'Unexpected download length.'}

    $streamTask=$response.Content.ReadAsStreamAsync()
    if(-not $streamTask.Wait($HeaderTimeoutSeconds*1000,$cancellation.Token)){
        throw 'Download stream timed out.'
    }
    $stream=$streamTask.GetAwaiter().GetResult()
    $buffer=New-Object byte[] (1MB)
    $total=0L
    while($true){
        $cancellation.Token.ThrowIfCancellationRequested()
        $readTask=$stream.ReadAsync($buffer,0,$buffer.Length,$cancellation.Token)
        # A bounded wait also covers streams that ignore read cancellation.
        if(-not $readTask.Wait($ReadTimeoutSeconds*1000,$cancellation.Token)){
            throw 'Download body timed out.'
        }
        $read=$readTask.GetAwaiter().GetResult()
        if($read -eq 0){break}
        $total+=$read
        if($total -gt $ExpectedBytes){throw 'Downloaded size exceeds expected file.'}
        $null=$sha.TransformBlock($buffer,0,$read,$buffer,0)
    }
    $null=$sha.TransformFinalBlock([byte[]]@(),0,0)
    $actual=([BitConverter]::ToString($sha.Hash)).Replace('-','').ToLowerInvariant()
    if($total -ne $ExpectedBytes -or $actual -ne $ExpectedSha256.ToLowerInvariant()){
        throw 'Downloaded file does not match source bytes.'
    }
    [pscustomobject]@{
        Verified=$true
        DriveFileId=$DriveFileId
        Bytes=$total
        SHA256=$actual
        VerifiedAt=[DateTime]::UtcNow.ToString('O')
    } | ConvertTo-Json
} catch {throw 'Drive download verification failed; retain the original and staging file.'}
finally {
    if($null -ne $cancellation){$cancellation.Cancel()}
    if($null -ne $stream){$stream.Dispose()}
    if($null -ne $response){$response.Dispose()}
    if($null -ne $request){$request.Dispose()}
    if($null -ne $client){$client.Dispose()} elseif($null -ne $handler){$handler.Dispose()}
    if($null -ne $sha){$sha.Dispose()}
    if($null -ne $cancellation){$cancellation.Dispose()}
}
