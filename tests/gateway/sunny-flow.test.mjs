import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createIdentityAuthority } from '../../packages/auth/authority.mjs';
import { createGatewayHandler } from '../../services/gateway/server.mjs';
import { createSunnyAdapter } from '../../services/gateway/sunny-adapter.mjs';
import { createSunnyServer } from '../../services/sunny-local/server.mjs';
import { createTestTls } from './tls-fixture.mjs';

const tls = createTestTls();
const modelName = 'qwen2.5:3b';
const answer = 'Sunny answered through the synthetic local model.';
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Synthetic integration event did not complete within four seconds.')), 4000);
    })]);
  } finally { clearTimeout(timer); }
}

// The HTTPS gateway, identity authority, native Sunny HTTP server and adapter are
// real. Only identity persistence and the final Ollama inference boundary are
// synthetic. No live tokens, model service, accounts, or filesystem stores exist.
async function fixture(t) {
  let state = null, queue = Promise.resolve(), handler, gateway;
  const store = {
    async read() { return { state: structuredClone(state), now: Date.now() }; },
    transact(update) {
      const operation = queue.then(() => {
        const next = update(structuredClone(state), Date.now());
        state = structuredClone(next.state); return next.value;
      });
      queue = operation.catch(() => {}); return operation;
    },
  };
  const authority = createIdentityAuthority({ store });
  await authority.local.initialize({ ownerId: randomUUID(), installationId: randomUUID() });
  const nativeToken = randomBytes(32).toString('hex');
  const started = deferred(), aborted = deferred();
  const model = { cloudDisabled: true, hold: false, calls: [], started: started.promise, aborted: aborted.promise };
  const fetcher = async (url, options = {}) => {
    const call = { url, options }; model.calls.push(call);
    assert.ok(['http://127.0.0.1:11434/api/status', 'http://127.0.0.1:11434/api/tags',
      'http://127.0.0.1:11434/api/chat'].includes(url), 'No fallback or external provider is permitted.');
    assert.equal(options.redirect, 'error');
    options.signal.throwIfAborted();
    if (url.endsWith('/api/status')) return Response.json({ cloud: { disabled: model.cloudDisabled } });
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: modelName, size: 1_000_000 }] });
    if (!model.hold) return Response.json({ done: true, message: { content: answer } });
    started.resolve(call);
    return new Promise((_, reject) => {
      const cancel = () => { aborted.resolve(call); reject(options.signal.reason); };
      options.signal.addEventListener('abort', cancel, { once: true });
      if (options.signal.aborted) cancel();
    });
  };
  const native = createSunnyServer({ token: nativeToken, fetcher, inferenceTimeoutMs: 10_000 });
  const nativeRequests = [];
  native.on('request', req => nativeRequests.push({ path: req.url, headers: { ...req.headers } }));
  t.after(async () => {
    handler?.close();
    for (const server of [gateway, native]) {
      if (!server) continue;
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  native.listen(0, '127.0.0.1'); await once(native, 'listening');
  const nativeOrigin = `http://127.0.0.1:${native.address().port}`;
  const sunny = createSunnyAdapter({ baseUrl: nativeOrigin, token: nativeToken });
  gateway = https.createServer({ pfx: tls.pfx, passphrase: tls.passphrase, minVersion: 'TLSv1.2' }, (req, res) => handler(req, res));
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const origin = `https://127.0.0.1:${gateway.address().port}`;
  handler = createGatewayHandler({ origin, identity: authority.remote, sunny, leaseIntervalMs: 10 });

  function beginRequest(route, { method = 'GET', body, cookies, csrf, headers = {} } = {}) {
    const content = body === undefined ? null : JSON.stringify(body);
    let request;
    const promise = new Promise((resolve, reject) => {
      request = https.request(origin + route, { method, ca: tls.ca, agent: false,
        headers: { ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json', 'X-Paradize-Request': 'browser' } : {}),
          ...(cookies ? { Cookie: cookies } : {}), ...(csrf ? { 'X-Paradize-CSRF': csrf } : {}),
          ...(content ? { 'Content-Length': Buffer.byteLength(content) } : {}), ...headers } }, response => {
        let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
        response.once('error', reject);
        response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, text, json: () => JSON.parse(text) }));
      });
      request.once('error', reject);
      request.setTimeout(4000, () => request.destroy(new Error('Synthetic browser request timed out.')));
      request.end(content);
    });
    return { promise, disconnect: () => request.destroy(new Error('Synthetic browser disconnected.')) };
  }
  const request = (route, options) => beginRequest(route, options).promise;
  async function pair(label = 'Synthetic browser') {
    const issued = await authority.local.createPairing({ sessionDays: 1 });
    const response = await request('/api/device-access/exchange', { method: 'POST', body: { code: issued.code, label } });
    assert.equal(response.status, 200);
    const cookies = response.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
    const csrf = /__Host-paradize-csrf=([a-f0-9]{64})/.exec(cookies)[1];
    return { cookies, csrf, deviceId: response.json().deviceId };
  }
  return { authority, model, pair, request, beginRequest, nativeRequests, nativeToken, nativeOrigin, origin };
}

