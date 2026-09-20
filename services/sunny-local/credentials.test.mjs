import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { credentialGuard } from './credentials.mjs';
import { createSunnyServer } from './server.mjs';

const first = 'a'.repeat(64), second = 'b'.repeat(64);
const headers = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const models = () => Response.json({ models: [{ name: 'qwen2.5:3b', size: 1024 }] });
function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pz-credentials-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'token'); fs.writeFileSync(file, first);
  return { root, file };
}
async function fixture(t, file, fetcher = async () => models()) {
  const server = createSunnyServer({ tokenFile: file, fetcher });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function within(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cancellation deadline missed')), 2500); })]); }
  finally { clearTimeout(timer); }
}

test('file guard rejects replacement and cannot resurrect after observed rotation or deletion', t => {
  for (const remove of [false, true]) {
    const { file } = directory(t), guard = credentialGuard({ tokenFile: file });
    assert.equal(guard.accepts(first), true);
    assert.equal(guard.accepts(second), false);
    if (remove) fs.unlinkSync(file); else fs.writeFileSync(file, second);
    assert.equal(guard.current(), false);
    fs.writeFileSync(file, first);
    assert.equal(guard.accepts(first), false);
    assert.equal(guard.accepts(second), false);
  }
});

test('startup rejects missing, invalid, oversized, mismatched and linked credentials', t => {
  const { root, file } = directory(t);
  assert.throws(() => credentialGuard({ token: second, tokenFile: file }));
  fs.linkSync(file, path.join(root, 'alias'));
  assert.throws(() => credentialGuard({ tokenFile: file }));
  fs.unlinkSync(path.join(root, 'alias'));
  for (const value of ['', 'x'.repeat(64), first + ' '.repeat(129)]) {
    fs.writeFileSync(file, value); assert.throws(() => credentialGuard({ tokenFile: file }));
  }
  fs.unlinkSync(file); assert.throws(() => credentialGuard({ tokenFile: file }));
  assert.equal(fs.existsSync(file), false, 'No new credential may be invented');
});

test('linked parent directories cannot become a credential authority', t => {
  const { root, file } = directory(t);
  const linked = path.join(root, 'linked');
  fs.symlinkSync(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => credentialGuard({ tokenFile: path.join(linked, path.basename(file)) }));
});

test('running service rejects both old and replacement tokens; fresh service accepts only replacement', async t => {
  const { file } = directory(t);
  let calls = 0;
  const { url } = await fixture(t, file, async () => { calls++; return models(); });
  assert.equal((await fetch(url + '/health', { headers: headers(first) })).status, 200);
  fs.writeFileSync(file, second);
  for (const value of [first, second]) assert.equal((await fetch(url + '/health', { headers: headers(value) })).status, 401);
  assert.equal(calls, 1);
  const fresh = await fixture(t, file);
  assert.equal((await fetch(fresh.url + '/health', { headers: headers(first) })).status, 401);
  assert.equal((await fetch(fresh.url + '/health', { headers: headers(second) })).status, 200);
});

test('revocation aborts ongoing inference without another request or a provider retry', async t => {
  const { file } = directory(t);
  let entered, aborted, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const stopped = new Promise(resolve => { aborted = resolve; });
  const { url } = await fixture(t, file, async (target, options) => {
    calls++;
    if (target.endsWith('/api/tags')) return models();
    entered();
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => { aborted(); reject(options.signal.reason); }, { once: true }));
  });
  const pending = fetch(url + '/chat', { method: 'POST', headers: headers(first), body: JSON.stringify({ message: 'Synthetic request' }) });
  await within(started); fs.writeFileSync(file, second);
  await within(stopped);
  const response = await within(pending);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'credential-revoked');
  assert.equal(calls, 2);
});

test('revocation terminates a partial upload before inference', async t => {
  const { file } = directory(t);
  const { url } = await fixture(t, file, async () => assert.fail('Partial upload must not reach provider'));
  const request = http.request(url + '/chat', { method: 'POST', headers: { ...headers(first), 'Content-Length': 500 } });
  const closed = new Promise(resolve => { request.on('error', resolve); request.on('close', resolve); });
  request.write('{"message":"');
  await new Promise(resolve => setTimeout(resolve, 50));
  fs.unlinkSync(file);
  await within(closed);
  assert.equal((await fetch(url + '/health', { headers: headers(first) })).status, 401);
});

test('a delayed health response cannot succeed after credential removal', async t => {
  const { file } = directory(t);
  const { url } = await fixture(t, file, async () => { fs.unlinkSync(file); return models(); });
  const response = await fetch(url + '/health', { headers: headers(first) });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'credential-revoked');
});

test('standalone service exits on revocation so trusted relaunch can bind its port', async t => {
  const { file } = directory(t);
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    windowsHide: true, env: { ...process.env, PARADIZE_SUNNY_TOKEN_FILE: file, PARADIZE_SUNNY_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  await within(once(child.stdout, 'data'));
  assert.match(output, /Sunny local bridge ready/);
  fs.writeFileSync(file, second);
  const [exitCode] = await within(exited);
  assert.equal(exitCode, 0);
  assert.equal(output.includes(first) || output.includes(second), false);
  assert.equal(fs.readFileSync(file, 'utf8'), second, 'Service must not overwrite replacement credential');
  const reopened = http.createServer(); reopened.listen(port, '127.0.0.1'); await once(reopened, 'listening');
  await new Promise(resolve => reopened.close(resolve));
});
