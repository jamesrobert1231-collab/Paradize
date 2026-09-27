import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { initializeWindowsOwner } from '../../services/identity/windows-bootstrap.mjs';
import { createWindowsOwnerConfig } from '../../packages/auth/windows-owner-config.mjs';
import { createBootstrapProtocolFixture } from './bootstrap-protocol-fixture.mjs';

const windows = process.platform === 'win32';
const childScript = fileURLToPath(new URL('./bootstrap-child-fixture.mjs', import.meta.url));
const request = JSON.stringify({ version: 1, operation: 'initialize-owner' });

function fixture(t, create = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-bootstrap-test-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(resolved), /^paradize-bootstrap-test-/);
    assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const directory = path.join(root, 'identity');
  return { directory, config: create ? createWindowsOwnerConfig({ directory }) : null };
}

function child(directory, { mode = 'ready', timeout = 5000, input = request, hold = false, fileOutput } = {}) {
  const processChild = spawn(process.execPath, [childScript, directory, mode, String(timeout)], {
    windowsHide: true, shell: false, env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['pipe', fileOutput ?? 'pipe', 'pipe', 'ipc'],
  });
  const output = [], errors = [];
  let outputBytes = 0, stderrBytes = 0;
  processChild.stdout?.on('data', data => { outputBytes += data.length; if (outputBytes > 2048) processChild.kill(); else output.push(data); });
  processChild.stderr.on('data', data => { stderrBytes += data.length; if (stderrBytes > 2048) processChild.kill(); else errors.push(data); });
  processChild.stdin.on('error', () => {});
  const ready = new Promise(resolve => processChild.once('message', resolve));
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { processChild.kill(); reject(new Error('Synthetic bootstrap child timed out')); }, 15000);
    processChild.once('error', error => { clearTimeout(timer); reject(error); });
    processChild.once('close', code => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(output).toString('utf8'), stderr: Buffer.concat(errors).toString('utf8') }); });
  });
  if (hold) processChild.stdin.write(input);
  else processChild.stdin.end(input);
  return { done, ready, processChild, output };
}

test('protected IDs survive bootstrap restart; no sessions or pairing grants are created (scripted PostgreSQL protocol)', { skip: !windows }, async t => {
  const { directory, config } = fixture(t);
  const db = createBootstrapProtocolFixture();
  const first = await initializeWindowsOwner({ pool: db.pool, directory });
  const restarted = createBootstrapProtocolFixture({ state: db.state });
  const second = await initializeWindowsOwner({ pool: restarted.pool, directory });
  assert.deepEqual(second, first);
  assert.equal(first.ownerId, config.ownerId);
  assert.equal(first.installationId, config.installationId);
  assert.deepEqual(db.state.devices, []);
  assert.deepEqual(db.state.sessions, []);
  assert.deepEqual(db.state.pairings, []);
  assert.equal(restarted.calls.filter(sql => sql.startsWith('UPDATE paradize_identity.owner_state SET state')).length, 0);
});

test('missing protected configuration cannot contact the database or mint a replacement owner', { skip: !windows }, async t => {
  const { directory } = fixture(t, false);
  const db = createBootstrapProtocolFixture();
  await assert.rejects(initializeWindowsOwner({ pool: db.pool, directory }), { code: 'BOOTSTRAP_OWNER_CONFIG_UNAVAILABLE' });
  assert.equal(db.connections, 0);
  assert.equal(fs.existsSync(directory), false);
});

test('a different protected owner cannot replace an established database owner', { skip: !windows }, async t => {
  const { directory } = fixture(t);
  const db = createBootstrapProtocolFixture();
  await initializeWindowsOwner({ pool: db.pool, directory });
  const original = db.state;
  const changed = { ...original, owner: { ...original.owner, id: randomUUID() } };
  const other = createBootstrapProtocolFixture({ state: changed });
  await assert.rejects(initializeWindowsOwner({ pool: other.pool, directory }), { code: 'BOOTSTRAP_OWNER_CONFLICT' });
  assert.deepEqual(other.state, changed);
  const differentInstallation = { ...original, owner: { ...original.owner, installationId: randomUUID() } };
  const installation = createBootstrapProtocolFixture({ state: differentInstallation });
  await assert.rejects(initializeWindowsOwner({ pool: installation.pool, directory }), { code: 'BOOTSTRAP_OWNER_CONFLICT' });
  assert.deepEqual(installation.state, differentInstallation);
});