test('paired HTTPS browser reaches actual Sunny health and local-only conversation through the adapter', { timeout: 15_000 }, async t => {
  const f = await fixture(t), device = await f.pair();
  const health = await f.request('/api/sunny/health', device);
  assert.equal(health.status, 200); assert.equal(health.json().status, 'ready');
  assert.equal(health.json().model, modelName); assert.equal(health.json().toolsEnabled, false);
  const history = [{ role: 'user', content: 'Earlier synthetic question.' }, { role: 'assistant', content: 'Earlier synthetic answer.' }];
  const chat = await f.request('/api/sunny/chat', { ...device, method: 'POST', body: { message: 'Hello Sunny', history } });
  assert.equal(chat.status, 200);
  assert.deepEqual(chat.json(), { status: 'complete', message: answer, model: modelName, toolsEnabled: false, memoryConnected: false });
  assert.ok(!chat.text.includes(f.nativeToken));
  assert.deepEqual(f.model.calls.map(call => new URL(call.url).pathname), ['/api/status', '/api/tags', '/api/status', '/api/tags', '/api/chat']);
  const inference = JSON.parse(f.model.calls.at(-1).options.body);
  assert.equal(inference.model, modelName); assert.equal(inference.stream, false);
  assert.deepEqual(inference.messages.slice(1), [...history, { role: 'user', content: 'Hello Sunny' }]);
  assert.deepEqual(f.nativeRequests.map(call => call.path), ['/health', '/chat']);
  for (const call of f.nativeRequests) {
    assert.equal(call.headers.authorization, `Bearer ${f.nativeToken}`);
    assert.equal(call.headers.cookie, undefined); assert.equal(call.headers.origin, undefined);
    assert.equal(call.headers['x-paradize-csrf'], undefined);
  }
});

test('an unqualified local-only policy blocks inference through the complete browser-to-Sunny path', { timeout: 15_000 }, async t => {
  const f = await fixture(t), device = await f.pair(); f.model.cloudDisabled = false;
  const health = await f.request('/api/sunny/health', device);
  assert.equal(health.status, 200); assert.equal(health.json().status, 'local-only-unconfirmed');
  const chat = await f.request('/api/sunny/chat', { ...device, method: 'POST', body: { message: 'Do not send this to an unqualified model.', history: [] } });
  assert.equal(chat.status, 503); assert.equal(chat.json().status, 'unavailable');
  assert.deepEqual(f.model.calls.map(call => new URL(call.url).pathname), ['/api/status', '/api/status']);
});

test('a paired browser cannot gain native bearer or global STOP authority', { timeout: 15_000 }, async t => {
  const f = await fixture(t), device = await f.pair();
  for (const route of ['/stop', '/control/stop', '/api/sunny/stop', '/api/sunny/control/stop', '/chat']) {
    const response = await f.request(route, { ...device, method: 'POST', body: {} });
    assert.equal(response.status, 404);
  }
  const bearer = await f.request('/api/sunny/health', { ...device, headers: { Authorization: `Bearer ${f.nativeToken}` } });
  assert.equal(bearer.status, 403); assert.equal(f.nativeRequests.length, 0);
  const direct = await fetch(f.nativeOrigin + '/control/stop', {
    method: 'POST', redirect: 'error', headers: { Origin: f.origin, Authorization: `Bearer ${f.nativeToken}` }, signal: AbortSignal.timeout(4000),
  });
  assert.equal(direct.status, 403); await direct.arrayBuffer();
  const health = await f.request('/api/sunny/health', device);
  assert.equal(health.json().status, 'ready');
  assert.deepEqual(f.model.calls.map(call => new URL(call.url).pathname), ['/api/status', '/api/tags']);
});

test('device revocation aborts actual Sunny inference and another paired device remains usable', { timeout: 15_000 }, async t => {
  const f = await fixture(t), a = await f.pair('A'), b = await f.pair('B'); f.model.hold = true;
  const pending = f.request('/api/sunny/chat', { ...a, method: 'POST', body: { message: 'Wait for revocation.', history: [] } });
  const started = await deadline(f.model.started);
  assert.equal(started.options.signal.aborted, false);
  await f.authority.local.revokeDevice(a.deviceId);
  const response = await deadline(pending);
  assert.equal(response.status, 401); assert.ok(!response.text.includes(answer));
  const aborted = await deadline(f.model.aborted); assert.equal(aborted.options.signal.aborted, true);
  assert.equal((await f.request('/api/session', a)).status, 401);
  f.model.hold = false;
  const next = await f.request('/api/sunny/chat', { ...b, method: 'POST', body: { message: 'Still available.', history: [] } });
  assert.equal(next.status, 200); assert.equal(next.json().message, answer);
  assert.ok(f.nativeRequests.every(call => ['/health', '/chat'].includes(call.path)));
});

test('browser connection loss aborts actual Sunny inference without global STOP or device revocation', { timeout: 15_000 }, async t => {
  const f = await fixture(t), device = await f.pair(); f.model.hold = true;
  const pending = f.beginRequest('/api/sunny/chat', { ...device, method: 'POST', body: { message: 'Wait for disconnect.', history: [] } });
  const clientResult = pending.promise.then(response => ({ response }), error => ({ error }));
  await deadline(f.model.started); pending.disconnect();
  assert.match((await deadline(clientResult)).error.message, /Synthetic browser disconnected/);
  const aborted = await deadline(f.model.aborted); assert.equal(aborted.options.signal.aborted, true);
  assert.equal((await f.request('/api/session', device)).status, 200);
  f.model.hold = false;
  const next = await f.request('/api/sunny/chat', { ...device, method: 'POST', body: { message: 'Connected again.', history: [] } });
  assert.equal(next.status, 200); assert.equal(next.json().message, answer);
  assert.ok(f.nativeRequests.every(call => ['/health', '/chat'].includes(call.path)));
});
