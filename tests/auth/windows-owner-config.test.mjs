import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWindowsOwnerConfig, loadWindowsOwnerConfig, validateWindowsOwnerConfig } from '../../packages/auth/windows-owner-config.mjs';

const windows = process.platform === 'win32';
const modulePath = fileURLToPath(new URL('../../packages/auth/windows-owner-config.mjs', import.meta.url));
const helper = fileURLToPath(new URL('../../packages/auth/protect-owner-config.ps1', import.meta.url));
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const code = `import {createWindowsOwnerConfig,loadWindowsOwnerConfig} from ${JSON.stringify(pathToFileURL(modulePath).href)};
try { const method = process.argv[1] === 'create' ? createWindowsOwnerConfig : loadWindowsOwnerConfig;
console.log(JSON.stringify(method({directory:process.argv[2]}))); } catch(error) { console.error(error.code); process.exitCode=1; }`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-owner-config-test-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).replace(/[\\/]$/, '').toLowerCase());
    assert.ok(path.basename(resolved).startsWith('paradize-owner-config-test-'));
    fs.rmSync(resolved, { recursive: true });
  });
  return { root, directory: path.join(root, 'identity') };
}
function child(operation, directory) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code, operation, directory], {
    encoding: 'utf8', windowsHide: true, timeout: 40000,
  });
}
function psFixture(script, directory, extra = {}) {
  // Synthetic paths/data only. Inputs travel through the environment, never interpolated as code.
  const result = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; " + script], {
    env: { ...process.env, PSModulePath: path.join(path.dirname(ps), 'Modules'), PARADIZE_TEST_DIRECTORY: directory, ...extra },
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function rejected(fn) { assert.throws(fn, { code: 'OWNER_CONFIG_UNAVAILABLE' }); }

test('strict detached frozen record accepts only distinct canonical v4 identifiers', () => {
  const valid = { version: 1, ownerId: '63eb13ac-77e8-4331-950b-ed2dde8818d7',
    installationId: '53eb13ac-77e8-4331-950b-ed2dde8818d7', nativeDeviceId: '43eb13ac-77e8-4331-950b-ed2dde8818d7' };
  const result = validateWindowsOwnerConfig(valid);
  assert.ok(Object.isFrozen(result)); assert.notEqual(result, valid);
  for (const invalid of [null, [], { ...valid, extra: true }, { ...valid, version: 2 },
    { ...valid, ownerId: valid.installationId }, { ...valid, nativeDeviceId: valid.nativeDeviceId.toUpperCase() },
    { ...valid, installationId: 'not-a-uuid' }]) assert.throws(() => validateWindowsOwnerConfig(invalid), { code: 'OWNER_CONFIG_INVALID' });
  let invoked = false;
  const accessor = { ...valid, get ownerId() { invoked = true; throw Error('must not read'); } };
  assert.throws(() => validateWindowsOwnerConfig(accessor), { code: 'OWNER_CONFIG_INVALID' });
  assert.equal(invoked, false);
});

test('actual Windows DPAPI creation, protected file and directory, and fresh-process load', { skip: !windows }, t => {
  const { directory } = fixture(t);
  const record = createWindowsOwnerConfig({ directory });
  assert.ok(Object.isFrozen(record));
  assert.deepEqual(loadWindowsOwnerConfig({ directory }), record);
  const next = child('load', directory);
  assert.equal(next.status, 0, next.stderr); assert.deepEqual(JSON.parse(next.stdout), record);
  const ciphertext = fs.readFileSync(path.join(directory, 'owner-config.dpapi'));
  assert.ok(ciphertext.length > 0 && ciphertext.length < 8192);
  for (const id of [record.ownerId, record.installationId, record.nativeDeviceId]) assert.equal(ciphertext.includes(Buffer.from(id)), false);
  const evidence = JSON.parse(psFixture(`
    Add-Type -AssemblyName System.Security
    $p=$env:PARADIZE_TEST_DIRECTORY; $f=Join-Path $p 'owner-config.dpapi'
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach($x in @($p,$f)) {
      $a=Get-Acl -LiteralPath $x
      if(-not $a.AreAccessRulesProtected -or $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) {throw 'ACL wrong'}
      $rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
      if($rules.Count -ne 2) {throw 'Unexpected ACL'}
      foreach($r in $rules) {if($r.IdentityReference.Value -notin @($sid,'S-1-5-18') -or $r.AccessControlType -ne 'Allow' -or $r.IsInherited) {throw 'Unexpected grant'}}
    }
    $bytes=[IO.File]::ReadAllBytes($f)
    $plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,[Text.Encoding]::UTF8.GetBytes('PARADIZE.owner-config.v1'),[Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Text.Encoding]::UTF8.GetString($plain)
  `, directory));
  assert.deepEqual(evidence, record);
  rejected(() => createWindowsOwnerConfig({ directory }));
  assert.deepEqual(loadWindowsOwnerConfig({ directory }), record);
});

test('missing load and interrupted empty directory never create or replace identity', { skip: !windows }, t => {
  const { directory } = fixture(t);
  rejected(() => loadWindowsOwnerConfig({ directory })); assert.equal(fs.existsSync(directory), false);
  fs.mkdirSync(directory);
  rejected(() => createWindowsOwnerConfig({ directory }));
  rejected(() => loadWindowsOwnerConfig({ directory }));
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('corrupt, oversized, foreign-entropy and malformed decrypted records fail without replacement', { skip: !windows }, t => {
  const { directory } = fixture(t);
  const valid = createWindowsOwnerConfig({ directory });
  const file = path.join(directory, 'owner-config.dpapi');
  const original = fs.readFileSync(file);
  for (const bytes of [Buffer.from('broken synthetic cipher'), Buffer.alloc(8193)]) {
    fs.writeFileSync(file, bytes);
    rejected(() => loadWindowsOwnerConfig({ directory })); rejected(() => createWindowsOwnerConfig({ directory }));
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
  for (const [entropy, payload] of [
    ['a different application entropy', JSON.stringify(valid)],
    ['PARADIZE.owner-config.v1', JSON.stringify({ ...valid, nativeDeviceId: valid.ownerId })],
    ['PARADIZE.owner-config.v1', JSON.stringify({ ...valid, extra: 'not accepted' })],
    ['PARADIZE.owner-config.v1', 'x'.repeat(1025)],
  ]) {
    psFixture(`
      Add-Type -AssemblyName System.Security
      $plain=[Text.Encoding]::UTF8.GetBytes($env:PARADIZE_TEST_PAYLOAD)
      $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,[Text.Encoding]::UTF8.GetBytes($env:PARADIZE_TEST_ENTROPY),[Security.Cryptography.DataProtectionScope]::CurrentUser)
      [IO.File]::WriteAllBytes((Join-Path $env:PARADIZE_TEST_DIRECTORY 'owner-config.dpapi'),$cipher)
    `, directory, { PARADIZE_TEST_ENTROPY: entropy, PARADIZE_TEST_PAYLOAD: payload });
    const snapshot = fs.readFileSync(file);
    rejected(() => loadWindowsOwnerConfig({ directory })); rejected(() => createWindowsOwnerConfig({ directory }));
    assert.deepEqual(fs.readFileSync(file), snapshot);
  }
  // Only this test owns its synthetic corruption; production never repairs it.
  fs.writeFileSync(file, original); assert.deepEqual(loadWindowsOwnerConfig({ directory }), valid);
});

test('pending files and unexpected siblings are ambiguous and preserved', { skip: !windows }, t => {
  const { directory } = fixture(t);
  createWindowsOwnerConfig({ directory });
  const file = path.join(directory, 'owner-config.dpapi');
  const original = fs.readFileSync(file);
  fs.renameSync(file, path.join(directory, 'owner-config.pending'));
  rejected(() => loadWindowsOwnerConfig({ directory })); rejected(() => createWindowsOwnerConfig({ directory }));
  assert.deepEqual(fs.readdirSync(directory), ['owner-config.pending']);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'owner-config.pending')), original);
  fs.renameSync(path.join(directory, 'owner-config.pending'), file);
  fs.writeFileSync(path.join(directory, 'extra'), 'interruption evidence');
  rejected(() => loadWindowsOwnerConfig({ directory })); rejected(() => createWindowsOwnerConfig({ directory }));
  assert.equal(fs.readFileSync(path.join(directory, 'extra'), 'utf8'), 'interruption evidence');
});

test('unexpected ACL grants on either directory or file cause refusal without ACL repair', { skip: !windows }, t => {
  const { root } = fixture(t);
  for (const target of ['directory', 'file']) {
    const directory = path.join(root, target);
    createWindowsOwnerConfig({ directory });
    const before = psFixture(`
      $p=$env:PARADIZE_TEST_DIRECTORY
      if($env:PARADIZE_TEST_TARGET -eq 'file') {$p=Join-Path $p 'owner-config.dpapi'}
      $section=[Security.AccessControl.AccessControlSections]::Access
      if($env:PARADIZE_TEST_TARGET -eq 'file') {$acl=[IO.File]::GetAccessControl($p,$section)}
      else {$acl=[IO.Directory]::GetAccessControl($p,$section)}
      $rule=New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]'S-1-1-0','Read','Allow')
      $acl.AddAccessRule($rule)
      if($env:PARADIZE_TEST_TARGET -eq 'file') {[IO.File]::SetAccessControl($p,$acl)}
      else {[IO.Directory]::SetAccessControl($p,$acl)}
      (Get-Acl -LiteralPath $p).Sddl
    `, directory, { PARADIZE_TEST_TARGET: target });
    rejected(() => loadWindowsOwnerConfig({ directory })); rejected(() => createWindowsOwnerConfig({ directory }));
    const after = psFixture(`
      $p=$env:PARADIZE_TEST_DIRECTORY
      if($env:PARADIZE_TEST_TARGET -eq 'file') {$p=Join-Path $p 'owner-config.dpapi'}
      (Get-Acl -LiteralPath $p).Sddl
    `, directory, { PARADIZE_TEST_TARGET: target });
    assert.equal(after, before);
  }
});

test('file hardlinks and directory junctions are refused', { skip: !windows }, t => {
  const { root, directory } = fixture(t);
  createWindowsOwnerConfig({ directory });
  fs.linkSync(path.join(directory, 'owner-config.dpapi'), path.join(root, 'second-link'));
  rejected(() => loadWindowsOwnerConfig({ directory }));
  const outside = path.join(root, 'ordinary-target'); fs.mkdirSync(outside);
  const junction = path.join(root, 'junction'); fs.symlinkSync(outside, junction, 'junction');
  rejected(() => loadWindowsOwnerConfig({ directory: junction }));
  rejected(() => createWindowsOwnerConfig({ directory: junction }));
  rejected(() => createWindowsOwnerConfig({ directory: path.join(junction, 'identity') }));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('concurrent processes create exactly one persistent owner record', { skip: !windows }, async t => {
  const { directory } = fixture(t);
  function start() {
    return new Promise((resolve, reject) => {
      const instance = spawn(process.execPath, ['--input-type=module', '-e', code, 'create', directory], { windowsHide: true });
      let stdout = '', stderr = '';
      instance.stdout.on('data', chunk => { stdout += chunk; }); instance.stderr.on('data', chunk => { stderr += chunk; });
      instance.once('error', reject); instance.once('close', status => resolve({ status, stdout, stderr }));
    });
  }
  const outcomes = await Promise.all([start(), start()]);
  assert.equal(outcomes.filter(outcome => outcome.status === 0).length, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === 1).length, 1);
  const success = outcomes.find(outcome => outcome.status === 0);
  assert.deepEqual(loadWindowsOwnerConfig({ directory }), JSON.parse(success.stdout));
  assert.equal(outcomes.find(outcome => outcome.status === 1).stderr.trim(), 'OWNER_CONFIG_UNAVAILABLE');
});

test('interrupting the actual creator after reservation cannot mint a replacement owner', { skip: !windows }, async t => {
  const { directory } = fixture(t);
  const creator = spawn(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper], {
    env: { ...process.env, PSModulePath: path.join(path.dirname(ps), 'Modules') }, windowsHide: true,
  });
  creator.stdout.resume(); creator.stderr.resume();
  const finished = new Promise((resolve, reject) => {
    creator.once('error', reject); creator.once('close', code => resolve(code));
  });
  creator.stdin.end(JSON.stringify({ operation: 'create', directory }));
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(directory) && creator.exitCode === null && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  creator.kill(); await finished;
  assert.ok(fs.existsSync(directory), 'Creator must have reserved the directory before interruption');
  const before = fs.readdirSync(directory).map(name => [name, fs.readFileSync(path.join(directory, name)).toString('hex')]);
  rejected(() => createWindowsOwnerConfig({ directory }));
  assert.deepEqual(fs.readdirSync(directory).map(name => [name, fs.readFileSync(path.join(directory, name)).toString('hex')]), before);
  // Either a complete valid record committed, or a visibly incomplete directory
  // remains. Both preserve the reservation; neither may create different IDs.
  if (before.length === 1 && before[0][0] === 'owner-config.dpapi') assert.ok(loadWindowsOwnerConfig({ directory }).ownerId);
  else rejected(() => loadWindowsOwnerConfig({ directory }));
});

test('helper bounds stdin and rejects unsafe paths before provisioning', { skip: !windows }, t => {
  const { directory } = fixture(t);
  const oversized = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper], {
    input: ' '.repeat(4097) + JSON.stringify({ operation: 'create', directory }),
    env: { ...process.env, PSModulePath: path.join(path.dirname(ps), 'Modules') },
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(oversized.status, 1); assert.equal(oversized.stdout, '');
  assert.equal(oversized.stderr.trim(), 'OWNER_CONFIG_UNAVAILABLE'); assert.equal(fs.existsSync(directory), false);
  for (const unsafe of [directory + ':alternate', directory + '\\..\\identity', directory + '.', directory + '\\NUL', '\\\\server\\share\\identity']) {
    rejected(() => createWindowsOwnerConfig({ directory: unsafe }));
  }
  assert.equal(fs.existsSync(directory), false);
});
