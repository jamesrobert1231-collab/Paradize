import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyDrivePartsStream, readPartRequests, validateDownloadUrl, fetchPartStream, formatVerificationOutput } from '../../scripts/recovery/verify-drive-parts-stream.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const url = 'https://downloads.example.oaiusercontent.com/file?token=secret-test-token';
function fixture() {
  const pieces = [Buffer.from('Hello '), Buffer.from('world!')];
  const manifest = { version: 1, backupId: 'synthetic', sourceName: 'installer.bin', sourceBytes: 12,
    sourceSha256: 'c0535e4be2b79ffd93291305436bf889314e4a3faec05ecffcbb7df31ad9e51a',
    parts: pieces.map((bytes, offset) => ({ index: offset + 1, filename: `part${offset + 1}`, bytes: bytes.length,
      sha256: hash(bytes), driveFileId: `file-${offset + 1}` })) };
  const requests = manifest.parts.map(part => ({ index: part.index, driveFileId: part.driveFileId, downloadUrl: url }));
  return { manifest, requests, pieces, openPart: async request => (async function* () {
    for (const byte of pieces[request.index - 1]) yield Buffer.from([byte]);
  })() };
}

test('verifies independently known full hash across streamed chunks without file output', async () => {
  const f = fixture(); const progress = [];
  const result = await verifyDrivePartsStream({ ...f, onPartVerified: part => progress.push(part) });
  assert.equal(result.verified, true); assert.equal(result.restored, false);
  assert.equal(result.verificationMode, 'ordered-cloud-stream');
  assert.equal(result.sourceSha256, f.manifest.sourceSha256); assert.equal(result.sourceBytes, 12);
  assert.equal(result.partCount, 2); assert.equal(progress.length, 2);
  assert.ok(!JSON.stringify({ result, progress }).includes('secret-test-token'));
});

test('rejects reordered, mismatched, missing and trailing descriptors', async () => {
  for (const kind of ['order', 'id', 'missing', 'trailing', 'extra-key']) {
    const f = fixture();
    if (kind === 'order') f.requests.reverse();
    if (kind === 'id') f.requests[0].driveFileId = 'different';
    if (kind === 'missing') f.requests.pop();
    if (kind === 'trailing') f.requests.push(f.requests[0]);
    if (kind === 'extra-key') f.requests[0].credentials = 'private';
    await assert.rejects(verifyDrivePartsStream(f));
  }
});

test('rejects corrupt, short, overrun, oversized and non-byte body chunks', async () => {
  for (const value of [Buffer.from('bad!!!'), Buffer.from('short'), Buffer.alloc(7), Buffer.alloc(1024 * 1024 + 1), 'Hello ']) {
    const f = fixture(); f.openPart = async () => [value];
    await assert.rejects(verifyDrivePartsStream(f));
  }
});

test('checks complete hash even when all individual hashes match', async () => {
  const f = fixture(); f.manifest.sourceSha256 = '0'.repeat(64);
  await assert.rejects(verifyDrivePartsStream(f), /complete-hash-mismatch/);
});

test('rejects invalid manifests before opening any stream', async () => {
  const f = fixture(); f.manifest.parts[0].filename = '../escape';
  f.openPart = () => assert.fail('must not open');
  await assert.rejects(verifyDrivePartsStream(f), /invalid-manifest/);
});

test('URL boundary rejects credentials, fragments, redirects and non-approved hosts', () => {
  assert.equal(validateDownloadUrl(url), url);
  for (const value of ['http://a.oaiusercontent.com/a', 'https://oaiusercontent.com/a',
    'https://a.oaiusercontent.com.evil.example/a', 'https://a.oaiusercontent.com@evil.example/a',
    'https://user:pass@a.oaiusercontent.com/a', 'https://a.oaiusercontent.com:444/a',
    'https://a.oaiusercontent.com/a#secret', 'https://a.oaiusercontent.com\\@evil.example/a',
    ' https://a.oaiusercontent.com/a', 'https://a.oaiusercontent.com/a\n', 'file:///tmp/private',
    `https://a.oaiusercontent.com/${'x'.repeat(9000)}`]) assert.throws(() => validateDownloadUrl(value));
});

