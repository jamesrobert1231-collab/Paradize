import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, validateDrivePartsManifest } from './restore-drive-parts.mjs';

const MAX_LINE_BYTES = 16 * 1024;
const MAX_INPUT_CHUNK = 64 * 1024;
const MAX_BODY_CHUNK = 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
class VerificationError extends Error {
  constructor(code) { super(code); this.name = 'VerificationError'; }
}
const fail = code => { throw new VerificationError(code); };
const sanitize = (error, fallback) => error instanceof VerificationError ? error : new VerificationError(fallback);
function iterator(value) {
  const result = value?.[Symbol.asyncIterator]?.() ?? value?.[Symbol.iterator]?.();
  if (!result || typeof result.next !== 'function') fail('invalid-stream');
  return result;
}
function discardIterator(value) {
  // Never wait indefinitely for an uncooperative source's cleanup operation.
  try { Promise.resolve(value?.return?.()).catch(() => {}); } catch { /* No source errors or URLs are logged. */ }
}
function positiveDeadline(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 30 * 60 * 1000) fail('invalid-deadline');
  return value;
}
async function bounded(operation, milliseconds, code) {
  if (milliseconds <= 0) fail(code);
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new VerificationError(code)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export function validateDownloadUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\\x00-\x1f\x7f]/.test(value)) fail('invalid-download-url');
  let parsed;
  try { parsed = new URL(value); } catch { fail('invalid-download-url'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.oaiusercontent.com') ||
      !/^[a-z0-9.-]+\.oaiusercontent\.com$/.test(parsed.hostname) || parsed.username || parsed.password ||
      parsed.port || parsed.hash) fail('invalid-download-url');
  return parsed.href;
}

// URLs only live in input buffers and the HTTP request. Never include them in receipts or errors.
export async function* readPartRequests(input, { terminalMarker = false } = {}) {
  let pending = Buffer.alloc(0), skipLineFeed = false;
  try {
    for await (const chunk of input) {
      if (!(chunk instanceof Uint8Array) || !chunk.byteLength || chunk.byteLength > MAX_INPUT_CHUNK) fail('input-chunk-limit');
      let start = 0;
      while (start < chunk.byteLength) {
        // Windows raw console Enter arrives as CR; piped NDJSON remains LF/CRLF.
        if (skipLineFeed) { skipLineFeed = false; if (chunk[start] === 10) { start++; continue; } }
        const lf = chunk.indexOf(10, start), cr = terminalMarker ? chunk.indexOf(13, start) : -1;
        const end = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr), next = end < 0 ? chunk.byteLength : end;
        if (pending.length + next - start > MAX_LINE_BYTES) fail('input-line-limit');
        pending = Buffer.concat([pending, chunk.subarray(start, next)]);
        start = end < 0 ? chunk.byteLength : end + 1;
        if (end < 0) continue;
        skipLineFeed = terminalMarker && chunk[end] === 13;
        const record = parseLine(pending); pending = Buffer.alloc(0);
        if (terminalMarker && record?.end === true && Object.keys(record).length === 1) {
          if (skipLineFeed && chunk[start] === 10) start++;
          if (start !== chunk.byteLength) fail('trailing-input');
          return;
        }
        yield record;
      }
    }
    if (terminalMarker) fail('missing-terminal-marker');
    if (pending.length) yield parseLine(pending);
  } catch (error) { throw sanitize(error, 'input-read-failed'); }
}

function parseLine(bytes) {
  try {
    if (!bytes.length) fail('invalid-input-line');
    const text = decoder.decode(bytes);
    if (!text.trim() || text.charCodeAt(0) === 0xfeff) fail('invalid-input-line');
    return JSON.parse(text);
  } catch (error) { throw sanitize(error, 'invalid-input-line'); }
}

export async function fetchPartStream(request, { expectedBytes, signal, fetcher = fetch } = {}) {
  let response;
  try {
    response = await fetcher(validateDownloadUrl(request.downloadUrl), {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
      headers: { 'Accept-Encoding': 'identity' },
    });
    const length = response.headers.get('content-length'), encoding = response.headers.get('content-encoding');
    if (response.status !== 200 || response.redirected || !response.body ||
        (encoding && encoding.toLowerCase() !== 'identity') ||
        (length !== null && (!/^\d+$/.test(length) || Number(length) !== expectedBytes))) fail('invalid-http-response');
    // Node fetch is deliberately used without a cookie jar or authorization headers.
    return response.body;
  } catch (error) {
    try { await response?.body?.cancel(); } catch { /* Keep response diagnostics private. */ }
    throw sanitize(error, 'download-failed');
  }
}

