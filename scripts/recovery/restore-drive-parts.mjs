import { constants } from 'node:fs';
import { lstat, open, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PARTS = 10000;
const MAX_SOURCE_BYTES = 1024 ** 4;
const CHUNK_BYTES = 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;

function basename(value) {
  if (typeof value !== 'string' || !value || value.length > 240 ||
      /[\\/<>:"|?*\x00-\x1f\x7f]/.test(value) || /^[. ]|[. ]$/.test(value) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[. ]|$)/i.test(value)) {
    throw new Error('Unsafe basename in manifest or destination');
  }
  return value;
}

async function safeExisting(target, type) {
  const absolute = path.resolve(target);
  let cursor = absolute, first;
  while (true) {
    const info = await lstat(cursor, { bigint: true });
    if (info.isSymbolicLink()) throw new Error('Symlink or junction paths are forbidden');
    if (cursor === absolute) {
      if (!(type === 'file' ? info.isFile() : info.isDirectory())) throw new Error('Unexpected file type');
      first = info;
    } else if (!info.isDirectory()) throw new Error('Input parent must be a directory');
    const parent = path.dirname(cursor);
    if (parent === cursor) return first;
    cursor = parent;
  }
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;
}

async function safeOpen(target) {
  const before = await safeExisting(target, 'file');
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await handle.stat({ bigint: true });
    if (!current.isFile() || !sameFile(before, current)) throw new Error('Input changed while opening');
    return { handle, before };
  } catch (error) { await handle.close(); throw error; }
}

async function unchanged(target, handle, before) {
  if (!sameFile(before, await handle.stat({ bigint: true })) ||
      !sameFile(before, await safeExisting(target, 'file'))) throw new Error('Input changed while reading');
}

async function absent(target) {
  try { await lstat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Destination already exists');
}

async function readManifest(manifestPath) {
  const { handle, before } = await safeOpen(manifestPath);
  let manifest;
  try {
    if (before.size < 1n || before.size > BigInt(MAX_MANIFEST_BYTES)) throw new Error('Manifest byte limit exceeded');
    // Bound the allocation and reads even if another process grows the file.
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== Number(before.size)) throw new Error('Manifest size changed');
    await unchanged(manifestPath, handle, before);
    manifest = JSON.parse(buffer.subarray(0, offset).toString('utf8'));
  } finally { await handle.close(); }
  if (!manifest || manifest.version !== 1 || typeof manifest.backupId !== 'string' ||
      !manifest.backupId || manifest.backupId.length > 256 || /[\x00-\x1f\x7f]/.test(manifest.backupId)) {
    throw new Error('Invalid version 1 backup manifest');
  }
  basename(manifest.sourceName);
  if (!Number.isSafeInteger(manifest.sourceBytes) || manifest.sourceBytes < 1 || manifest.sourceBytes > MAX_SOURCE_BYTES) {
    throw new Error('Invalid source bytes or source byte limit exceeded');
  }
  if (typeof manifest.sourceSha256 !== 'string' || !HASH.test(manifest.sourceSha256) || !Array.isArray(manifest.parts) ||
      !manifest.parts.length || manifest.parts.length > MAX_PARTS) throw new Error('Invalid manifest hash or parts');
  const names = new Set(); let total = 0;
  for (const [offset, part] of manifest.parts.entries()) {
    if (!part || part.index !== offset + 1) throw new Error('Part indices must be sequential from 1');
    const name = basename(part.filename).toLowerCase();
    if (names.has(name)) throw new Error('Duplicate part filename');
    names.add(name);
    if (!Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > MAX_SOURCE_BYTES ||
        typeof part.sha256 !== 'string' || !HASH.test(part.sha256) || typeof part.driveFileId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(part.driveFileId)) throw new Error('Invalid part metadata');
    total += part.bytes;
    if (!Number.isSafeInteger(total) || total > MAX_SOURCE_BYTES) throw new Error('Part total byte limit exceeded');
  }
  if (total !== manifest.sourceBytes) throw new Error('Part byte total differs from source bytes');
  return manifest;
}

async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
    if (!bytesWritten) throw new Error('Unable to write restore output');
    offset += bytesWritten;
  }
}

