import fs from 'node:fs';
import path from 'node:path';
import { snapshotOutputs } from './outputs.mjs';
import { readJob } from './jobs.mjs';

const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function directory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Absolute trusted directory required');
  const root = path.resolve(value);
  let cursor = root;
  while (true) {
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Linked or invalid artifact directory');
    const parent = path.dirname(cursor);
    if (parent === cursor) return root;
    cursor = parent;
  }
}
function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function durableWrite(filename, bytes) {
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
const metadata = snapshot => snapshot.artifacts.map(({ path, kind, size, sha256 }) => ({ path, kind, size, sha256 }));

/** Caller supplies a trusted owner-only store and exclusive custody of stopped-job output.
 * Admission is storage only. It neither authorizes a job nor makes HTML executable.
 */
export function admitOutputs({ sourceDirectory, artifactRoot, jobId }) {
  return storeOutputs({ sourceDirectory, artifactRoot, jobId }, null);
}

function completedBinding(jobDirectory, jobId) {
  const job = readJob(jobDirectory, jobId);
  if (job.state !== 'succeeded' || job.exitCode !== 0 || job.processTreeStopped !== true) throw new Error('Job is not a completed success');
  return { jobId: job.id, revision: job.revision, inputSha256: job.inputSha256, containerId: job.containerId };
}

export function admitCompletedJobOutputs({ sourceDirectory, artifactRoot, jobDirectory, jobId }) {
  const binding = completedBinding(jobDirectory, jobId);
  return storeOutputs({ sourceDirectory, artifactRoot, jobId }, binding);
}

function storeOutputs({ sourceDirectory, artifactRoot, jobId }, jobBinding) {
  if (!JOB_ID.test(jobId || '')) throw new Error('Invalid job identifier');
  const source = directory(sourceDirectory), root = directory(artifactRoot);
  if (contains(source, root) || contains(root, source)) throw new Error('Source and artifact store must be separate');
  const final = path.join(root, jobId);
  const lock = path.join(root, `.${jobId}.lock`);
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    if (fs.existsSync(final)) throw new Error('Job artifacts already exist');
    const snapshot = snapshotOutputs(source);
    const staging = fs.mkdtempSync(path.join(root, `.${jobId}.pending-`));
    const files = path.join(staging, 'files'); fs.mkdirSync(files);
    for (const artifact of snapshot.artifacts) {
      const destination = path.join(files, ...artifact.path.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      durableWrite(destination, artifact.bytes);
    }
    const receipt = { version: 1, jobId, savedAt: new Date().toISOString(), owner: 'local-owner',
      status: 'stored-unreviewed', executionGranted: false, totalBytes: snapshot.totalBytes,
      artifacts: metadata(snapshot), jobBinding };
    durableWrite(path.join(staging, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    // Verify the stored bytes before publishing the directory as a complete set.
    const readback = snapshotOutputs(files);
    if (JSON.stringify(metadata(readback)) !== JSON.stringify(receipt.artifacts)) throw new Error('Artifact readback mismatch');
    if (fs.existsSync(final)) throw new Error('Job artifacts already exist');
    fs.renameSync(staging, final);
    return receipt;
  } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}

export function readArtifacts({ artifactRoot, jobId }) {
  if (!JOB_ID.test(jobId || '')) throw new Error('Invalid job identifier');
  const root = directory(artifactRoot);
  const job = directory(path.join(root, jobId));
  const receiptPath = path.join(job, 'receipt.json');
  const stat = fs.lstatSync(receiptPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) throw new Error('Invalid artifact receipt');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.version !== 1 || receipt.jobId !== jobId || receipt.owner !== 'local-owner' || receipt.status !== 'stored-unreviewed' || receipt.executionGranted !== false || typeof receipt.savedAt !== 'string' || !Number.isFinite(Date.parse(receipt.savedAt))) throw new Error('Invalid artifact receipt');
  const snapshot = snapshotOutputs(path.join(job, 'files'));
  if (snapshot.totalBytes !== receipt.totalBytes || JSON.stringify(metadata(snapshot)) !== JSON.stringify(receipt.artifacts)) throw new Error('Artifact integrity mismatch');
  return { receipt, artifacts: snapshot.artifacts };
}

export function readCompletedJobArtifacts(options) {
  const expected = completedBinding(options.jobDirectory, options.jobId);
  const result = readArtifacts(options);
  if (JSON.stringify(result.receipt.jobBinding) !== JSON.stringify(expected)) throw new Error('Artifact job binding mismatch');
  return result;
}
