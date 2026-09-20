import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inspectPipelineExport } from './pipeline.mjs';
const origin = 'https://help.example.test';
const contact = { id: '83d8a6ef-9eaf-4c90-8459-cb6c05172649', firstName: 'Synthetic', email: 'test@example.test', problem: 'Wi-Fi', followUp: true, promotions: false, status: 'New inquiry', createdAt: '2026-09-15T00:00:00.000Z' };
const packet = raw => Buffer.from(JSON.stringify({ version: 1, origin, capturedAt: '2026-09-15T00:00:00.000Z', storageKey: 'ovth-pipeline', raw }));
test('browser exporter preserves exact raw storage and creates a locally downloadable packet', async () => {
  for (const raw of [null, '[]', JSON.stringify([contact])]) {
    let blob, clicked = false;
    const anchor = { click() { clicked = true; }, remove() {} };
    vm.runInNewContext(fs.readFileSync(new URL('./browser-export.js', import.meta.url), 'utf8'), {
      window: { localStorage: { getItem(key) { assert.equal(key, 'ovth-pipeline'); return raw; } } },
      location: { origin }, Blob, Date,
      URL: { createObjectURL(value) { blob = value; return 'blob:fixture'; }, revokeObjectURL() {} },
      document: { createElement(tag) { assert.equal(tag, 'a'); return anchor; }, body: { appendChild() {} } },
      setTimeout(callback) { callback(); },
    });
    assert.equal(clicked, true);
    assert.equal(anchor.download, 'PARADIZE-tech-help-browser-export.json');
    const bytes = Buffer.from(await blob.text());
    assert.equal(JSON.parse(bytes).raw, raw);
    assert.equal(inspectPipelineExport(bytes, origin).records.length, raw?.includes(contact.id) ? 1 : 0);
  }
});
test('missing storage differs from an explicitly empty collection', () => {
  assert.equal(inspectPipelineExport(packet(null), origin).state, 'key-absent');
  assert.equal(inspectPipelineExport(packet('[]'), origin).state, 'explicit-empty-array');
  assert.throws(() => inspectPipelineExport(packet(''), origin));
});
test('all historical consent combinations and do-not-contact preserve evidence without granting dispatch', () => {
  for (const followUp of [true, false]) for (const promotions of [true, false]) for (const status of ['New inquiry', 'Do not contact', 'Follow-up allowed']) {
    const original = { ...contact, followUp, promotions, status, extraHistoricalField: 'retain me' };
    const bytes = packet(JSON.stringify([original]));
    const result = inspectPipelineExport(bytes, origin);
    const row = result.records[0];
    assert.deepEqual(row.original, original);
    assert.equal(row.dispatchAllowed, false);
    assert.equal(row.doNotContact, status === 'Do not contact');
    assert.equal(result.activationGranted, false);
    assert.deepEqual(inspectPipelineExport(bytes, origin), result);
  }
});
test('foreign origin, duplicate identifiers and malformed consent block admission', () => {
  assert.throws(() => inspectPipelineExport(packet('[]'), 'https://other.example.test'));
  assert.throws(() => inspectPipelineExport(packet(JSON.stringify([contact, contact])), origin));
  assert.throws(() => inspectPipelineExport(packet(JSON.stringify([{ ...contact, promotions: 'false' }])), origin));
  assert.throws(() => inspectPipelineExport(packet(JSON.stringify([{ ...contact, status: 'invented' }])), origin));
});