test('commit uncertainty is returned once without replay or exposed driver details', { skip: !windows }, async t => {
  const { directory } = fixture(t);
  const db = createBootstrapProtocolFixture({ mode: 'commit-uncertain' });
  await assert.rejects(initializeWindowsOwner({ pool: db.pool, directory }), error => {
    assert.equal(error.code, 'BOOTSTRAP_COMMIT_UNCERTAIN');
    assert.doesNotMatch(String(error), /synthetic-commit-secret/);
    return true;
  });
  assert.equal(db.connections, 1);
  assert.equal(db.calls.filter(sql => sql === 'COMMIT').length, 1);
});

test('actual inherited child pipes return only bounded owner metadata after EOF', { skip: !windows }, async t => {
  const { directory, config } = fixture(t);
  const running = child(directory, { hold: true });
  assert.deepEqual(await Promise.race([running.ready, running.done]), { ready: true });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(running.output.length, 0);
  running.processChild.stdin.end();
  const result = await running.done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, ok: true, result: { ownerId: config.ownerId, installationId: config.installationId, createdAt: 1800000000123 } });
  assert.doesNotMatch(result.stdout, /token|password|pairing|nativeDeviceId/);
});

test('child protocol rejects malformed, extra, grant, trailing, oversized and invalid-UTF8 requests before config access', { skip: !windows }, async t => {
  const { directory } = fixture(t, false);
  const invalid = [
    ['', 'BOOTSTRAP_REQUEST_INVALID'],
    ['[]', 'BOOTSTRAP_REQUEST_INVALID'],
    [JSON.stringify({ version: 1, operation: 'create-native-session' }), 'BOOTSTRAP_REQUEST_INVALID'],
    [JSON.stringify({ version: 1, operation: 'initialize-owner', directory: 'synthetic-path-must-not-leak' }), 'BOOTSTRAP_REQUEST_INVALID'],
    [request + request, 'BOOTSTRAP_REQUEST_INVALID'],
    [Buffer.from([0xff, 0xff]), 'BOOTSTRAP_REQUEST_INVALID'],
    [' '.repeat(257), 'BOOTSTRAP_REQUEST_TOO_LARGE'],
  ];
  for (const [input, code] of invalid) {
    const result = await child(directory, { input }).done;
    assert.equal(result.code, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { version: 1, ok: false, code });
  }
  assert.equal(fs.existsSync(directory), false);
});

test('child request deadline stops an unfinished input without creating configuration', { skip: !windows }, async t => {
  const { directory } = fixture(t, false);
  const result = await child(directory, { hold: true, timeout: 100 }).done;
  assert.equal(result.code, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, ok: false, code: 'BOOTSTRAP_INPUT_TIMEOUT' });
  assert.equal(fs.existsSync(directory), false);
});

test('database errors and absent pools fail closed; the child publishes no driver details', { skip: !windows }, async t => {
  const { directory } = fixture(t);
  await assert.rejects(initializeWindowsOwner({ directory }), { code: 'BOOTSTRAP_DATABASE_UNAVAILABLE' });
  const result = await child(directory, { mode: 'connection-error' }).done;
  assert.equal(result.code, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, ok: false, code: 'BOOTSTRAP_DATABASE_UNAVAILABLE' });
});

test('stdout redirected to a file is refused without a response or owner creation', { skip: !windows }, async t => {
  const { directory } = fixture(t, false);
  const filename = path.join(path.dirname(directory), 'output.txt');
  const fd = fs.openSync(filename, 'wx');
  try {
    const result = await child(directory, { fileOutput: fd }).done;
    assert.equal(result.code, 2);
    assert.equal(result.stderr, '');
    assert.equal(fs.statSync(filename).size, 0);
    assert.equal(fs.existsSync(directory), false);
  } finally { fs.closeSync(fd); }
});

test('a parent closing its output pipe receives a bounded failure without an unhandled EPIPE stack', { skip: !windows }, async t => {
  const { directory } = fixture(t, false);
  const running = child(directory, { input: '', hold: true });
  running.processChild.stdout.destroy();
  running.processChild.stdin.end('[]');
  const result = await running.done;
  assert.equal(result.code, 2);
  assert.equal(result.stderr, '');
  assert.equal(fs.existsSync(directory), false);
});
