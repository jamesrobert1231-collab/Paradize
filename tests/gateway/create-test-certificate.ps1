# Synthetic test credentials only. Never use this helper for a product launcher.
# CertificateRequest and RSA.Create keep the key in memory; no certificate store
# is opened and no key, PFX, or certificate is written to the filesystem.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$rsa = $null
$certificate = $null
$pfx = $null
try {
    if ($env:PARADIZE_SYNTHETIC_TLS_TEST -ne '1' -or $PSVersionTable.PSVersion.Major -lt 7) {
        throw 'Unsupported test invocation.'
    }
    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=localhost', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('localhost')
    $san.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'))
    $request.CertificateExtensions.Add($san.Build())
    $request.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $usage = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment
    $request.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new($usage, $true))
    $purposes = [System.Security.Cryptography.OidCollection]::new()
    [void]$purposes.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $request.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($purposes, $true))
    $now = [DateTimeOffset]::UtcNow
    $certificate = $request.CreateSelfSigned($now.AddMinutes(-5), $now.AddHours(1))
    $pfx = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, '')
    $result = @{
        pfxBase64 = [Convert]::ToBase64String($pfx)
        certificateBase64 = [Convert]::ToBase64String($certificate.RawData)
    } | ConvertTo-Json -Compress
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::Out.Write($result)
} catch {
    # Never forward runtime diagnostics that could include the generated key.
    [Console]::Error.WriteLine('Synthetic TLS certificate generation failed.')
    exit 1
} finally {
    if ($null -ne $pfx) { [Array]::Clear($pfx, 0, $pfx.Length) }
    if ($null -ne $certificate) { $certificate.Dispose() }
    if ($null -ne $rsa) { $rsa.Dispose() }
}
