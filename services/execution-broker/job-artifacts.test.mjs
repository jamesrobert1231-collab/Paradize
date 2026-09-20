import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareJob, transitionJob } from './jobs.mjs';
import { admitOutputs, admitCompletedJobOutputs, readCompletedJobArtifacts } from './artifacts.mjs';
const containerId = 'c'.repeat(64);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-job-artifacts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, 'source'), artifactRoot = path.join(root, 'artifacts'), jobDirectory = path.join(root, 'jobs');
  for (const dir of [sourceDirectory, artifactRoot, jobDirectory]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(sourceDirectory, 'result.json'), '{"synthetic":true}');
  const job = prepareJob(jobDirectory, 'a'.repeat(64));
  return { sourceDirectory, artifactRoot, jobDirectory, jobId: job.id };
}
function finish(f) {
  transitionJob(f.jobDirectory, f.jobId, 0, 'running', { containerId });
  transitionJob(f.jobDirectory, f.jobId, 1, 'succeeded', { containerId, processTreeStopped: true, exitCode: 0 });
}
test('only completed jobs admit outputs with matching persistent provenance', t => {
  const f = fixture(t);
  assert.throws(() => admitCompletedJobOutputs(f), /not a completed success/);
  finish(f);
  const receipt = admitCompletedJobOutputs(f);
  assert.equal(receipt.jobBinding.inputSha256, 'a'.repeat(64));
  assert.equal(receipt.jobBinding.containerId, containerId);
  assert.equal(readCompletedJobArtifacts(f).artifacts[0].bytes.toString(), '{"synthetic":true}');
});
test('cancelled jobs cannot publish success artifacts', t => {
  const f = fixture(t);
  transitionJob(f.jobDirectory, f.jobId, 0, 'cancelled', { processTreeStopped: true });
  assert.throws(() => admitCompletedJobOutputs(f), /not a completed success/);
  assert.deepEqual(fs.readdirSync(f.artifactRoot), []);
});
test('unbound storage and altered bindings cannot masquerade as completed job output', t => {
  const f = fixture(t); finish(f); admitOutputs(f);
  assert.throws(() => readCompletedJobArtifacts(f), /binding mismatch/);
  const file = path.join(f.artifactRoot, f.jobId, 'receipt.json');
  const receipt = JSON.parse(fs.readFileSync(file));
  receipt.jobBinding = { jobId: f.jobId, revision: 2, inputSha256: 'b'.repeat(64), containerId };
  fs.writeFileSync(file, JSON.stringify(receipt));
  assert.throws(() => readCompletedJobArtifacts(f), /binding mismatch/);
});
