import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const TYPES = new Map([
  ['.txt', 'text'], ['.md', 'text'], ['.csv', 'text'], ['.json', 'json'],
  ['.html', 'untrusted-html'], ['.js', 'source-code'], ['.py', 'source-code'],
]);
const LIMITS = { entries: 128, files: 64, depth: 4, fileBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024 };
const fail = message => { throw new Error(message); };
function same(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs; }
function checkAncestors(directory) {
  let cursor = directory;
  while (true) {
    const info = fs.lstatSync(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) fail('Linked or invalid output directory');
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}
function safeName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$/.test(name) && !/[ .]$/.test(name) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

/** Read a stopped job's exclusively held output directory into bounded snapshots.
 * This does not establish process termination, isolation, or permission to execute.
 * The broker must obtain exclusive custody before calling; live writers are unsupported.
 */
export function snapshotOutputs(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('Absolute output directory required');
  const root = path.resolve(directory);
  checkAncestors(root);
  const artifacts = [];
  let entries = 0, totalBytes = 0;
  function walk(folder, relative, depth) {
    if (depth > LIMITS.depth) fail('Output depth limit');
    const beforeDirectory = fs.lstatSync(folder);
    if (!beforeDirectory.isDirectory() || beforeDirectory.isSymbolicLink()) fail('Linked or invalid output directory');
    const names = fs.readdirSync(folder).sort();
    const folded = new Set();
    for (const name of names) {
      if (++entries > LIMITS.entries) fail('Output entry limit');
      if (!safeName(name) || folded.has(name.toLowerCase())) fail('Unsafe or colliding output name');
      folded.add(name.toLowerCase());
      const filename = path.join(folder, name);
      const portable = relative ? `${relative}/${name}` : name;
      const info = fs.lstatSync(filename);
      if (info.isSymbolicLink()) fail('Output links are forbidden');
      if (info.isDirectory()) { walk(filename, portable, depth + 1); continue; }
      if (!info.isFile() || info.nlink !== 1) fail('Output must be an independent regular file');
      if (artifacts.length >= LIMITS.files || info.size > LIMITS.fileBytes || totalBytes + info.size > LIMITS.totalBytes) fail('Output byte or file limit');
      const kind = TYPES.get(path.extname(name).toLowerCase());
      if (!kind) fail('Unsupported output type');
      const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      let bytes;
      try {
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || opened.nlink !== 1 || !same(info, opened)) fail('Output changed before read');
        bytes = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < bytes.length) {
          const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
          if (!count) fail('Output truncated during read');
          offset += count;
        }
        if (!same(opened, fs.fstatSync(descriptor)) || !same(opened, fs.lstatSync(filename))) fail('Output changed during read');
      } finally { fs.closeSync(descriptor); }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) fail('Binary data disguised as text');
      if (kind === 'json') JSON.parse(text);
      totalBytes += bytes.length;
      artifacts.push({ path: portable, kind, bytes, size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), executionGranted: false });
    }
    const afterDirectory = fs.lstatSync(folder);
    if (afterDirectory.isSymbolicLink() || beforeDirectory.ino !== afterDirectory.ino || beforeDirectory.dev !== afterDirectory.dev || names.join('\0') !== fs.readdirSync(folder).sort().join('\0')) fail('Output directory changed');
  }
  walk(root, '', 0);
  return { artifacts, totalBytes, executionGranted: false, previewsIsolated: false };
}
