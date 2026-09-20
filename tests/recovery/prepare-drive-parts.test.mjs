import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { restoreDriveParts } from '../../scripts/recovery/restore-drive-parts.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const script = fileURLToPath(new URL('../../scripts/recovery/prepare-drive-parts.ps1', import.meta.url));
const shell = process.env.PARADIZE_TEST_POWERSHELL ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const execute = promisify(execFile);
const run = args => execute(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { timeout: 30000 });
const windows = { skip: process.platform !== 'win32' };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'paradize-prepare-parts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'synthetic-installer.bin'), manifestPath = path.join(root, 'manifest.json');
  const partsDir = path.join(root, 'parts'); await mkdir(partsDir);
  const content = Buffer.alloc(2 * 1024 * 1024 + 173);
  for (let index = 0; index < content.length; index++) content[index] = index % 251;
  await writeFile(source, content);
  const common = ['-Source', source, '-ManifestPath', manifestPath];
  const prepare = (extra = []) => run([...common, '-Prepare', '-PartMiB', '1', '-BackupId', 'synthetic-prepare-1', ...extra]);
  const stage = index => run([...common, '-Stage', '-Index', String(index), '-DestinationDirectory', partsDir]);
  return { root, source, manifestPath, partsDir, content, common, prepare, stage };
}

test('prepares ordered hashes without creating parts, then stages and restores exact original', windows, async t => {
  const f = await fixture(t);
  const result = JSON.parse((await f.prepare(['-ExpectedSourceSha256', sha256(f.content)])).stdout);
  const manifest = JSON.parse(await readFile(f.manifestPath, 'utf8'));
  assert.equal(result.partCount, 3); assert.equal(manifest.sourceSha256, sha256(f.content));
  assert.deepEqual(await readdir(f.partsDir), []);
  for (const part of manifest.parts) {
    assert.equal(part.index, manifest.parts.indexOf(part) + 1);
    assert.equal(part.offset, (part.index - 1) * 1024 * 1024);
    const expected = f.content.subarray(part.offset, part.offset + part.bytes);
    assert.equal(part.sha256, sha256(expected));
    const receipt = JSON.parse((await f.stage(part.index)).stdout);
    assert.equal(receipt.sha256, part.sha256);
    assert.deepEqual(await readFile(receipt.path), expected);
    part.driveFileId = `synthetic-verified-drive-${part.index}`;
  }
  await writeFile(f.manifestPath, JSON.stringify(manifest));
  const destination = path.join(f.root, 'restored.bin');
  await restoreDriveParts({ manifestPath: f.manifestPath, partsDir: f.partsDir, destination });
  assert.deepEqual(await readFile(destination), f.content);
  assert.deepEqual(await readFile(f.source), f.content);
});

test('wrong expected whole-source hash publishes no manifest or part', windows, async t => {
  const f = await fixture(t);
  await assert.rejects(f.prepare(['-ExpectedSourceSha256', '0'.repeat(64)]), /expected hash/);
  assert.deepEqual((await readdir(f.root)).sort(), ['parts', 'synthetic-installer.bin']);
});

test('changed source size or content is refused and temporary output is removed', windows, async t => {
  for (const change of ['size', 'content']) await t.test(change, async t => {
    const f = await fixture(t); await f.prepare();
    const original = JSON.parse(await readFile(f.manifestPath, 'utf8'));
    const changed = change === 'size' ? Buffer.from('different') : Buffer.alloc(f.content.length, 7);
    await writeFile(f.source, changed);
    if (change === 'content') {
      // Restore the exact original timestamp; the selected part hash must still detect changed bytes.
      const quote = value => "'" + value.replaceAll("'", "''") + "'";
      const command = `[IO.File]::SetLastWriteTimeUtc(${quote(f.source)},[DateTime]::Parse(${quote(original.sourceModifiedUtc)},[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind))`;
      await execute(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')]);
    }
    await assert.rejects(f.stage(1), /snapshot/);
    assert.deepEqual(await readdir(f.partsDir), []);
    assert.deepEqual(await readFile(f.source), changed);
  });
});

test('existing manifests and staged parts cannot be overwritten', windows, async t => {
  const f = await fixture(t); await f.prepare();
  const before = await readFile(f.manifestPath);
  await assert.rejects(f.prepare(), /already exists/);
  assert.deepEqual(await readFile(f.manifestPath), before);
  const receipt = JSON.parse((await f.stage(1)).stdout);
  await assert.rejects(f.stage(1), /already exists/);
  assert.equal(sha256(await readFile(receipt.path)), receipt.sha256);
});

test('rejects traversal, gaps and noninteger offsets in staged manifests', windows, async t => {
  const f = await fixture(t); await f.prepare();
  const original = JSON.parse(await readFile(f.manifestPath, 'utf8'));
  for (const mutation of [m => m.parts[0].filename = '../outside', m => m.parts[1].offset++, m => m.parts[0].offset = 0.5]) {
    const manifest = structuredClone(original); mutation(manifest);
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    await assert.rejects(f.stage(1));
    assert.deepEqual(await readdir(f.partsDir), []);
  }
});

test('rejects source and destination junction parents', windows, async t => {
  const f = await fixture(t); await f.prepare();
  const linked = path.join(f.root, 'linked-parts'); await symlink(f.partsDir, linked, 'junction');
  await assert.rejects(run([...f.common, '-Stage', '-Index', '1', '-DestinationDirectory', linked]), /junction/);
  const linkedSource = path.join(f.root, 'linked-root'); await symlink(f.root, linkedSource, 'junction');
  await assert.rejects(run(['-Source', path.join(linkedSource, 'synthetic-installer.bin'), '-ManifestPath', path.join(f.root, 'second.json'), '-Prepare']), /junction/);
});

test('refuses to prepare while another process holds the source open for writing', windows, async t => {
  const f = await fixture(t), writer = await open(f.source, 'r+');
  try { await assert.rejects(f.prepare(), /being used by\s+another process|sharing/i); }
  finally { await writer.close(); }
  assert.deepEqual((await readdir(f.root)).sort(), ['parts', 'synthetic-installer.bin']);
  assert.deepEqual(await readFile(f.source), f.content);
});
