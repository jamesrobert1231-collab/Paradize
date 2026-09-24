// Synthetic test credentials only. Never import this helper in a product launcher.
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./create-test-certificate.ps1', import.meta.url));
const generationTimeoutMs = 20_000;
const maxOutputBytes = 64 * 1024;

function resolvePowerShell() {
  if (process.platform !== 'win32') {
    throw new Error('Synthetic gateway TLS tests require Windows and PowerShell 7; this platform is unsupported.');
  }
  // An explicit override must be an absolute executable path, never a command
  // name searched through PATH or a shell command assembled from user input.
  const override = process.env.PARADIZE_TEST_PWSH;
  const candidates = override ? [override] : [
    path.join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'powershell', 'pwsh.exe'),
    ...(process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe')] : []),
  ];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== 'pwsh.exe') continue;
    try {
      const executable = realpathSync(candidate);
      if (path.basename(executable).toLowerCase() === 'pwsh.exe' && statSync(executable).isFile()) return executable;
    } catch { /* Try only the next known absolute location. */ }
  }
  throw new Error('PowerShell 7 was not found. Set PARADIZE_TEST_PWSH to the absolute path of pwsh.exe.');
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid synthetic TLS fixture output.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > maxOutputBytes || bytes.toString('base64') !== value) {
    throw new Error('Invalid synthetic TLS fixture output.');
  }
  return bytes;
}

/** Make one short-lived localhost certificate entirely in test-process memory. */
export function createTestTls() {
  const executable = resolvePowerShell();
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
    shell: false, windowsHide: true, timeout: generationTimeoutMs, maxBuffer: maxOutputBytes,
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    env: {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      PARADIZE_SYNTHETIC_TLS_TEST: '1',
    },
  });
  // Captured stdout contains a synthetic private key. Neither child output nor
  // underlying exceptions may appear in test reports, even on a failure.
  if (result.error || result.status !== 0 || result.signal || result.stderr.trim()) {
    throw new Error('Synthetic TLS certificate generation failed or exceeded its 20-second/output limit; PowerShell 7 is required.');
  }
  try {
    const payload = JSON.parse(result.stdout);
    if (!payload || Array.isArray(payload) || Object.keys(payload).sort().join(',') !== 'certificateBase64,pfxBase64') throw new Error();
    const pfx = decodeBase64(payload.pfxBase64);
    const certificate = new X509Certificate(decodeBase64(payload.certificateBase64));
    const now = Date.now();
    if (certificate.ca || certificate.publicKey.asymmetricKeyType !== 'rsa' ||
        certificate.checkHost('localhost') !== 'localhost' || certificate.checkIP('127.0.0.1') !== '127.0.0.1' ||
        Date.parse(certificate.validFrom) > now || Date.parse(certificate.validFrom) < now - 10 * 60_000 ||
        Date.parse(certificate.validTo) <= now || Date.parse(certificate.validTo) > now + 61 * 60_000) throw new Error();
    return { pfx, ca: certificate.toString(), passphrase: '' };
  } catch {
    throw new Error('Synthetic TLS certificate generator returned invalid fixture data.');
  }
}