test('bounds input waiting, including terminal EOF, and aborts timed out body reads', async () => {
  const never = () => new Promise(() => {});
  const f = fixture(); let signal;
  f.openPart = async (_request, options) => { signal = options.signal; return { [Symbol.asyncIterator]: () => ({ next: never }) }; };
  await assert.rejects(verifyDrivePartsStream({ ...f, partTimeoutMs: 20 }), /part-timeout/);
  assert.equal(signal.aborted, true);
  const g = fixture(); g.requests = { [Symbol.asyncIterator]: () => ({ next: never }) };
  await assert.rejects(verifyDrivePartsStream({ ...g, inputTimeoutMs: 20 }), /input-timeout/);
  const h = fixture(); let i = 0; const entries = h.requests;
  h.requests = { [Symbol.asyncIterator]: () => ({ next: () => i < entries.length ? Promise.resolve({ value: entries[i++], done: false }) : never() }) };
  await assert.rejects(verifyDrivePartsStream({ ...h, inputTimeoutMs: 20 }), /input-timeout/);
});

test('bounds slow stream by whole-part deadline rather than resetting after chunks', async () => {
  const f = fixture(); let signal;
  f.openPart = async (_request, options) => { signal = options.signal; return (async function* () {
    for (let i = 0; i < 6; i++) { await new Promise(resolve => setTimeout(resolve, 12)); yield Buffer.from('H'); }
  })(); };
  await assert.rejects(verifyDrivePartsStream({ ...f, partTimeoutMs: 30 }), /part-timeout/);
  assert.equal(signal.aborted, true);
});

test('sanitizes arbitrary errors from input, HTTP, streams and progress callbacks', async () => {
  const secret = `failure ${url}`;
  for (const seam of ['input', 'open', 'body', 'callback']) {
    const f = fixture();
    if (seam === 'input') f.requests = { [Symbol.asyncIterator]: () => ({ next() { throw new Error(secret); } }) };
    if (seam === 'open') f.openPart = async () => { throw new Error(secret); };
    if (seam === 'body') f.openPart = async () => (async function* () { throw new Error(secret); })();
    if (seam === 'callback') f.onPartVerified = () => { throw new Error(secret); };
    await assert.rejects(verifyDrivePartsStream(f), error => !error.message.includes(secret) && !error.stack.includes(url));
  }
});

test('NDJSON parser supports byte splits and CRLF but rejects oversized, invalid and extra blank lines', async () => {
  const f = fixture(); const encoded = Buffer.from(f.requests.map(entry => JSON.stringify(entry)).join('\r\n') + '\r\n');
  const input = (async function* () { for (let i = 0; i < encoded.length; i += 7) yield encoded.subarray(i, i + 7); })();
  const parsed = []; for await (const value of readPartRequests(input)) parsed.push(value);
  assert.deepEqual(parsed, f.requests);
  for (const data of [Buffer.from('bad\n'), Buffer.from('\n'), Buffer.alloc(0), Buffer.alloc(17000, 120), Buffer.alloc(65537),
    Buffer.from([0xff, 10]), Buffer.from('\ufeff{}\n')]) {
    await assert.rejects(async () => { for await (const unused of readPartRequests([data])) void unused; });
  }
});

