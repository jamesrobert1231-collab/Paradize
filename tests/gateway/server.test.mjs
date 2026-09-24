import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createIdentityAuthority } from '../../packages/auth/authority.mjs';
import { createGatewayHandler } from '../../services/gateway/server.mjs';
import { createTestTls } from './tls-fixture.mjs';

const tls = createTestTls();
// Serialized synthetic storage: these are real TLS/HTTP tests, not PG durability tests.
async function fixture(t, sunnyOverride) {
  let state = null, now = Date.now(), queue = Promise.resolve(), handler;
  const store = { async read() { return { state: structuredClone(state), now }; },
    transact(update) { const p = queue.then(() => { const next = update(structuredClone(state), now); state = structuredClone(next.state); return next.value; }); queue = p.catch(() => {}); return p; } };
  const authority = createIdentityAuthority({ store });
  await authority.local.initialize({ ownerId: randomUUID(), installationId: randomUUID() });
  const calls = [];
  const sunny = sunnyOverride || {
    async health({ signal }) { calls.push('health'); signal.throwIfAborted(); return { statusCode: 200, body: { status: 'ready', model: 'qwen2.5:3b', paidRequestsEnabled: false } }; },
    async chat(data, { signal }) { calls.push(data); signal.throwIfAborted(); return { statusCode: 200, body: { status: 'complete', message: '<script>plain text only</script>' } }; },
  };
  const server = https.createServer({ pfx: tls.pfx, passphrase: tls.passphrase, minVersion: 'TLSv1.2' }, (req, res) => handler(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `https://127.0.0.1:${server.address().port}`;
  handler = createGatewayHandler({ origin, identity: authority.remote, sunny, leaseIntervalMs: 10 });
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = (path, { method = 'GET', body, cookies, csrf, headers = {} } = {}) => new Promise((resolve, reject) => {
    const content = body === undefined ? null : JSON.stringify(body);
    const req = https.request(origin + path, { method, ca: tls.ca, servername: 'localhost', agent: false,
      headers: { ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json', 'X-Paradize-Request': 'browser' } : {}),
        ...(cookies ? { Cookie: cookies } : {}), ...(csrf ? { 'X-Paradize-CSRF': csrf } : {}),
        ...(content ? { 'Content-Length': Buffer.byteLength(content) } : {}), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject); req.setTimeout(4000, () => req.destroy(new Error('Synthetic HTTPS request timeout')));
    req.end(content);
  });
  async function pair(label = 'Test browser') {
    const issued = await authority.local.createPairing({ sessionDays: 1 });
    const response = await request('/api/device-access/exchange', { method: 'POST', body: { code: issued.code, label } });
    assert.equal(response.status, 200, response.text);
    const cookies = response.headers['set-cookie'].map(item => item.split(';')[0]).join('; ');
    const csrf = /__Host-paradize-csrf=([a-f0-9]{64})/.exec(cookies)[1];
    return { issued, response, cookies, csrf, deviceId: response.json().deviceId };
  }
  return { authority, request, pair, calls, origin, advance: ms => { now += ms; }, handler };
}

test('public pairing page grants no access and browser transport has protective headers', async t => {
  const f = await fixture(t), page = await f.request('/pair');
  assert.equal(page.status, 200); assert.match(page.text, /Connect this device/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['cache-control'], 'no-store'); assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal((await f.request('/api/session')).status, 401); assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/api/sunny/health')).status, 401);
});

test('inspect then exchange sets separate protected cookies, excludes secrets, and rejects replay', async t => {
  const f = await fixture(t), issued = await f.authority.local.createPairing({ sessionDays: 7 });
  const inspected = await f.request('/api/device-access/inspect', { method: 'POST', body: { code: issued.code } });
  assert.equal(inspected.status, 200); assert.equal(inspected.json().sessionDays, 7); assert.ok(!inspected.text.includes(issued.code));
  const exchanged = await f.request('/api/device-access/exchange', { method: 'POST', body: { code: issued.code, label: 'Phone' } });
  assert.equal(exchanged.status, 200); assert.equal(exchanged.headers['set-cookie'].length, 2);
  assert.match(exchanged.headers['set-cookie'][0], /HttpOnly/); assert.match(exchanged.headers['set-cookie'][0], /Secure/);
  assert.ok(!exchanged.text.includes(issued.code)); assert.ok(!Object.hasOwn(exchanged.json(), 'token'));
  assert.equal((await f.request('/api/device-access/exchange', { method: 'POST', body: { code: issued.code, label: 'Replay' } })).status, 401);
});

test('authenticated reload restores the same session and CSRF is required for chat', async t => {
  const f = await fixture(t), p = await f.pair();
  const first = await f.request('/api/session', { cookies: p.cookies });
  const second = await f.request('/api/session', { cookies: p.cookies });
  assert.equal(first.status, 200); assert.deepEqual(second.json(), first.json());
  const body = { message: 'Hello', history: [] };
  assert.equal((await f.request('/api/sunny/chat', { method: 'POST', body, cookies: p.cookies })).status, 403);
  const reply = await f.request('/api/sunny/chat', { method: 'POST', body, cookies: p.cookies, csrf: p.csrf });
  assert.equal(reply.status, 200); assert.equal(reply.json().message, '<script>plain text only</script>');
  assert.equal(f.calls.length, 1);
});

test('forwarded, cross-origin, native bearer and unsupported administrative routes grant no access', async t => {
  const f = await fixture(t), p = await f.pair();
  for (const headers of [{ Origin: 'https://elsewhere.invalid' }, { 'X-Forwarded-For': '127.0.0.1' }, { Authorization: `Bearer ${'a'.repeat(64)}` }, { Host: 'elsewhere.invalid' }]) {
    assert.equal((await f.request('/api/session', { cookies: p.cookies, headers })).status, 403);
  }
  for (const path of ['/api/owner/initialize', '/api/device-access/pairings', '/api/device-access/sessions/other/revoke'])
    assert.equal((await f.request(path, { method: 'POST', cookies: p.cookies, csrf: p.csrf, body: {} })).status, 404);
  assert.equal(f.calls.length, 0);
});

test('self-disconnect revokes only its device and clears both cookies', async t => {
  const f = await fixture(t), a = await f.pair('A'), b = await f.pair('B');
  const response = await f.request('/api/device-access/disconnect', { method: 'POST', cookies: a.cookies, csrf: a.csrf, body: {} });
  assert.equal(response.status, 200); assert.ok(response.headers['set-cookie'].every(item => item.includes('Max-Age=0')));
  assert.equal((await f.request('/api/session', { cookies: a.cookies })).status, 401);
  assert.equal((await f.request('/api/session', { cookies: b.cookies })).status, 200);
});

test('revocation cancels pending work and blocks a reply even if backend ignores cancellation', async t => {
  let started, finish;
  const begun = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { async health() {}, chat(_data, { signal }) { started(signal); return new Promise(resolve => { finish = () => resolve({ statusCode: 200, body: { status: 'complete', message: 'MUST NOT ESCAPE' } }); }); } });
  const p = await f.pair(), pending = f.request('/api/sunny/chat', { method: 'POST', cookies: p.cookies, csrf: p.csrf, body: { message: 'Wait', history: [] } });
  const signal = await begun;
  await f.authority.local.revokeDevice(p.deviceId);
  if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  finish(); const response = await pending;
  assert.equal(response.status, 401); assert.ok(!response.text.includes('MUST NOT ESCAPE'));
});

test('one device cannot cancel another reply and request completion rechecks identity', async t => {
  let started, finish, workSignal;
  const begun = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { async health() {}, chat(_data, { signal }) { workSignal = signal; started(); return new Promise(resolve => { finish = () => resolve({ statusCode: 200, body: { status: 'complete', message: 'Done' } }); }); } });
  const a = await f.pair('A'), b = await f.pair('B');
  const pending = f.request('/api/sunny/chat', { method: 'POST', cookies: a.cookies, csrf: a.csrf, body: { message: 'Work', history: [] } }); await begun;
  const cancelledOther = await f.request('/api/sunny/cancel', { method: 'POST', cookies: b.cookies, csrf: b.csrf, body: {} });
  assert.equal(cancelledOther.json().cancelled, false); assert.equal(workSignal.aborted, false);
  const own = await f.request('/api/sunny/cancel', { method: 'POST', cookies: a.cookies, csrf: a.csrf, body: {} });
  assert.equal(own.json().cancelled, true); assert.equal(workSignal.aborted, true);
  finish(); assert.equal((await pending).status, 409);
});

test('pairing attempts, request size and unsupported knowledge fields are bounded', async t => {
  const f = await fixture(t), p = await f.pair();
  for (const body of [{ message: 'x'.repeat(9000), history: [] }, { message: 'Hi', history: [], knowledgeQuery: 'private' }]) {
    const result = await f.request('/api/sunny/chat', { method: 'POST', cookies: p.cookies, csrf: p.csrf, body });
    assert.ok([400, 413].includes(result.status));
  }
  for (let i = 0; i < 9; i++) assert.equal((await f.request('/api/device-access/inspect', { method: 'POST', body: { code: 'f'.repeat(64) } })).status, 401);
  assert.equal((await f.request('/api/device-access/inspect', { method: 'POST', body: { code: 'f'.repeat(64) } })).status, 429);
  assert.equal(f.calls.length, 0);
});

test('CSRF is bound to the issued session, not just a matching header and cookie', async t => {
  const f = await fixture(t), a = await f.pair('A'), b = await f.pair('B');
  const swapped = a.cookies.replace(a.csrf, b.csrf);
  const response = await f.request('/api/sunny/chat', { method: 'POST', cookies: swapped, csrf: b.csrf,
    body: { message: 'No grant', history: [] } });
  assert.equal(response.status, 403); assert.equal(f.calls.length, 0);
});

test('a response rechecks persisted revocation without waiting for the polling interval', async t => {
  let authority, deviceId;
  const f = await fixture(t, { async health() {}, async chat() {
    await authority.local.revokeDevice(deviceId);
    return { statusCode: 200, body: { status: 'complete', message: 'PRIVATE-REPLY' } };
  } });
  authority = f.authority; const p = await f.pair(); deviceId = p.deviceId;
  const response = await f.request('/api/sunny/chat', { method: 'POST', cookies: p.cookies, csrf: p.csrf,
    body: { message: 'Revoke before reply', history: [] } });
  assert.equal(response.status, 401); assert.ok(!response.text.includes('PRIVATE-REPLY'));
});

test('expiry blocks authenticated reload and inference; the full authority is rejected', async t => {
  const f = await fixture(t), p = await f.pair(); f.advance(86400000);
  assert.equal((await f.request('/api/session', { cookies: p.cookies })).status, 401);
  assert.equal((await f.request('/api/sunny/chat', { method: 'POST', cookies: p.cookies, csrf: p.csrf,
    body: { message: 'Expired', history: [] } })).status, 401);
  assert.equal(f.calls.length, 0);
  assert.throws(() => createGatewayHandler({ origin: f.origin, identity: f.authority,
    sunny: { health() {}, chat() {} } }), /Remote identity/);
});
