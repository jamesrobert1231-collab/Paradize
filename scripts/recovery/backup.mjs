import { lstat, readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('PZBK0001');
const DEFAULT_LIMIT = 16 * 1024 * 1024;
const hash = data => createHash('sha256').update(data).digest('hex');
const inside = (parent, child) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };

function limitValue(value = DEFAULT_LIMIT) {
  if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMIT) throw new Error('Input limit must be between 1 and 16 MiB');
  return value;
}
async function absent(target) {
  try { await lstat(target); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  throw new Error('Output already exists');
}
async function safeExisting(target, type) {
  const absolute = path.resolve(target);
  let cursor = absolute;
  while (true) {
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error('Symlink or junction paths are forbidden');
    if (cursor === absolute && !(type === 'directory' ? info.isDirectory() : info.isFile())) throw new Error('Unexpected input type');
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return absolute;
}
function entryPath(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value || value.includes('\\')) throw new Error('Invalid manifest path');
  const pieces = value.split('/');
  for (const piece of pieces) {
    if (!piece || piece === '.' || piece === '..' || /[<>:"|?*\x00-\x1f]/.test(piece) || /[. ]$/.test(piece) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(piece)) throw new Error('Unsafe manifest path');
  }
  return value;
}

export async function createEncryptedBackup({ sourceDir, archivePath, keyPath, maxInputBytes }) {
  const limit = limitValue(maxInputBytes);
  const source = await safeExisting(sourceDir, 'directory');
  const archive = path.resolve(archivePath), keyFile = path.resolve(keyPath);
  await safeExisting(path.dirname(archive), 'directory'); await safeExisting(path.dirname(keyFile), 'directory');
  if (inside(source, archive) || inside(source, keyFile)) throw new Error('Outputs cannot be inside source');
  if (inside(path.dirname(archive), keyFile)) throw new Error('Recovery key requires a separate directory outside the archive directory');
  await absent(archive); await absent(keyFile);
  const entries = []; let total = 0;
  async function visit(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort()) {
      const rel = entryPath(prefix ? `${prefix}/${name}` : name);
      const full = path.join(directory, name), info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error('Symlink or junction inputs are forbidden');
      if (entries.length >= 10000) throw new Error('Entry count limit exceeded');
      if (info.isDirectory()) { entries.push({ path: rel, type: 'directory' }); await visit(full, rel); }
      else if (info.isFile()) {
        total += info.size; if (total > limit) throw new Error('Input byte limit exceeded');
        const data = await readFile(full);
        const after = await lstat(full);
        if (data.length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ino !== info.ino || after.isSymbolicLink()) throw new Error('Source changed during snapshot');
        entries.push({ path: rel, type: 'file', size: data.length, sha256: hash(data), data: data.toString('base64') });
      } else throw new Error('Unsupported input type');
    }
  }
  await visit(source);
  const payload = Buffer.from(JSON.stringify({ version: 1, entries }));
  if (payload.length > limit * 2 + 4 * 1024 * 1024) throw new Error('Manifest byte limit exceeded');
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(MAGIC);
  const data = Buffer.concat([cipher.update(payload), cipher.final()]);
  await writeFile(keyFile, key, { flag: 'wx', mode: 0o600 });
  try { await writeFile(archive, Buffer.concat([MAGIC, iv, cipher.getAuthTag(), data]), { flag: 'wx', mode: 0o600 }); }
  catch (error) { await unlink(keyFile); throw error; }
  return { version: 1, fileCount: entries.filter(e => e.type === 'file').length, inputBytes: total };
}

export async function restoreEncryptedBackup({ archivePath, keyPath, destinationDir, maxInputBytes }) {
  const limit = limitValue(maxInputBytes);
  const archive = await safeExisting(archivePath, 'file'), keyFile = await safeExisting(keyPath, 'file');
  const destination = path.resolve(destinationDir);
  await safeExisting(path.dirname(destination), 'directory'); await absent(destination);
  if ((await lstat(archive)).size > limit * 2 + 4 * 1024 * 1024 + 36) throw new Error('Archive byte limit exceeded');
  if ((await lstat(keyFile)).size !== 32) throw new Error('Invalid recovery key');
  const bytes = await readFile(archive), key = await readFile(keyFile);
  if (bytes.length < 36 || !bytes.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid or truncated archive');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
  decipher.setAAD(MAGIC); decipher.setAuthTag(bytes.subarray(20, 36));
  const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]).toString('utf8'));
  if (payload.version !== 1 || !Array.isArray(payload.entries) || payload.entries.length > 10000) throw new Error('Invalid manifest');
  const paths = new Map(); let total = 0;
  const ready = payload.entries.map(entry => {
    const relative = entryPath(entry.path), folded = relative.toLowerCase();
    if (paths.has(folded)) throw new Error('Duplicate manifest path');
    if (!['file', 'directory'].includes(entry.type)) throw new Error('Invalid entry type');
    paths.set(folded, entry.type);
    if (entry.type === 'directory') return { relative, type: entry.type };
    if (typeof entry.data !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Invalid file metadata');
    const data = Buffer.from(entry.data, 'base64');
    total += data.length; if (total > limit) throw new Error('Input byte limit exceeded');
    if (data.toString('base64') !== entry.data || data.length !== entry.size || hash(data) !== entry.sha256) throw new Error('File hash or size mismatch');
    return { relative, type: entry.type, data };
  });
  for (const entry of ready) {
    const pieces = entry.relative.toLowerCase().split('/'); pieces.pop();
    while (pieces.length) { if (paths.get(pieces.join('/')) !== 'directory') throw new Error('Missing or conflicting parent directory'); pieces.pop(); }
  }
  // No output exists until authentication and the complete manifest have passed.
  await mkdir(destination, { mode: 0o700 });
  for (const entry of ready.filter(e => e.type === 'directory').sort((a, b) => a.relative.split('/').length - b.relative.split('/').length)) await mkdir(path.join(destination, ...entry.relative.split('/')), { mode: 0o700 });
  for (const entry of ready.filter(e => e.type === 'file')) await writeFile(path.join(destination, ...entry.relative.split('/')), entry.data, { flag: 'wx', mode: 0o600 });
  return { version: 1, fileCount: ready.filter(e => e.type === 'file').length, inputBytes: total };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, first, second, third] = process.argv.slice(2);
  try {
    if (!first || !second || !third || process.argv.length !== 6) throw new Error('Usage: backup.mjs create SOURCE ARCHIVE KEY | restore ARCHIVE KEY DESTINATION');
    const result = command === 'create' ? await createEncryptedBackup({ sourceDir: first, archivePath: second, keyPath: third }) : command === 'restore' ? await restoreEncryptedBackup({ archivePath: first, keyPath: second, destinationDir: third }) : (() => { throw new Error('Unknown command'); })();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch { process.stderr.write('Recovery operation failed; no source files were modified.\n'); process.exitCode = 1; }
}
