import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotOutputs } from './outputs.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-output-'));
  // Only this newly allocated test tree is removed.
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'output'); fs.mkdirSync(output);
  return { root, output };
}
test('snapshots preserve bytes, paths and hashes without executing source or HTML', t => {
  const { output } = fixture(t);
  fs.mkdirSync(path.join(output, 'notes'));
  fs.writeFileSync(path.join(output, 'notes', 'result.json'), '{"result":42}');
  fs.writeFileSync(path.join(output, 'preview.html'), '<script>throw new Error("not executed")</script>');
  const result = snapshotOutputs(output);
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.artifacts[0].path, 'notes/result.json');
  assert.equal(result.artifacts[0].bytes.toString(), '{"result":42}');
  assert.equal(result.artifacts[1].kind, 'untrusted-html');
  assert.equal(result.executionGranted, false);
  fs.writeFileSync(path.join(output, 'notes', 'result.json'), '{}');
  assert.equal(result.artifacts[0].bytes.toString(), '{"result":42}');
});
test('rejects executable extensions, invalid text and malformed JSON', t => {
  const { output } = fixture(t);
  for (const [name, bytes] of [['tool.exe', 'MZ'], ['bad.txt', Buffer.from([255])], ['binary.txt', '\0'], ['bad.json', '{']]) {
    const file = path.join(output, name); fs.writeFileSync(file, bytes);
    assert.throws(() => snapshotOutputs(output)); fs.unlinkSync(file);
  }
});
test('rejects hard links and directory junctions, including linked ancestors', t => {
  const { root, output } = fixture(t);
  const original = path.join(root, 'private.txt'); fs.writeFileSync(original, 'synthetic outside data');
  const link = path.join(output, 'linked.txt'); fs.linkSync(original, link);
  assert.throws(() => snapshotOutputs(output), /independent/); fs.unlinkSync(link);
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  const junction = path.join(output, 'external'); fs.symlinkSync(outside, junction, 'junction');
  assert.throws(() => snapshotOutputs(output), /links/);
  assert.throws(() => snapshotOutputs(junction), /Linked/);
});
test('enforces per-file byte and directory-depth limits', t => {
  const { output } = fixture(t);
  const huge = path.join(output, 'huge.txt'); fs.writeFileSync(huge, Buffer.alloc(8 * 1024 * 1024 + 1));
  assert.throws(() => snapshotOutputs(output), /limit/); fs.unlinkSync(huge);
  let current = output;
  for (let i = 0; i < 5; i++) { current = path.join(current, 'nested'); fs.mkdirSync(current); }
  assert.throws(() => snapshotOutputs(output), /depth/);
});
test('enforces independent entry and file-count limits', t => {
  const { root, output } = fixture(t);
  for (let i = 0; i < 129; i++) fs.mkdirSync(path.join(output, 'folder' + i));
  assert.throws(() => snapshotOutputs(output), /entry limit/);
  const files = path.join(root, 'manyfiles'); fs.mkdirSync(files);
  for (let i = 0; i < 65; i++) fs.writeFileSync(path.join(files, 'file' + i + '.txt'), '');
  assert.throws(() => snapshotOutputs(files), /file limit/);
});
