import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { importDocument } from './knowledge.mjs';
import { createSunnyServer } from './server.mjs';

const token = 'b'.repeat(64);
const headers = { Authorization: `Bearer ${token}` };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-original-test-'));
  const directory = path.join(root, 'store');
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x20, 0x0d, 0x0a]);
  const source = path.join(root, 'original-source.docx');
  fs.writeFileSync(source, bytes);
  const document = { source, title: 'Preserved source', text: 'Financial planning remains unverified.', originalBytes: bytes };
  const imported = importDocument(directory, document);
  let calls = 0;
  const server = createSunnyServer({ token, knowledgeDirectory: directory, fetcher: async () => { calls++; throw new Error('No provider needed'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(calls, 0, 'Original retrieval must make zero provider calls');
  });
  return { root, directory, bytes, source, document, id: imported.id, url: `http://127.0.0.1:${server.address().port}` };
}

test('search identifiers retrieve exact preserved revisions as private attachments, including during STOP', async t => {
  const f = await fixture(t);
  const revisionBytes = Buffer.from('second immutable revision');
  const revision = importDocument(f.directory, { ...f.document, originalBytes: revisionBytes, text: 'Financial revised evidence.' });
  fs.writeFileSync(f.source, 'later changes outside PARADIZE');
  const originalsBefore = fs.readFileSync(path.join(f.directory, 'index.json'));
  const search = await (await fetch(f.url + '/knowledge/search?q=financial', { headers })).json();
  assert.equal(search.results.length, 2);
  await fetch(f.url + '/control/stop', { method: 'POST', headers });
  for (const [id, bytes] of [[f.id, f.bytes], [revision.id, revisionBytes]]) {
    assert.ok(search.results.some(r => r.id === id));
    const response = await fetch(f.url + '/knowledge/original/' + id, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('content-disposition'), `attachment; filename="${id}.original"`);
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-paradize-original-sha256'), digest(bytes));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  assert.deepEqual(fs.readFileSync(path.join(f.directory, 'index.json')), originalsBefore);
  assert.equal(fs.readFileSync(f.source, 'utf8'), 'later changes outside PARADIZE');
});

test('original downloads retain owner, origin and forwarding boundaries', async t => {
  const f = await fixture(t);
  const url = f.url + '/knowledge/original/' + f.id;
  for (const [requestHeaders, status] of [
    [{}, 401], [{ Authorization: `Bearer ${'c'.repeat(64)}` }, 401],
    [{ ...headers, Origin: 'https://untrusted.example' }, 403],
    [{ ...headers, 'X-Forwarded-For': '127.0.0.1' }, 403],
  ]) {
    const response = await fetch(url, { headers: requestHeaders });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('content-disposition'), null);
    assert.notDeepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
  }
});

test('only an exact imported id is accepted; paths, encodings, query overrides and unknown ids fail', async t => {
  const f = await fixture(t);
  for (const suffix of ['0'.repeat(64), f.id + '?path=' + encodeURIComponent(f.source), '%2e%2e%2fsecret', f.id.toUpperCase(), f.id + '/extra']) {
    const response = await fetch(f.url + '/knowledge/original/' + suffix, { headers });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-disposition'), null);
  }
});

test('damaged and oversized stored originals fail before any attachment bytes are returned', async t => {
  const f = await fixture(t);
  const file = path.join(f.directory, f.id + '.original');
  fs.writeFileSync(file, Buffer.alloc(f.bytes.length, 0x41));
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) { const fd = fs.openSync(file, 'r+'); fs.ftruncateSync(fd, 10 * 1024 * 1024 + 1); fs.closeSync(fd); }
    const response = await fetch(f.url + '/knowledge/original/' + f.id, { headers });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('content-disposition'), null);
    assert.equal((await response.json()).code, 'knowledge-original-unavailable');
  }
});

test('a linked knowledge directory cannot redirect original downloads to another directory', async t => {
  const f = await fixture(t);
  const moved = path.join(f.root, 'moved');
  fs.renameSync(f.directory, moved);
  fs.symlinkSync(moved, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  const response = await fetch(f.url + '/knowledge/original/' + f.id, { headers });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('content-disposition'), null);
  assert.equal((await response.json()).code, 'knowledge-original-unavailable');
});

test('altered ownership or historical authority never exposes a preserved attachment', async t => {
  const f = await fixture(t);
  const indexPath = path.join(f.directory, 'index.json');
  const baseline = fs.readFileSync(indexPath, 'utf8');
  for (const alteration of [{ owner: 'different-owner' }, { historicalAuthority: true }]) {
    const index = JSON.parse(baseline);
    Object.assign(index.records[0], alteration);
    fs.writeFileSync(indexPath, JSON.stringify(index));
    const response = await fetch(f.url + '/knowledge/original/' + f.id, { headers });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('content-disposition'), null);
    assert.equal((await response.json()).code, 'knowledge-original-unavailable');
  }
});
