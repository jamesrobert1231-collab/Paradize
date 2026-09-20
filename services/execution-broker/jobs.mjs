import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STATES = new Set(['prepared', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled']);
const EDGES = { prepared: ['running', 'cancelled'], running: ['cancelling', 'succeeded', 'failed'], cancelling: ['cancelled', 'failed'] };
function validate(record) {
  if (!record || record.version !== 1 || !ID.test(record.id) || !STATES.has(record.state) || !/^[a-f0-9]{64}$/.test(record.inputSha256) || !Number.isSafeInteger(record.revision) || record.revision < 0 || record.owner !== 'local-owner' || record.automaticRestart !== false || !Number.isFinite(Date.parse(record.updatedAt))) throw new Error('Invalid job record');
  if (['running', 'cancelling', 'succeeded', 'failed'].includes(record.state) && !/^[a-f0-9]{64}$/.test(record.containerId || '')) throw new Error('Invalid container identity');
  if (record.state === 'succeeded' && record.exitCode !== 0) throw new Error('Invalid success record');
  if (['succeeded', 'failed', 'cancelled'].includes(record.state) && record.processTreeStopped !== true) throw new Error('Termination is not established');
  return record;
}
function rootDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Absolute job directory required');
  const root = path.resolve(directory);
  let cursor = root;
  while (true) {
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid job directory');
    const parent = path.dirname(cursor); if (parent === cursor) return root; cursor = parent;
  }
}
export function readJob(directory, id) {
  if (!ID.test(id || '')) throw new Error('Invalid job identifier');
  const file = path.join(rootDirectory(directory), id + '.json');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) throw new Error('Invalid job file');
  const record = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (record.id !== id) throw new Error('Job identity mismatch');
  return record;
}
function write(directory, record, create = false) {
  validate(record);
  const final = path.join(directory, record.id + '.json');
  const pending = path.join(directory, '.' + record.id + '.pending');
  if (create && fs.existsSync(final)) throw new Error('Job exists');
  const descriptor = fs.openSync(pending, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(record)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(pending, final);
  return record;
}
export function prepareJob(directory, inputSha256) {
  const root = rootDirectory(directory);
  return write(root, { version: 1, id: randomUUID(), inputSha256, state: 'prepared', revision: 0,
    owner: 'local-owner', automaticRestart: false, updatedAt: new Date().toISOString() }, true);
}
/** Trusted broker only: runtime observations must come from its container adapter.
 * Supplying these fields does not itself qualify a sandbox or authorize launching.
 */
export function transitionJob(directory, id, expectedRevision, nextState, observation = {}) {
  const root = rootDirectory(directory);
  if (!ID.test(id || '')) throw new Error('Invalid job identifier');
  const lock = path.join(root, '.' + id + '.lock');
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    const current = readJob(root, id);
    if (current.revision !== expectedRevision) throw new Error('Stale job revision');
    if (!(EDGES[current.state] || []).includes(nextState)) throw new Error('Invalid job transition');
    const updated = { ...current, state: nextState, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    if (nextState === 'running') {
      if (!/^[a-f0-9]{64}$/.test(observation.containerId || '')) throw new Error('Container identity required');
      updated.containerId = observation.containerId;
    }
    if (['succeeded', 'failed', 'cancelled'].includes(nextState)) {
      if (current.state !== 'prepared' && observation.containerId !== current.containerId) throw new Error('Runtime identity mismatch');
      if (observation.processTreeStopped !== true) throw new Error('Termination is not established');
      if (nextState === 'succeeded' && observation.exitCode !== 0) throw new Error('Successful exit required');
      updated.processTreeStopped = true;
      if (Number.isInteger(observation.exitCode)) updated.exitCode = observation.exitCode;
    }
    return write(root, updated);
  } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
export function recoveryStatus(directory, id) {
  const job = readJob(directory, id);
  return { job, needsRuntimeReconciliation: ['running', 'cancelling'].includes(job.state), automaticRestart: false };
}
