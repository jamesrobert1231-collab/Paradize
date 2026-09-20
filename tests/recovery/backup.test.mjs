import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createEncryptedBackup, restoreEncryptedBackup } from '../../scripts/recovery/backup.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'paradize-recovery-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'source');
  await mkdir(sourceDir); await mkdir(path.join(sourceDir, 'empty'));
  await mkdir(path.join(root, 'archives')); await mkdir(path.join(root, 'keys'));
  await writeFile(path.join(sourceDir, 'evidence.txt'), 'synthetic evidence\n');
  return { sourceDir, archivePath: path.join(root, 'archives', 'backup.pzb'), keyPath: path.join(root, 'keys', 'recovery.key'), destinationDir: path.join(root, 'restored'), root };
}

test('encrypted round trip preserves files, empty directories and source', async t => {
  const f = await fixture(t); await createEncryptedBackup(f); await restoreEncryptedBackup(f);
  assert.equal(await readFile(path.join(f.destinationDir, 'evidence.txt'), 'utf8'), 'synthetic evidence\n');
  assert.equal(await readFile(path.join(f.sourceDir, 'evidence.txt'), 'utf8'), 'synthetic evidence\n');
  await access(path.join(f.destinationDir, 'empty'));
  assert.equal((await readFile(f.archivePath)).includes(Buffer.from('synthetic evidence')), false);
});

test('refuses overwrite, existing destination, collocated key and input overflow', async t => {
  const f = await fixture(t);
  await assert.rejects(createEncryptedBackup({ ...f, maxInputBytes: 1 }), /limit/);
  await assert.rejects(createEncryptedBackup({ ...f, keyPath: path.join(f.root, 'archives', 'key') }), /separate/);
  await createEncryptedBackup(f);
  await assert.rejects(createEncryptedBackup(f));
  await mkdir(f.destinationDir);
  await assert.rejects(restoreEncryptedBackup(f), /exist/i);
});

test('rejects source junctions and output inside source', async t => {
  const f = await fixture(t);
  await assert.rejects(createEncryptedBackup({ ...f, archivePath: path.join(f.sourceDir, 'archive') }), /inside source/);
  await symlink(path.join(f.sourceDir, 'empty'), path.join(f.sourceDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createEncryptedBackup(f), /junction/);
  await assert.rejects(access(f.archivePath));
});

for (const mutation of ['wrong-key', 'truncated', 'tamper', 'traversal', 'hash', 'duplicate', 'absolute', 'reserved', 'parent-file']) {
  test(`rejects ${mutation} before creating output`, async t => {
    const f = await fixture(t); await createEncryptedBackup(f);
    let bytes = await readFile(f.archivePath);
    if (mutation === 'wrong-key') await writeFile(f.keyPath, randomBytes(32));
    else if (mutation === 'truncated') await writeFile(f.archivePath, bytes.subarray(0, 20));
    else if (mutation === 'tamper') { bytes[bytes.length - 1] ^= 1; await writeFile(f.archivePath, bytes); }
    else {
      const key = await readFile(f.keyPath);
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
      decipher.setAAD(bytes.subarray(0, 8)); decipher.setAuthTag(bytes.subarray(20, 36));
      const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]));
      const file = payload.entries.find(e => e.type === 'file');
      if (mutation === 'traversal') file.path = '../escaped.txt';
      else if (mutation === 'duplicate') payload.entries.push({ ...file, path: file.path.toUpperCase() });
      else if (mutation === 'absolute') file.path = 'C:/escaped.txt';
      else if (mutation === 'reserved') file.path = 'CON.txt';
      else if (mutation === 'parent-file') payload.entries.push({ ...file, path: file.path + '/nested.txt' });
      else file.sha256 = '0'.repeat(64);
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(bytes.subarray(0, 8));
      const data = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
      await writeFile(f.archivePath, Buffer.concat([bytes.subarray(0, 8), iv, cipher.getAuthTag(), data]));
    }
    await assert.rejects(restoreEncryptedBackup(f));
    await assert.rejects(access(f.destinationDir));
    await assert.rejects(access(path.join(f.root, 'escaped.txt')));
  });
}