/** Restore downloaded parts in trusted local directories; never executes or removes source files.
 * Parent and file checks reject static links and detect common concurrent changes. As with other
 * ordinary filesystem tools, directories must not be writable by a hostile concurrent process.
 */
export async function restoreDriveParts({ manifestPath, partsDir, destination, verifyOnly = false }) {
  if (typeof manifestPath !== 'string' || typeof partsDir !== 'string' || typeof verifyOnly !== 'boolean') {
    throw new Error('Manifest path and parts directory are required');
  }
  if (!verifyOnly && (typeof destination !== 'string' || !destination)) throw new Error('Destination is required');
  const manifest = await readManifest(path.resolve(manifestPath));
  const directory = path.resolve(partsDir);
  await safeExisting(directory, 'directory');
  const target = verifyOnly ? null : path.resolve(destination);
  let temporary, output, temporaryIdentity;
  if (target) {
    basename(path.basename(target));
    await safeExisting(path.dirname(target), 'directory');
    await absent(target);
  }
  try {
    if (target) {
      temporary = path.join(path.dirname(target), `.paradize-restore-${randomUUID()}.tmp`);
      output = await open(temporary, 'wx', 0o600);
      temporaryIdentity = await output.stat({ bigint: true });
    }
    const fullHash = createHash('sha256'); let total = 0;
    const buffer = Buffer.alloc(CHUNK_BYTES);
    for (const part of manifest.parts) {
      const input = path.join(directory, part.filename);
      const { handle, before } = await safeOpen(input);
      try {
        if (before.size !== BigInt(part.bytes)) throw new Error(`Part ${part.index} size mismatch`);
        const partHash = createHash('sha256'); let bytes = 0;
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          bytes += bytesRead;
          if (bytes > part.bytes) throw new Error(`Part ${part.index} grew while reading`);
          const chunk = buffer.subarray(0, bytesRead);
          partHash.update(chunk); fullHash.update(chunk);
          if (output) await writeAll(output, chunk);
        }
        if (bytes !== part.bytes || partHash.digest('hex') !== part.sha256) throw new Error(`Part ${part.index} hash or size mismatch`);
        await unchanged(input, handle, before);
        total += bytes;
      } finally { await handle.close(); }
    }
    const sourceSha256 = fullHash.digest('hex');
    if (total !== manifest.sourceBytes || sourceSha256 !== manifest.sourceSha256) throw new Error('Complete source hash or size mismatch');
    if (output) {
      await output.sync();
      temporaryIdentity = await output.stat({ bigint: true });
      await output.close(); output = null;
      await safeExisting(path.dirname(target), 'directory');
      if (!sameFile(temporaryIdentity, await safeExisting(temporary, 'file'))) throw new Error('Restore output changed before publication');
      // Same-directory hard-link creation is atomic and refuses an existing destination.
      // rename() is deliberately avoided because it may overwrite a concurrent file.
      await link(temporary, target);
      await unlink(temporary); temporary = null;
    }
    return { version: 1, backupId: manifest.backupId, verified: true, restored: !verifyOnly,
      sourceName: manifest.sourceName, sourceBytes: total, sourceSha256,
      partCount: manifest.parts.length, ...(target ? { destination: target } : {}) };
  } finally {
    if (output) await output.close();
    if (temporary) {
      // Only remove this operation's temporary file; never delete an unexpected replacement.
      const current = await lstat(temporary, { bigint: true }).catch(error => {
        if (error.code === 'ENOENT') return null; throw error;
      });
      if (current?.isFile() && current.dev === temporaryIdentity?.dev && current.ino === temporaryIdentity?.ino) await unlink(temporary);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), verifyOnly = args[0] === '--verify-only';
  const positional = verifyOnly ? args.slice(1) : args;
  if (positional.length !== (verifyOnly ? 2 : 3) || positional.some(arg => arg.startsWith('--'))) {
    console.error('Usage: node restore-drive-parts.mjs manifest.json parts-directory destination\n       node restore-drive-parts.mjs --verify-only manifest.json parts-directory');
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await restoreDriveParts({ manifestPath: positional[0], partsDir: positional[1],
        destination: positional[2], verifyOnly }), null, 2));
    } catch (error) { console.error(`Restore failed: ${error.message}`); process.exitCode = 1; }
  }
}