test('framed terminal input requires an exact final marker and rejects buffered trailing input', async () => {
  const f = fixture();
  const bytes = Buffer.from(f.requests.map(entry => JSON.stringify(entry)).join('\n') + '\n{"end":true}\n');
  const result = await verifyDrivePartsStream({ ...f, requests: readPartRequests([bytes], { terminalMarker: true }) });
  assert.equal(result.verified, true);
  for (const separator of ['\r', '\r\n']) {
    const rawBytes = Buffer.from(f.requests.map(entry => JSON.stringify(entry)).join(separator) + separator + '{"end":true}' + separator);
    const splitInput = (async function* () { for (const byte of rawBytes) yield Buffer.from([byte]); })();
    const rawResult = await verifyDrivePartsStream({ ...f, requests: readPartRequests(splitInput, { terminalMarker: true }) });
    assert.equal(rawResult.verified, true);
  }
  for (const suffix of ['', '{"end":true}', '{"end":true,"extra":1}\n', '{"end":true}\n{}\n', '{"end":true}\n\n']) {
    const input = Buffer.from(f.requests.map(entry => JSON.stringify(entry)).join('\n') + '\n' + suffix);
    await assert.rejects(verifyDrivePartsStream({ ...f, requests: readPartRequests([input], { terminalMarker: true }) }));
  }
  await assert.rejects(verifyDrivePartsStream({ ...f,
    requests: readPartRequests([Buffer.from('{"end":true}\n')], { terminalMarker: true }) }), /missing-part/);
});

test('HTTP boundary disables redirects and credentials and validates response metadata', async () => {
  let options; const bytes = Buffer.from('Hello ');
  const stream = await fetchPartStream({ downloadUrl: url }, { expectedBytes: 6, signal: new AbortController().signal,
    fetcher: async (_url, init) => { options = init; return new Response(bytes, { headers: { 'Content-Length': '6' } }); } });
  const output = []; for await (const chunk of stream) output.push(chunk);
  assert.equal(Buffer.concat(output).toString(), 'Hello ');
  assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers.Authorization, undefined);
  for (const response of [new Response(bytes, { status: 302 }), new Response(bytes, { status: 403 }),
    new Response(bytes, { headers: { 'Content-Length': '7' } }), new Response(bytes, { headers: { 'Content-Encoding': 'gzip' } })]) {
    await assert.rejects(fetchPartStream({ downloadUrl: url }, { expectedBytes: 6, fetcher: async () => response }));
  }
  await assert.rejects(fetchPartStream({ downloadUrl: url }, { expectedBytes: 6, fetcher: async () => { throw new Error(url); } }), error => !error.stack.includes(url));
});

test('terminal output stays below 75 columns at manifest limits and preserves full piped receipts', async () => {
  const f = fixture(); f.manifest.sourceName = 'x'.repeat(236) + '.bin'; f.manifest.backupId = 'y'.repeat(256);
  const progress = [], terminal = { terminal: true };
  const result = await verifyDrivePartsStream({ ...f, onPartVerified: receipt => progress.push(receipt) });
  const ready = { ready: true, partCount: 10000, inputMode: 'raw-terminal-frames' };
  const largestPart = { ...progress[0], index: 10000, driveFileId: 'z'.repeat(256) };
  const largestResult = { ...result, partCount: 10000, sourceBytes: 1024 ** 4 };
  for (const receipt of [ready, largestPart, largestResult]) {
    const text = formatVerificationOutput(receipt, terminal);
    assert.ok(text.trimEnd().split('\n').every(line => line.length < 75));
    assert.ok(!text.includes(f.manifest.sourceName)); assert.ok(!text.includes(f.manifest.backupId));
    assert.ok(!text.includes('secret-test-token')); assert.ok(!text.includes('z'.repeat(256)));
    assert.deepEqual(JSON.parse(formatVerificationOutput(receipt)), receipt);
  }
  assert.equal(formatVerificationOutput(largestPart, terminal), '{"index":10000,"partVerified":true}\n');
  const lines = formatVerificationOutput(result, terminal).trimEnd().split('\n');
  assert.deepEqual(JSON.parse(lines[0]), { verified: true, partCount: 2, sourceBytes: 12 });
  assert.equal(lines[1], `SHA256 ${f.manifest.sourceSha256}`);
  assert.deepEqual(JSON.parse(lines[2]), { restored: false });
  assert.ok(!formatVerificationOutput(largestPart, terminal).includes('SHA256'));
  assert.throws(() => formatVerificationOutput({ ...result, verified: false }, terminal), /invalid-output-receipt/);
  assert.throws(() => formatVerificationOutput({ ...result, sourceSha256: url }, terminal), /invalid-output-receipt/);
});
