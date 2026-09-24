import test from 'node:test';
import assert from 'node:assert/strict';
import { createSunnyServer } from './server.mjs';

async function fixture(t, reader) {
  const token = 'a'.repeat(64); let providerCalls = 0; let reads = 0;
  const server = createSunnyServer({ token, reviewReader: reader ? async () => { reads++; return reader(); } : undefined, fetcher: async () => { providerCalls++; throw new Error('No inference'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(providerCalls, 0); });
  return { request: (options = {}) => fetch(`http://127.0.0.1:${server.address().port}/actions/review`, { headers: { Authorization: `Bearer ${token}` }, ...options }), reads: () => reads };
}

test('owner can read case outcomes without model or external action execution', async t => {
  const f = await fixture(t, () => ({ revision: 3, cases: [{ id: 'fixture', state: 'submitted', title: 'Awaiting provider confirmation' }], sources: [], paused: false, executionEnabled: false, deliveryVerified: false }));
  const response = await f.request(); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json(); assert.equal(result.status, 'complete'); assert.equal(result.revision, 3);
  assert.equal(result.cases[0].state, 'submitted'); assert.equal(result.executionEnabled, false); assert.equal(result.deliveryVerified, false);
});
test('missing or failed store reports unavailable rather than zero pending work', async t => {
  for (const reader of [undefined, () => { throw new Error('Private details must not be leaked'); }]) {
    const f = await fixture(t, reader); const response = await f.request(); const body = await response.json();
    assert.equal(response.status, 503); assert.equal(body.code, 'account-review-unavailable');
    assert.equal(Object.hasOwn(body, 'cases'), false); assert.equal(JSON.stringify(body).includes('Private details'), false);
  }
});
test('unauthenticated and browser-origin requests never read private state', async t => {
  const f = await fixture(t, () => ({ cases: [] }));
  assert.equal((await f.request({ headers: {} })).status, 401);
  assert.equal((await f.request({ headers: { Authorization: `Bearer ${'a'.repeat(64)}`, Origin: 'https://example.test' } })).status, 403);
  assert.equal(f.reads(), 0);
});
test('review route provides no HTTP write or approval capability', async t => {
  const f = await fixture(t, () => ({ cases: [] }));
  assert.equal((await f.request({ method: 'POST', body: '{"approve":true}' })).status, 404);
  assert.equal(f.reads(), 0);
});
