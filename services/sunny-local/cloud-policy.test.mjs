import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSunnyServer } from './server.mjs';

const token = 'c'.repeat(64);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const tags = { models: [{ name: 'qwen2.5:3b', size: 1929912432 }] };
async function fixture(t, fetcher) {
  const server = createSunnyServer({ token, fetcher, inferenceTimeoutMs: 1000 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const chat = url => fetch(url + '/chat', { method: 'POST', headers, body: JSON.stringify({ message: 'Synthetic private prompt' }) });

test('cloud enabled or unknown blocks inference before prompts leave Sunny', async t => {
  for (const state of [{ cloud: { disabled: false } }, {}, { cloud: { disabled: 'true' } }, null]) {
    const calls = [];
    const url = await fixture(t, async (target, options) => {
      calls.push({ target, body: options.body });
      if (target.endsWith('/api/status')) return Response.json(state);
      if (target.endsWith('/api/tags')) return Response.json(tags);
      return Response.json({ done: true, message: { content: 'Should not run' } });
    });
    const response = await chat(url);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'local-only-unconfirmed');
    assert.deepEqual(calls, [{ target: 'http://127.0.0.1:11434/api/status', body: undefined }]);
  }
});

test('cloud policy is checked again for each request, not cached from health', async t => {
  let disabled = true;
  const calls = [];
  const url = await fixture(t, async (target, options) => {
    calls.push(target);
    assert.equal(options.redirect, 'error');
    if (target.endsWith('/api/status')) return Response.json({ cloud: { disabled } });
    if (target.endsWith('/api/tags')) return Response.json(tags);
    return Response.json({ done: true, message: { content: 'Synthetic local answer' } });
  });
  assert.equal((await (await fetch(url + '/health', { headers })).json()).status, 'ready');
  assert.equal((await chat(url)).status, 200);
  disabled = false;
  const response = await chat(url);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'local-only-unconfirmed');
  assert.equal(calls.filter(x => x.endsWith('/api/chat')).length, 1);
  const health = await (await fetch(url + '/health', { headers })).json();
  assert.equal(health.status, 'local-only-unconfirmed');
  assert.deepEqual(health.capabilities, []);
});

test('unsupported cloud-status endpoint never falls back to inference', async t => {
  const calls = [];
  const url = await fixture(t, async target => { calls.push(target); return Response.json({}, { status: 404 }); });
  assert.equal((await chat(url)).status, 503);
  assert.deepEqual(calls, ['http://127.0.0.1:11434/api/status']);
});

test('malformed, oversized and failed policy responses cannot authorize inference', async t => {
  for (const response of [() => new Response('{broken'), () => Response.json({ cloud: { disabled: true }, padding: 'x'.repeat(4096) }), () => { throw new Error('offline'); }]) {
    const calls = [];
    const url = await fixture(t, async target => { calls.push(target); return response(); });
    const result = await chat(url);
    assert.equal(result.status, 503);
    assert.equal((await result.json()).code, 'local-only-unconfirmed');
    assert.deepEqual(calls, ['http://127.0.0.1:11434/api/status']);
  }
});

test('STOP aborts a pending cloud-policy check without transmitting a prompt', async t => {
  let started;
  const pendingPolicy = new Promise(resolve => { started = resolve; });
  const calls = [];
  const url = await fixture(t, async (target, options) => {
    calls.push(target); started();
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  const request = chat(url);
  await pendingPolicy;
  assert.equal((await fetch(url + '/stop', { method: 'POST', headers })).status, 200);
  assert.equal((await (await request).json()).code, 'cancelled');
  assert.deepEqual(calls, ['http://127.0.0.1:11434/api/status']);
});

test('unauthenticated requests cannot even query cloud policy', async t => {
  const url = await fixture(t, async () => assert.fail('Unauthorized provider call'));
  assert.equal((await fetch(url + '/health')).status, 401);
  assert.equal((await fetch(url + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
});
