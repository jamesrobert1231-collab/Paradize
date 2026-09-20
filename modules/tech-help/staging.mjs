import fs from 'node:fs';
import path from 'node:path';
import { inspectPipelineExport } from './pipeline.mjs';

function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new Error('Unsafe export file');
  return stat;
}
function directoryChain(directory) {
  let current = path.resolve(directory);
  while (true) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Staging path contains a linked or invalid directory');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export function readStagedPipeline(directory, exportHash, expectedOrigin) {
  if (!/^[a-f0-9]{64}$/.test(exportHash)) throw new Error('Invalid export hash');
  directoryChain(directory);
  const file = path.join(directory, exportHash + '.json');
  regular(file);
  const result = inspectPipelineExport(fs.readFileSync(file), expectedOrigin);
  if (result.exportSha256 !== exportHash) throw new Error('Staged original hash mismatch');
  return result;
}
export function stagePipelineExport(directory, bytes, expectedOrigin) {
  const inspected = inspectPipelineExport(bytes, expectedOrigin);
  // Caller provisions a private directory; this does not invent Windows ACLs.
  directoryChain(directory);
  const final = path.join(directory, inspected.exportSha256 + '.json');
  const lock = path.join(directory, '.import.lock');
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    if (fs.existsSync(final)) {
      readStagedPipeline(directory, inspected.exportSha256, expectedOrigin);
      return { imported: false, ...inspected };
    }
    const pending = path.join(directory, inspected.exportSha256 + '.pending');
    const fd = fs.openSync(pending, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    regular(pending);
    if (!fs.readFileSync(pending).equals(bytes)) throw new Error('Staging readback mismatch');
    fs.renameSync(pending, final);
    return { imported: true, ...readStagedPipeline(directory, inspected.exportSha256, expectedOrigin) };
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}
