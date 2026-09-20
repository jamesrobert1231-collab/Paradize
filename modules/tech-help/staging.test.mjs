import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectPipelineExport } from './pipeline.mjs';
import { stagePipelineExport, readStagedPipeline } from './staging.mjs';
const origin = 'https://help.example.test';
const packet = raw => Buffer.from(JSON.stringify({ version: 1, origin, capturedAt: '2026-09-15T00:00:00.000Z', storageKey: 'ovth-pipeline', raw }, null, 2));
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-stage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('staging preserves exact bytes and repeat import does not duplicate or rewrite them', t => {
  const directory = fixture(t), bytes = packet('[]');
  const first = stagePipelineExport(directory, bytes, origin);
  const final = path.join(directory, first.exportSha256 + '.json');
  assert.ok(fs.readFileSync(final).equals(bytes));
  const before = fs.statSync(final).mtimeMs;
  assert.equal(stagePipelineExport(directory, bytes, origin).imported, false);
  assert.equal(fs.statSync(final).mtimeMs, before);
  assert.equal(fs.readdirSync(directory).length, 1);
  assert.deepEqual(readStagedPipeline(directory, first.exportSha256, origin), inspectPipelineExport(bytes, origin));
  const second = stagePipelineExport(directory, packet(null), origin);
  assert.notEqual(first.exportSha256, second.exportSha256);
  assert.equal(fs.readdirSync(directory).length, 2);
});
test('corruption blocks reads and repeated imports without overwriting evidence', t => {
  const directory = fixture(t), bytes = packet('[]');
  const first = stagePipelineExport(directory, bytes, origin);
  const final = path.join(directory, first.exportSha256 + '.json');
  fs.writeFileSync(final, packet(null));
  assert.throws(() => readStagedPipeline(directory, first.exportSha256, origin), /hash mismatch/);
  assert.throws(() => stagePipelineExport(directory, bytes, origin), /hash mismatch/);
  assert.ok(fs.readFileSync(final).equals(packet(null)));
});
test('interrupted locks and pending files block competing imports', t => {
  const directory = fixture(t), bytes = packet('[]');
  const hash = inspectPipelineExport(bytes, origin).exportSha256;
  fs.writeFileSync(path.join(directory, '.import.lock'), '');
  assert.throws(() => stagePipelineExport(directory, bytes, origin), /EEXIST/);
  fs.unlinkSync(path.join(directory, '.import.lock'));
  fs.writeFileSync(path.join(directory, hash + '.pending'), 'partial');
  assert.throws(() => stagePipelineExport(directory, bytes, origin), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(directory, hash + '.pending'), 'utf8'), 'partial');
});
test('invalid origin produces no staged data and hard-linked originals are rejected', t => {
  const directory = fixture(t), bytes = packet('[]');
  assert.throws(() => stagePipelineExport(directory, bytes, 'https://other.example.test'));
  assert.deepEqual(fs.readdirSync(directory), []);
  const first = stagePipelineExport(directory, bytes, origin);
  fs.linkSync(path.join(directory, first.exportSha256 + '.json'), path.join(directory, 'alias.json'));
  assert.throws(() => readStagedPipeline(directory, first.exportSha256, origin), /Unsafe/);
});
