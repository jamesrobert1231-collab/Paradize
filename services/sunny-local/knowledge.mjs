import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;

function unlinkedPath(file) {
  const absolute = path.resolve(file);
  let cursor = absolute;
  while (true) {
    const stat = fs.lstatSync(cursor, { bigint: true });
    if (stat.isSymbolicLink() || (cursor === absolute ? !stat.isFile() : !stat.isDirectory())) throw new Error('Invalid stored file path');
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function readStoredFile(file, maxBytes) {
  unlinkedPath(file);
  const before = fs.lstatSync(file, { bigint: true });
  if (before.size < 1n || before.size > BigInt(maxBytes)) throw new Error('Stored file size is outside limits');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!sameFile(before, fs.fstatSync(fd, { bigint: true }))) throw new Error('Stored file changed while opening');
    // Never allocate or read beyond the validated size plus one growth-detection byte.
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(fd, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    unlinkedPath(file);
    if (count !== Number(before.size) || !sameFile(before, fs.fstatSync(fd, { bigint: true })) ||
        !sameFile(before, fs.lstatSync(file, { bigint: true }))) throw new Error('Stored file changed while reading');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

function readIndex(directory) {
  const file = path.join(directory, 'index.json');
  if (!fs.existsSync(file)) return [];
  let data;
  try { data = JSON.parse(readStoredFile(file, MAX_BYTES).toString('utf8')); }
  catch { throw new Error('Invalid knowledge index'); }
  if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > 10000) throw new Error('Invalid knowledge index');
  const ids = new Set();
  for (const r of data.records) {
    if (!r || !/^[a-f0-9]{64}$/.test(r.id) || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 200000 || hash(r.text) !== r.textSha256 || typeof r.source !== 'string' || !path.isAbsolute(r.source) || r.source.length > 4096 || typeof r.title !== 'string' || !r.title.trim() || r.title.length > 300 || !/^[a-f0-9]{64}$/.test(r.originalSha256) || r.uncertainty !== 'unverified' || r.owner !== 'local-owner' || r.historicalAuthority !== false || typeof r.importedAt !== 'string' || !Number.isFinite(Date.parse(r.importedAt)) || r.id !== hash(JSON.stringify([r.source, r.originalSha256, r.textSha256])) || ids.has(r.id)) throw new Error('Invalid knowledge record');
    ids.add(r.id);
  }
  return data.records;
}

function originalBytes(directory, record) {
  try {
    const bytes = readStoredFile(path.join(directory, `${record.id}.original`), MAX_ORIGINAL_BYTES);
    if (hash(bytes) !== record.originalSha256) throw new Error('Hash mismatch');
    return bytes;
  } catch { throw new Error('Preserved original does not match'); }
}

export function readKnowledgeOriginal(directory, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid knowledge identifier');
  const record = readIndex(directory).find(record => record.id === id);
  if (!record) return null;
  return { bytes: originalBytes(directory, record), originalSha256: record.originalSha256 };
}

export function importDocument(directory, { source, title, text, originalBytes, uncertainty = 'unverified' }) {
  if (typeof source !== 'string' || !path.isAbsolute(source) || source.length > 4096 || typeof title !== 'string' || !title.trim() || title.length > 300 || typeof text !== 'string' || !text.trim() || text.length > 200000 || !Buffer.isBuffer(originalBytes) || !originalBytes.length || originalBytes.length > 10 * 1024 * 1024 || uncertainty !== 'unverified') throw new Error('Invalid document import');
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Knowledge directory cannot be a link');
  // One importer at a time; a surviving lock after interruption requires review.
  const lock = path.join(directory, 'import.lock');
  const fd = fs.openSync(lock, 'wx');
  try {
    const records = readIndex(directory);
    const originalSha256 = hash(originalBytes);
    const textSha256 = hash(text);
    const id = hash(JSON.stringify([source, originalSha256, textSha256]));
    const existing = records.find(r => r.id === id);
    const original = path.join(directory, `${id}.original`);
    if (existing) {
      if (fs.lstatSync(original).isSymbolicLink() || hash(fs.readFileSync(original)) !== originalSha256) throw new Error('Preserved original does not match');
      return { id, imported: false, records: records.length };
    }
    if (records.length >= 10000) throw new Error('Knowledge record limit');
    if (fs.existsSync(original)) {
      if (fs.lstatSync(original).isSymbolicLink() || hash(fs.readFileSync(original)) !== originalSha256) throw new Error('Original conflict');
    } else {
      const originalFd = fs.openSync(original, 'wx', 0o600);
      try { fs.writeFileSync(originalFd, originalBytes); fs.fsyncSync(originalFd); } finally { fs.closeSync(originalFd); }
    }
    records.push({ id, title, text, source, originalSha256, textSha256, uncertainty, importedAt: new Date().toISOString(), owner: 'local-owner', historicalAuthority: false });
    const encoded = JSON.stringify({ version: 1, records });
    if (Buffer.byteLength(encoded) > MAX_BYTES) throw new Error('Knowledge index byte limit');
    const temporary = path.join(directory, 'index.pending');
    const indexFd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(indexFd, encoded); fs.fsyncSync(indexFd); } finally { fs.closeSync(indexFd); }
    fs.renameSync(temporary, path.join(directory, 'index.json'));
    return { id, imported: true, records: records.length };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

export function searchKnowledge(directory, query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Invalid search');
  const terms = [...new Set(query.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]{2,}/gu) || [])];
  if (!terms.length) return [];
  const records = readIndex(directory);
  return records.map(r => {
    const haystack = `${r.title}\n${r.text}`.toLocaleLowerCase('en-US');
    return { r, score: terms.filter(term => haystack.includes(term)).length };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id)).slice(0, 5).map(({ r }) => {
    originalBytes(directory, r);
    const lower = r.text.toLocaleLowerCase('en-US');
    const hits = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
    const start = Math.max(0, (hits.length ? Math.min(...hits) : 0) - 100);
    return { id: r.id, title: r.title, snippet: r.text.slice(start, start + 700), source: r.source, originalSha256: r.originalSha256, uncertainty: r.uncertainty, importedAt: r.importedAt };
  });
}
