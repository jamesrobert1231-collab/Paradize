import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { applyOperations } from './model.mjs';
import { readReview } from './reader.mjs';
import { createSunnyServer } from '../sunny-local/server.mjs';

test('real encrypted register reaches the owner-only Sunny route and survives readback', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-review-integration-'));
  const directory = path.join(root, 'private');
  const token = 'b'.repeat(64); let server; let store;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    store?.close();
    assert.equal(path.dirname(path.resolve(root)).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(root).startsWith('paradize-review-integration-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  store = openStore({ directory }); const now = new Date().toISOString();
  store.update(0, data => applyOperations(data, [
    { type: 'source', key: 'fixture', identity: 'fictional@example.test', label: 'Fixture', status: 'readable', checkedAt: now, coverage: 'Synthetic integration fixture', complete: true, checkpoint: now },
    { type: 'observe', evidence: 'Synthetic owner fixture', case: { id: 'fictional-reply', sourceKey: 'fixture', title: 'Synthetic private case', summary: 'Prepare a response without sending.', priority: 'normal', references: [{ id: 'fictional-thread' }] } },
  ], now));
  store.close(); store = null;
  server = createSunnyServer({ token, reviewReader: () => readReview({ directory }), fetcher: async () => { throw new Error('No provider should be contacted'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/actions/review`, { headers: { Authorization: `Bearer ${token}` } });
  const review = await response.json();
  assert.equal(response.status, 200); assert.equal(review.revision, 1); assert.equal(review.cases[0].title, 'Synthetic private case');
  assert.equal(review.executionEnabled, false); assert.equal(review.deliveryVerified, false);
  store = openStore({ directory, existingOnly: true }); assert.equal(store.read().revision, 1);
});
