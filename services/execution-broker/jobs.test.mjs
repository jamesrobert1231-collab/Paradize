import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareJob, readJob, transitionJob, recoveryStatus } from './jobs.mjs';
const containerId = 'b'.repeat(64);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-jobs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('durable lifecycle requires matching runtime, stopped process tree and zero exit', t => {
  const root = fixture(t), prepared = prepareJob(root, 'a'.repeat(64));
  assert.equal(readJob(root, prepared.id).state, 'prepared');
  const running = transitionJob(root, prepared.id, 0, 'running', { containerId });
  assert.throws(() => transitionJob(root, running.id, 1, 'succeeded', { containerId, exitCode: 0 }), /Termination/);
  assert.throws(() => transitionJob(root, running.id, 1, 'succeeded', { containerId: 'c'.repeat(64), processTreeStopped: true, exitCode: 0 }), /identity/);
  const done = transitionJob(root, running.id, 1, 'succeeded', { containerId, processTreeStopped: true, exitCode: 0 });
  assert.equal(readJob(root, done.id).state, 'succeeded');
  assert.throws(() => transitionJob(root, done.id, 2, 'running', { containerId }), /transition/);
  fs.writeFileSync(path.join(root, done.id + '.json'), JSON.stringify({ ...done, processTreeStopped: false }));
  assert.throws(() => readJob(root, done.id), /Termination/);
});
test('restart observation preserves uncertain running and cancelling work without restart', t => {
  const root = fixture(t), job = prepareJob(root, 'a'.repeat(64));
  transitionJob(root, job.id, 0, 'running', { containerId });
  assert.equal(recoveryStatus(root, job.id).needsRuntimeReconciliation, true);
  assert.equal(readJob(root, job.id).state, 'running');
  transitionJob(root, job.id, 1, 'cancelling');
  assert.equal(recoveryStatus(root, job.id).automaticRestart, false);
  assert.throws(() => transitionJob(root, job.id, 2, 'succeeded', { containerId, processTreeStopped: true, exitCode: 0 }), /transition/);
  transitionJob(root, job.id, 2, 'cancelled', { containerId, processTreeStopped: true });
  assert.equal(recoveryStatus(root, job.id).needsRuntimeReconciliation, false);
});
test('stale revisions and corrupt records cannot mutate job state', t => {
  const root = fixture(t), job = prepareJob(root, 'a'.repeat(64));
  assert.throws(() => transitionJob(root, job.id, 5, 'running', { containerId }), /Stale/);
  const file = path.join(root, job.id + '.json');
  fs.writeFileSync(file, JSON.stringify({ ...job, automaticRestart: true }));
  assert.throws(() => readJob(root, job.id), /Invalid/);
});
