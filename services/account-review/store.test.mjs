import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { defaultDirectory, openStore as actualOpenStore } from './store.mjs';

const windows = process.platform === 'win32';
const fixtureStores = new Map();
function openStore(options) {
  const store = actualOpenStore(options);
  const stores = fixtureStores.get(options.directory) || [];
  stores.push(store);
  fixtureStores.set(options.directory, stores);
  return store;
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-review-store-'));
  t.after(() => {
    for (const store of fixtureStores.get(directory) || []) store.close();
    fixtureStores.delete(directory);
    const full = path.resolve(directory);
    assert.equal(path.dirname(full).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(full).startsWith('paradize-review-store-'));
    assert.equal(fs.lstatSync(full).isSymbolicLink(), false);
    fs.rmSync(full, { recursive: true, force: true });
  });
  return directory;
}

function assertOwnerAndSystemOnly(directory) {
  const powershellDirectory = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
  const script = `
    $ErrorActionPreference = 'Stop'
    $directory = [Console]::In.ReadToEnd()
    $current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $result = foreach ($item in @($directory, (Join-Path $directory 'state.sqlite'))) {
      $acl = Get-Acl -LiteralPath $item
      @{ owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;
         current = $current; protected = $acl.AreAccessRulesProtected;
         grants = @($acl.Access | Where-Object AccessControlType -eq Allow | ForEach-Object {
           $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
         }) }
    }
    $result | ConvertTo-Json -Compress
  `;
  const result = spawnSync(path.join(powershellDirectory, 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: directory, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PSModulePath: path.join(powershellDirectory, 'Modules') },
  });
  assert.equal(result.status, 0, 'Windows must report the applied ACLs');
  const entries = JSON.parse(result.stdout);
  assert.equal(entries[0].protected, true);
  for (const entry of entries) {
    assert.equal(entry.owner, entry.current);
    assert.deepEqual([...new Set(entry.grants)].sort(), ['S-1-5-18', entry.current].sort());
  }
}

test('persists owner-encrypted state across close/reopen without plaintext in SQLite', { skip: !windows }, t => {
  const directory = fixture(t);
  let store = openStore({ directory });
  assertOwnerAndSystemOnly(directory);
  assert.deepEqual(store.read(), { revision: 0, data: {
    version: 1, sources: {}, cases: {}, notifications: {},
    policy: { mode: 'prepare', paused: false, standingPermissions: [] },
  } });
  const marker = 'PRIVATE-REVIEW-TEST-UNIQUE-9793-Hi-\u2600';
  const written = store.update(0, data => { data.cases.refund = { response: marker }; return data; });
  assert.equal(written.revision, 1);
  store.close();
  store.close();
  for (const filename of fs.readdirSync(directory)) {
    const bytes = fs.readFileSync(path.join(directory, filename));
    assert.equal(bytes.includes(Buffer.from(marker)), false);
    assert.equal(bytes.includes(Buffer.from(marker, 'utf16le')), false);
  }
  store = openStore({ directory });
  t.after(() => store.close());
  assert.deepEqual(store.read(), written);
  const detached = store.read();
  detached.data.cases.refund.response = 'not persisted';
  assert.equal(store.read().data.cases.refund.response, marker);
});

test('existingOnly never creates a missing store and reads an initialized store', { skip: !windows }, t => {
  assert.equal(defaultDirectory(), path.join(process.env.LOCALAPPDATA, 'PARADIZE', 'account-review'));
  const root = fixture(t);
  const directory = path.join(root, 'absent');
  assert.throws(() => openStore({ directory, existingOnly: true }), error => error.code === 'REVIEW_STORE_MISSING');
  assert.equal(fs.existsSync(directory), false);
  const store = openStore({ directory: root });
  store.close();
  const reopened = openStore({ directory: root, existingOnly: true });
  assert.equal(reopened.read().revision, 0);
});

