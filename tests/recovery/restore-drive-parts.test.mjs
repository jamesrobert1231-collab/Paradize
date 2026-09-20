import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { restoreDriveParts } from '../../scripts/recovery/restore-drive-parts.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paradize-drive-restore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const partsDir = path.join(root, 'parts'), outputDir = path.join(root, 'output');
  await mkdir(partsDir); await mkdir(outputDir);
  const content = Buffer.from('Synthetic installer bytes. This fixture is never executed.');
  const pieces = [content.subarray(0, 17), content.subarray(17, 33), content.subarray(33)];
  const manifest = {
    version: 1, backupId: 'synthetic-restore-1', sourceName: 'synthetic-installer.bin',
    sourceBytes: content.length, sourceSha256: sha256(content),
    parts: pieces.map((bytes, index) => ({
      index: index + 1, filename: `installer.part${index + 1}`, bytes: bytes.length,
      sha256: sha256(bytes), driveFileId: `synthetic-drive-${index + 1}`,
    })),
  };
  for (const [index, bytes] of pieces.entries()) await writeFile(path.join(partsDir, manifest.parts[index].filename), bytes);
  const manifestPath = path.join(root, 'manifest.json'), destination = path.join(outputDir, manifest.sourceName);
  const save = () => writeFile(manifestPath, JSON.stringify(manifest));
  await save();
  return { root, partsDir, outputDir, manifestPath, destination, manifest, content, save };
}

test('restores exact bytes and preserves all source parts', async t => {
  const f = await fixture(t);
  const before = await Promise.all(f.manifest.parts.map(p => readFile(path.join(f.partsDir, p.filename))));
  const result = await restoreDriveParts(f);
  assert.deepEqual(await readFile(f.destination), f.content);
  assert.equal(result.verified, true); assert.equal(result.restored, true);
  assert.equal(result.sourceSha256, sha256(f.content)); assert.equal(result.partCount, 3);
  assert.deepEqual(await readdir(f.outputDir), [f.manifest.sourceName]);
  const after = await Promise.all(f.manifest.parts.map(p => readFile(path.join(f.partsDir, p.filename))));
  assert.deepEqual(after, before);
});

test('verify-only validates full concatenation and creates no output', async t => {
  const f = await fixture(t);
  const result = await restoreDriveParts({ manifestPath: f.manifestPath, partsDir: f.partsDir, verifyOnly: true });
  assert.equal(result.verified, true); assert.equal(result.restored, false);
  assert.equal(result.sourceSha256, sha256(f.content));
  assert.deepEqual(await readdir(f.outputDir), []);
});

test('rejects missing, partial and corrupt parts without retaining output', async t => {
  for (const failure of ['missing', 'partial', 'corrupt']) await t.test(failure, async t => {
    const f = await fixture(t), part = path.join(f.partsDir, f.manifest.parts[1].filename);
    if (failure === 'missing') await rm(part);
    if (failure === 'partial') await writeFile(part, Buffer.from('short'));
    if (failure === 'corrupt') await writeFile(part, Buffer.alloc(f.manifest.parts[1].bytes, 120));
    await assert.rejects(restoreDriveParts(f));
    assert.deepEqual(await readdir(f.outputDir), []);
  });
});

test('rejects traversal, absolute paths, Windows streams and reserved names', async t => {
  for (const filename of ['../escape', '..\\escape', '/absolute', 'C:\\escape', 'part:stream', 'CON', 'CON .txt', 'COM¹.bin', 'LPT1.bin', 'part.', 'part ']) {
    const f = await fixture(t); f.manifest.parts[0].filename = filename; await f.save();
    await assert.rejects(restoreDriveParts(f), /basename/i);
    assert.deepEqual(await readdir(f.outputDir), []);
  }
});

test('rejects duplicate names, indices, incorrect order and byte totals', async t => {
  for (const failure of ['duplicate-name', 'duplicate-index', 'order', 'total']) {
    const f = await fixture(t);
    if (failure === 'duplicate-name') f.manifest.parts[1].filename = f.manifest.parts[0].filename.toUpperCase();
    if (failure === 'duplicate-index') f.manifest.parts[1].index = 1;
    if (failure === 'order') [f.manifest.parts[0], f.manifest.parts[1]] = [f.manifest.parts[1], f.manifest.parts[0]];
    if (failure === 'total') f.manifest.sourceBytes += 1;
    await f.save(); await assert.rejects(restoreDriveParts(f));
    assert.deepEqual(await readdir(f.outputDir), []);
  }
});

test('rejects a wrong complete-file hash even when individual parts pass', async t => {
  const f = await fixture(t); f.manifest.sourceSha256 = '0'.repeat(64); await f.save();
  await assert.rejects(restoreDriveParts(f), /complete.*hash/i);
  assert.deepEqual(await readdir(f.outputDir), []);
  await assert.rejects(restoreDriveParts({ ...f, verifyOnly: true }), /complete.*hash/i);
});

test('never overwrites an existing destination', async t => {
  const f = await fixture(t); await writeFile(f.destination, 'Keep this existing file.');
  await assert.rejects(restoreDriveParts(f), /already exists/i);
  assert.equal(await readFile(f.destination, 'utf8'), 'Keep this existing file.');
  assert.deepEqual(await readdir(f.outputDir), [f.manifest.sourceName]);
});

test('rejects linked parent directories', async t => {
  const f = await fixture(t), linkedDir = path.join(f.root, 'linked-parts');
  await symlink(f.partsDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(restoreDriveParts({ ...f, partsDir: linkedDir }), /symlink|junction/i);
  const linkedOutput = path.join(f.root, 'linked-output');
  await symlink(f.outputDir, linkedOutput, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(restoreDriveParts({ ...f, destination: path.join(linkedOutput, 'result.bin') }), /symlink|junction/i);
});

test('bounds manifest size and source totals before restoration', async t => {
  const f = await fixture(t);
  await writeFile(f.manifestPath, ' '.repeat(4 * 1024 * 1024 + 1));
  await assert.rejects(restoreDriveParts(f), /manifest.*limit/i);
  f.manifest.sourceBytes = Number.MAX_SAFE_INTEGER; await f.save();
  await assert.rejects(restoreDriveParts(f), /source.*bytes/i);
  assert.deepEqual(await readdir(f.outputDir), []);
});

test('rejects a symlink part or manifest rather than following it', async t => {
  const f = await fixture(t), original = path.join(f.partsDir, f.manifest.parts[0].filename);
  const linkedPart = path.join(f.partsDir, 'linked.part');
  try { await symlink(original, linkedPart, 'file'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Windows file symlink permission unavailable'); return; } throw error; }
  f.manifest.parts[0].filename = 'linked.part'; await f.save();
  await assert.rejects(restoreDriveParts(f), /symlink|junction/i);
  const linkedManifest = path.join(f.root, 'linked-manifest.json');
  await symlink(f.manifestPath, linkedManifest, 'file');
  await assert.rejects(restoreDriveParts({ ...f, manifestPath: linkedManifest }), /symlink|junction/i);
  assert.deepEqual(await readdir(f.outputDir), []);
});

test('CLI verify-only reports verified bytes without creating a restore output', async t => {
  const f = await fixture(t);
  const script = fileURLToPath(new URL('../../scripts/recovery/restore-drive-parts.mjs', import.meta.url));
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [script, '--verify-only', f.manifestPath, f.partsDir]);
  const result = JSON.parse(stdout);
  assert.equal(stderr, ''); assert.equal(result.verified, true); assert.equal(result.restored, false);
  assert.equal(result.sourceBytes, f.content.length);
  assert.deepEqual(await readdir(f.outputDir), []);
});
