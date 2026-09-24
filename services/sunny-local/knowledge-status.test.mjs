import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { importDocument, readKnowledgeOriginal } from './knowledge.mjs';
import { createSunnyServer } from './server.mjs';

async function fixture(t, { configured = true, tokenFile = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-knowledge-status-'));
  const directory = path.join(root, 'store');
  const token = '6'.repeat(64);
  const credentials = path.join(root, 'synthetic-token');
  if (tokenFile) fs.writeFileSync(credentials, token);
  let inferenceRequests = 0;
  const server = createSunnyServer({
    token, ...(tokenFile ? { tokenFile: credentials } : {}),
    knowledgeDirectory: configured ? directory : undefined,
    fetcher: async () => { inferenceRequests++; throw new Error('Inference must not be requested'); },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    assert.equal(inferenceRequests, 0, 'Inventory must never call model discovery or inference');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = async (headers = {}, route = '/knowledge/status', method = 'GET') => {
    const response = await fetch(url + route, { method, headers: { Authorization: `Bearer ${token}`, ...headers } });
    return { response, body: await response.json() };
  };
  const document = { source: path.join(root, 'private-source.md'), title: 'Private title', text: 'Private synthetic text.', originalBytes: Buffer.from('synthetic original') };
  return { root, directory, document, request, credentials, port: server.address().port };
}

function unavailable(result) {
  assert.equal(result.response.status, 503);
  assert.equal(result.body.status, 'unavailable');
  assert.equal(result.body.code, 'knowledge-status-unavailable');
  assert.equal(Object.hasOwn(result.body, 'recordCount'), false);
  assert.equal(Object.hasOwn(result.body, 'sourceCount'), false);
  assert.equal(Object.hasOwn(result.body, 'knowledgeState'), false);
}

test('inventory counts retained revisions and exact source identities without disclosing document metadata or writing', async t => {
  const f = await fixture(t);
  importDocument(f.directory, f.document);
  importDocument(f.directory, f.document);
  importDocument(f.directory, { ...f.document, text: 'Revised synthetic text.', originalBytes: Buffer.from('revised original') });
  importDocument(f.directory, { ...f.document, source: path.join(f.root, 'second-private-source.md') });
  const before = new Map(fs.readdirSync(f.directory).map(name => [name, fs.readFileSync(path.join(f.directory, name))]));
  const { response, body } = await f.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(body, {
    status: 'complete', knowledgeState: 'index-ready', recordCount: 3, sourceCount: 2,
    originalVerification: 'on-access', historicalAuthority: false,
    service: 'paradize-sunny-local', protocolVersion: 2, localOnlyPolicyRequired: true,
    provider: 'ollama', paidRequestsEnabled: false,
  });
  assert.deepEqual(fs.readdirSync(f.directory), [...before.keys()]);
  for (const [name, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(f.directory, name)), bytes);
});

test('only an existing valid empty index reports no-records', async t => {
  const f = await fixture(t);
  unavailable(await f.request());
  fs.mkdirSync(f.directory);
  unavailable(await f.request());
  fs.writeFileSync(path.join(f.directory, 'index.json'), JSON.stringify({ version: 1, records: [] }));
  const { response, body } = await f.request();
  assert.equal(response.status, 200);
  assert.equal(body.knowledgeState, 'no-records');
  assert.equal(body.recordCount, 0);
  assert.equal(body.sourceCount, 0);
  assert.equal(body.originalVerification, 'on-access');
  fs.unlinkSync(path.join(f.directory, 'index.json'));
  unavailable(await f.request());
});

test('an unconfigured knowledge store is unavailable rather than empty', async t => {
  const f = await fixture(t, { configured: false });
  unavailable(await f.request());
  assert.equal(fs.existsSync(f.directory), false);
});

test('corrupt index and altered ownership, evidence or historical authority return no counts', async t => {
  const f = await fixture(t);
  importDocument(f.directory, f.document);
  const index = path.join(f.directory, 'index.json');
  const baseline = fs.readFileSync(index, 'utf8');
  for (const bytes of ['', '{', 'null', JSON.stringify({ version: 2, records: [] })]) {
    fs.writeFileSync(index, bytes);
    unavailable(await f.request());
  }
  for (const change of [{ owner: 'another-owner' }, { historicalAuthority: true }, { text: 'tampered' }, { uncertainty: 'verified' }]) {
    const value = JSON.parse(baseline);
    Object.assign(value.records[0], change);
    fs.writeFileSync(index, JSON.stringify(value));
    unavailable(await f.request());
  }
  fs.writeFileSync(index, baseline);
  assert.equal((await f.request()).response.status, 200);
});

test('inventory checks index integrity only and never claims originals were verified', async t => {
  const f = await fixture(t);
  const imported = importDocument(f.directory, f.document);
  fs.unlinkSync(path.join(f.directory, imported.id + '.original'));
  const { response, body } = await f.request();
  assert.equal(response.status, 200);
  assert.equal(body.knowledgeState, 'index-ready');
  assert.equal(body.originalVerification, 'on-access');
  assert.throws(() => readKnowledgeOriginal(f.directory, imported.id), /does not match/);
  assert.equal(fs.existsSync(path.join(f.directory, imported.id + '.original')), false);
});

test('inventory retains owner, origin, forwarded-host and exact-route restrictions', async t => {
  const f = await fixture(t);
  importDocument(f.directory, f.document);
  for (const [headers, status] of [
    [{ Authorization: '' }, 401], [{ Authorization: `Bearer ${'7'.repeat(64)}` }, 401],
    [{ Origin: 'http://example.test' }, 403], [{ 'X-Forwarded-For': '127.0.0.1' }, 403],
  ]) {
    const result = await f.request(headers);
    assert.equal(result.response.status, status);
    assert.equal(Object.hasOwn(result.body, 'recordCount'), false);
  }
  const badHost = await new Promise((resolve, reject) => {
    const local = http.request(`http://127.0.0.1:${f.port}/knowledge/status`, {
      headers: { Host: 'example.test', Authorization: `Bearer ${'6'.repeat(64)}` },
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    local.on('error', reject); local.end();
  });
  assert.equal(badHost, 403);
  assert.equal((await f.request({}, '/knowledge/status?all=true')).response.status, 404);
  assert.equal((await f.request({}, '/knowledge/status', 'POST')).response.status, 404);
});

test('inventory rejects a linked store and a revoked synthetic owner credential', async t => {
  const f = await fixture(t, { tokenFile: true });
  const target = path.join(f.root, 'target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'index.json'), JSON.stringify({ version: 1, records: [] }));
  fs.symlinkSync(target, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  unavailable(await f.request());
  fs.writeFileSync(f.credentials, '8'.repeat(64));
  const result = await f.request();
  assert.equal(result.response.status, 401);
  assert.equal(Object.hasOwn(result.body, 'recordCount'), false);
});