test('rejects stale revisions and rolls back throwing or invalid transforms', { skip: !windows }, t => {
  const store = openStore({ directory: fixture(t) });
  t.after(() => store.close());
  store.update(0, data => { data.notifications.one = true; return data; });
  assert.throws(() => store.update(0, () => assert.fail('stale transform must not run')),
    error => error.code === 'REVIEW_STORE_CONFLICT');
  assert.throws(() => store.update(1, data => { data.cases.partial = 'discard'; throw new Error('transform aborted'); }), /transform aborted/);
  assert.throws(() => store.update(1, data => { data.sources.invalid = undefined; return data; }), /JSON values/);
  assert.throws(() => store.update(1, async data => data), /synchronous/);
  assert.throws(() => store.update(1, data => { data.cases.tooLarge = 'x'.repeat(2 * 1024 * 1024); return data; }), /2 MiB/);
  assert.equal(store.read().revision, 1);
  assert.deepEqual(store.read().data.cases, {});
  assert.deepEqual(store.read().data.sources, {});
  assert.equal(store.update(1, data => { data.sources.works = true; return data; }).revision, 2);
});

test('fails closed on a corrupt encrypted record without resetting it', { skip: !windows }, t => {
  const directory = fixture(t);
  openStore({ directory }).close();
  const filename = path.join(directory, 'state.sqlite');
  const db = new DatabaseSync(filename);
  const corrupt = Buffer.from('intentionally-invalid-DPAPI-blob');
  db.prepare('UPDATE review_state SET payload = ? WHERE id = 1').run(corrupt);
  db.close();
  assert.throws(() => openStore({ directory }), /protection failed/);
  const reopened = new DatabaseSync(filename);
  assert.deepEqual(Buffer.from(reopened.prepare('SELECT payload FROM review_state').get().payload), corrupt);
  reopened.close();
});

test('fails closed for an existing database with missing state', { skip: !windows }, t => {
  const directory = fixture(t);
  openStore({ directory }).close();
  const db = new DatabaseSync(path.join(directory, 'state.sqlite'));
  db.exec('DELETE FROM review_state');
  db.close();
  assert.throws(() => openStore({ directory }), /Invalid account review database/);
});

test('rejects nonlocal, traversal, and linked storage paths', { skip: !windows }, t => {
  for (const directory of ['relative-path', '\\\\server\\share\\review', 'C:\\', 'C:\\test\\..\\review', 'C:\\test\\review.']) {
    assert.throws(() => openStore({ directory }), /storage (path|directory)/);
  }
  const base = fixture(t);
  const target = path.join(base, 'target');
  fs.mkdirSync(target);
  const link = path.join(base, 'junction');
  fs.symlinkSync(target, link, 'junction');
  try { assert.throws(() => openStore({ directory: link }), /protection failed/); }
  finally { fs.unlinkSync(link); }
});

test('rejects a linked database entry', { skip: !windows }, t => {
  const directory = fixture(t);
  openStore({ directory }).close();
  const original = path.join(directory, 'state.sqlite');
  const moved = path.join(directory, 'preserved.sqlite');
  fs.renameSync(original, moved);
  // A directory junction at the expected database filename is forbidden even without symlink privilege.
  const target = path.join(directory, 'target');
  fs.mkdirSync(target);
  fs.symlinkSync(target, original, 'junction');
  try { assert.throws(() => openStore({ directory }), /protection failed/); }
  finally { fs.unlinkSync(original); }
});

function writer(directory, identity) {
  const code = `
    const {openStore} = await import(process.argv[2]);
    const store = openStore({directory:process.argv[1]});
    try {
      const result = store.update(0, data => {data.cases.winner = process.argv[3]; return data;});
      console.log(JSON.stringify({revision:result.revision,winner:result.data.cases.winner}));
    } catch (error) {
      if (error.code !== 'REVIEW_STORE_CONFLICT') throw error;
      console.log(JSON.stringify({conflict:true}));
    } finally {store.close();}
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, directory, new URL('./store.mjs', import.meta.url).href, identity], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', exitCode => {
      if (exitCode !== 0) return reject(new Error(`Writer failed (${exitCode}): ${stderr}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
}

test('separate processes serialize writes and exactly one wins the same revision', { skip: !windows, timeout: 60_000 }, async t => {
  const directory = fixture(t);
  openStore({ directory }).close();
  const results = await Promise.all([writer(directory, 'first'), writer(directory, 'second')]);
  assert.equal(results.filter(result => result.conflict).length, 1);
  const winner = results.find(result => result.revision === 1);
  assert.ok(winner);
  const store = openStore({ directory });
  t.after(() => store.close());
  assert.equal(store.read().revision, 1);
  assert.equal(store.read().data.cases.winner, winner.winner);
});