/** Hash the ordered cloud bytes without creating a restored installer or temporary parts. */
export async function verifyDrivePartsStream({ manifest, requests, openPart = fetchPartStream,
  inputTimeoutMs = 5 * 60 * 1000, partTimeoutMs = 2 * 60 * 1000, onPartVerified } = {}) {
  let source, inputs;
  try {
    try { source = validateDrivePartsManifest(structuredClone(manifest)); } catch { fail('invalid-manifest'); }
    positiveDeadline(inputTimeoutMs); positiveDeadline(partTimeoutMs);
    inputs = iterator(requests);
    const completeHash = createHash('sha256'); let total = 0;
    for (const part of source.parts) {
      const next = await bounded(() => inputs.next(), inputTimeoutMs, 'input-timeout');
      if (next.done) fail('missing-part');
      const request = next.value;
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          Object.keys(request).sort().join(',') !== 'downloadUrl,driveFileId,index' ||
          request.index !== part.index || request.driveFileId !== part.driveFileId) fail('part-order-or-identity-mismatch');
      const downloadUrl = validateDownloadUrl(request.downloadUrl);
      const controller = new AbortController(), deadline = performance.now() + partTimeoutMs;
      let body;
      try {
        body = iterator(await bounded(() => openPart({ index: part.index, driveFileId: part.driveFileId, downloadUrl },
          { expectedBytes: part.bytes, signal: controller.signal }), deadline - performance.now(), 'part-timeout'));
        const partHash = createHash('sha256'); let bytes = 0;
        while (true) {
          const read = await bounded(() => body.next(), deadline - performance.now(), 'part-timeout');
          if (read.done) break;
          const chunk = read.value;
          if (!(chunk instanceof Uint8Array) || !chunk.byteLength || chunk.byteLength > MAX_BODY_CHUNK) fail('body-chunk-limit');
          bytes += chunk.byteLength;
          if (bytes > part.bytes) fail('part-byte-overrun');
          partHash.update(chunk); completeHash.update(chunk);
        }
        if (bytes !== part.bytes || partHash.digest('hex') !== part.sha256) fail('part-hash-or-size-mismatch');
        total += bytes;
        if (onPartVerified) await bounded(() => onPartVerified({ index: part.index, driveFileId: part.driveFileId,
          bytes, sha256: part.sha256, partVerified: true }), inputTimeoutMs, 'progress-timeout');
      } finally { controller.abort(); discardIterator(body); }
    }
    if (!(await bounded(() => inputs.next(), inputTimeoutMs, 'input-timeout')).done) fail('trailing-input');
    const sourceSha256 = completeHash.digest('hex');
    if (total !== source.sourceBytes || sourceSha256 !== source.sourceSha256) fail('complete-hash-mismatch');
    return { version: 1, backupId: source.backupId, verified: true, restored: false,
      verificationMode: 'ordered-cloud-stream', sourceName: source.sourceName, sourceBytes: total,
      sourceSha256, partCount: source.parts.length };
  } catch (error) { throw sanitize(error, 'stream-verification-failed'); }
  finally { discardIterator(inputs); }
}

// ConPTY may cursor-wrap long JSON lines. Terminal receipts keep every line below
// 75 columns; full receipts remain available through the ordinary piped interface.
export function formatVerificationOutput(receipt, { terminal = false } = {}) {
  if (!terminal) return `${JSON.stringify(receipt)}\n`;
  if (receipt?.ready === true) {
    return `${JSON.stringify({ ready: true, partCount: receipt.partCount, inputMode: 'raw-terminal-frames' })}\n`;
  }
  if (receipt?.partVerified === true) {
    return `${JSON.stringify({ index: receipt.index, partVerified: true })}\n`;
  }
  if (receipt?.verified === true && receipt.restored === false && /^[a-f0-9]{64}$/.test(receipt.sourceSha256)) {
    return `${JSON.stringify({ verified: true, partCount: receipt.partCount, sourceBytes: receipt.sourceBytes })}\n` +
      `SHA256 ${receipt.sourceSha256}\n${JSON.stringify({ restored: false })}\n`;
  }
  fail('invalid-output-receipt');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), terminalMarker = args[0] === '--tty';
  const positional = terminalMarker ? args.slice(1) : args;
  let raw = false;
  try {
    if (positional.length !== 1 || positional[0].startsWith('--')) fail('usage: node verify-drive-parts-stream.mjs [--tty] manifest.json');
    if (terminalMarker) {
      if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') fail('tty-required');
      process.stdin.setRawMode(true); raw = true;
    } else if (process.stdin.isTTY) fail('use-tty-mode-to-disable-input-echo');
    const manifest = await readManifest(path.resolve(positional[0]));
    const output = receipt => process.stdout.write(formatVerificationOutput(receipt, { terminal: terminalMarker }));
    output({ ready: true, partCount: manifest.parts.length, inputMode: terminalMarker ? 'raw-terminal-frames' : 'ndjson-eof' });
    const result = await verifyDrivePartsStream({ manifest, requests: readPartRequests(process.stdin, { terminalMarker }),
      onPartVerified: output });
    output(result);
  } catch (error) {
    process.stderr.write(`Verification failed: ${sanitize(error, 'verification-failed').message}\n`); process.exitCode = 1;
  } finally {
    try { if (raw) process.stdin.setRawMode(false); }
    finally {
      // A timed-out async read may still own the terminal handle. Closing it
      // settles that read and lets the CLI exit instead of lingering silently.
      process.stdin.pause();
      process.stdin.destroy();
      process.stdin.unref?.();
    }
  }
}
