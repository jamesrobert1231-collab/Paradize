import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { admitOutputs, readArtifacts } from './artifacts.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-artifacts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, 'source'), artifactRoot = path.join(root, 'store');
  fs.mkdirSync(sourceDirectory); fs.mkdirSync(artifactRoot);
  fs.writeFileSync(path.join(sourceDirectory, 'answer.txt'), 'synthetic job result');
  return { root, sourceDirectory, artifactRoot, jobId: randomUUID() };
}
test('publishes a verified artifact set and inert receipt while preserving source', t => {
  const f = fixture(t);
  const receipt = admitOutputs(f);
  assert.equal(receipt.status, 'stored-unreviewed');
  assert.equal(receipt.executionGranted, false);
  assert.equal(readArtifacts(f).artifacts[0].bytes.toString(), 'synthetic job result');
  assert.equal(fs.readFileSync(path.join(f.sourceDirectory, 'answer.txt'), 'utf8'), 'synthetic job result');
  assert.deepEqual(fs.readdirSync(f.artifactRoot), [f.jobId]);
  assert.throws(() => admitOutputs(f), /already exist/);
});
test('invalid source never publishes a job or alters prior artifacts', t => {
  const f = fixture(t); admitOutputs(f);
  fs.writeFileSync(path.join(f.sourceDirectory, 'bad.exe'), 'MZ');
  const next = { ...f, jobId: randomUUID() };
  assert.throws(() => admitOutputs(next), /Unsupported/);
  assert.deepEqual(fs.readdirSync(f.artifactRoot), [f.jobId]);
  assert.equal(readArtifacts(f).artifacts[0].bytes.toString(), 'synthetic job result');
});
test('detects changed stored bytes and forged authority fields', t => {
  const f = fixture(t); admitOutputs(f);
  const stored = path.join(f.artifactRoot, f.jobId, 'files', 'answer.txt');
  fs.writeFileSync(stored, 'modified');
  assert.throws(() => readArtifacts(f), /integrity/);
  fs.writeFileSync(stored, 'synthetic job result');
  const file = path.join(f.artifactRoot, f.jobId, 'receipt.json');
  const receipt = JSON.parse(fs.readFileSync(file)); receipt.executionGranted = true;
  fs.writeFileSync(file, JSON.stringify(receipt));
  assert.throws(() => readArtifacts(f), /receipt/);
});
test('rejects overlapping roots, path identifiers and stale writer locks', t => {
  const f = fixture(t);
  assert.throws(() => admitOutputs({ ...f, artifactRoot: f.root }), /separate/);
  assert.throws(() => admitOutputs({ ...f, jobId: '../escape' }), /identifier/);
  const lock = path.join(f.artifactRoot, `.${f.jobId}.lock`); fs.writeFileSync(lock, 'interrupted');
  assert.throws(() => admitOutputs(f));
  assert.equal(fs.readFileSync(lock, 'utf8'), 'interrupted');
});
