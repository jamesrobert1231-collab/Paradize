import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createSunnyAdapter } from '../../services/gateway/sunny-adapter.mjs';

const token = 'a'.repeat(64), baseUrl = 'http://127.0.0.1:42001';
const protocol = { service: 'paradize-sunny-local', protocolVersion: 2, localOnlyPolicyRequired: true, paidRequestsEnabled: false, provider: 'ollama' };
const ready = { ...protocol, status: 'ready', model: 'qwen2.5:3b', capabilities: ['local-chat'], activeRequest: false, toolsEnabled: false, memoryConnected: false };
const complete = { ...protocol, status: 'complete', message: 'Hello from Sunny.', model: 'qwen2.5:3b', toolsEnabled: false, memoryConnected: false };
const options = () => ({ signal: new AbortController().signal });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const make = fetcher => createSunnyAdapter({ baseUrl, token, fetcher });

test('configuration accepts only a literal loopback origin and lower-case native credential', () => {
  for (const url of ['http://localhost:42001', 'http://127.1:42001', 'http://2130706433:42001', 'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:042001', 'http://127.0.0.1:80/', 'http://127.0.0.1:80/chat', 'http://127.0.0.1:80?x', 'http://127.0.0.1:80#x', 'http://user@127.0.0.1:80', 'https://127.0.0.1:80', 'http://[::1]:80', ' http://127.0.0.1:80', 'http://127.0.0.1:80\n']) {
    assert.throws(() => createSunnyAdapter({ baseUrl: url, token }), /trusted literal loopback/);
  }
  for (const credential of ['', token.toUpperCase(), `${token}\n`, token.slice(1), 123, null]) assert.throws(() => createSunnyAdapter({ baseUrl, token: credential }));
  assert.throws(() => createSunnyAdapter({ baseUrl, token, fetcher: null }));
  assert.doesNotThrow(() => createSunnyAdapter({ baseUrl: 'http://127.0.0.1:65535', token }));
});

test('adapter exposes only health and chat, with fixed paths and private native headers', async () => {
  const calls = [];
  const adapter = make(async (url, request) => { calls.push({ url, request }); return json(url.endsWith('/health') ? ready : complete); });
  assert.deepEqual(Object.keys(adapter).sort(), ['chat', 'health']);
  assert.equal(Object.isFrozen(adapter), true);
  const health = await adapter.health(options());
  const chat = await adapter.chat({ message: 'hello', history: [{ role: 'assistant', content: 'Hi.' }] }, options());
  assert.equal(health.body.status, 'ready'); assert.equal(chat.body.message, complete.message);
  assert.deepEqual(calls.map(call => call.url), [`${baseUrl}/health`, `${baseUrl}/chat`]);
  assert.deepEqual(calls.map(call => call.request.method), ['GET', 'POST']);
  for (const { request } of calls) {
    assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit'); assert.equal(request.cache, 'no-store');
    assert.equal(request.headers.Authorization, `Bearer ${token}`); assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.headers.Origin, undefined); assert.equal(request.headers.Cookie, undefined); assert.equal(request.headers['X-Forwarded-For'], undefined);
  }
  assert.equal(calls[0].request.body, undefined);
  assert.deepEqual(JSON.parse(calls[1].request.body), { message: 'hello', history: [{ role: 'assistant', content: 'Hi.' }] });
  assert.equal(JSON.stringify([health, chat, adapter]).includes(token), false);
});

test('public replies strip source records, paths, diagnostics, and upstream health prose', async () => {
  const privateFields = { sources: [{ source: 'C:\\private\\finance.txt' }], filePath: 'C:\\private', code: 'secret-code', error: token, qualification: 'private', message: 'C:\\private\\owner-token.txt' };
  const health = await make(async () => json({ ...ready, ...privateFields })).health(options());
  assert.deepEqual(health, { statusCode: 200, body: { status: 'ready', message: 'Sunny is ready for local conversation.', capabilities: ['local-chat'], toolsEnabled: false, memoryConnected: false, model: ready.model, activeRequest: false } });
  const chat = await make(async () => json({ ...complete, ...privateFields, message: 'Public answer' })).chat({ message: 'hello' }, options());
  assert.deepEqual(chat, { statusCode: 200, body: { status: 'complete', message: 'Public answer', model: ready.model, toolsEnabled: false, memoryConnected: false } });
});

test('malformed or broadened protocol and capability declarations are rejected', async () => {
  for (const patch of [
    { service: 'other' }, { protocolVersion: '2' }, { protocolVersion: 1 }, { localOnlyPolicyRequired: false }, { paidRequestsEnabled: true }, { paidRequestsEnabled: undefined }, { provider: 'cloud' },
    { model: 'remote-model' }, { toolsEnabled: true }, { toolsEnabled: undefined }, { memoryConnected: true }, { activeRequest: 'false' }, { capabilities: ['local-chat', 'mail'] }, { capabilities: ['mail'] }, { capabilities: 'local-chat' }, { status: 'resumed' },
  ]) {
    const result = await make(async () => json({ ...ready, ...patch })).health(options());
    assert.equal(result.statusCode, 502, JSON.stringify(patch));
  }
  for (const patch of [{ status: 'ready' }, { model: null }, { message: '' }, { message: ' ' }, { message: 'x'.repeat(16001) }, { toolsEnabled: undefined }, { memoryConnected: true }]) {
    assert.equal((await make(async () => json({ ...complete, ...patch })).chat({ message: 'hello' }, options())).statusCode, 502, JSON.stringify(patch).slice(0, 80));
  }
});

test('health preserves supported unavailable states without trusting upstream error messages', async () => {
  for (const status of ['model-unavailable', 'ollama-unavailable', 'local-only-unconfirmed', 'stopped']) {
    const result = await make(async () => json({ ...ready, status, model: null, capabilities: [], message: 'private diagnostic' })).health(options());
    assert.equal(result.statusCode, 200); assert.equal(result.body.status, status); assert.equal(result.body.model, null);
    assert.equal(JSON.stringify(result).includes('private diagnostic'), false);
  }
});

test('unknown browser fields, excessive messages/history, and byte-heavy payloads never reach Sunny', async () => {
  let calls = 0; const adapter = make(async () => { calls++; return json(complete); });
  const invalid = [null, [], {}, { message: '' }, { message: ' ' }, { message: 'x'.repeat(2001) },
    { message: 'hi', knowledgeQuery: 'finance' }, { message: 'hi', accounts: ['mail'] }, { message: 'hi', url: '/stop' }, { message: 'hi', headers: { Authorization: 'other' } },
    { message: 'hi', history: null }, { message: 'hi', history: Array.from({ length: 9 }, () => ({ role: 'user', content: 'hi' })) },
    { message: 'hi', history: [{ role: 'system', content: 'privileged' }] }, { message: 'hi', history: [{ role: 'user', content: 'hi', source: 'private' }] },
    { message: 'hi', history: [{ role: 'user', content: 'x'.repeat(2001) }] }, { message: '文'.repeat(2000), history: [{ role: 'assistant', content: '文'.repeat(2000) }] },
  ];
  for (const input of invalid) assert.equal((await adapter.chat(input, options())).statusCode, 400);
  assert.equal(calls, 0);
  assert.equal((await adapter.chat({ message: 'x'.repeat(2000), history: Array.from({ length: 8 }, () => ({ role: 'user', content: 'ok' })) }, options())).statusCode, 200);
  assert.equal(calls, 1);
});

test('request signal is required and pre-cancellation transmits nothing', async () => {
  let calls = 0; const adapter = make(async () => { calls++; return json(ready); });
  for (const supplied of [undefined, null, {}, { signal: {} }, { signal: { aborted: false, addEventListener() {} } }]) assert.equal((await adapter.health(supplied)).statusCode, 400);
  const cancelled = new AbortController(); cancelled.abort(new Error('private-reason'));
  assert.equal((await adapter.chat({ message: 'hello' }, { signal: cancelled.signal })).statusCode, 499);
  assert.equal(calls, 0);
});

test('abort cancels only its own request and never dispatches a global stop', async () => {
  const calls = [];
  const adapter = make(async (url, request) => {
    calls.push({ url, signal: request.signal });
    if (url.endsWith('/health')) return json(ready);
    return new Promise(() => {}); // Ignore the signal to test the adapter's own deadline race.
  });
  const first = new AbortController(), second = new AbortController();
  const request = adapter.chat({ message: 'hello' }, { signal: first.signal });
  await Promise.resolve(); first.abort(new Error(`private ${token}`));
  const cancelled = await request;
  assert.equal(cancelled.statusCode, 499); assert.equal(JSON.stringify(cancelled).includes(token), false);
  assert.equal(calls[0].signal.aborted, true); assert.equal(second.signal.aborted, false);
  assert.equal((await adapter.health({ signal: second.signal })).statusCode, 200);
  assert.deepEqual(calls.map(value => value.url), [`${baseUrl}/chat`, `${baseUrl}/health`]);
});

test('health and chat enforce their own whole-request deadlines', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [method, milliseconds] of [['health', 8000], ['chat', 95000]]) {
    let signal;
    const adapter = make(async (_, request) => { signal = request.signal; return new Promise(() => {}); });
    const promise = method === 'health' ? adapter.health(options()) : adapter.chat({ message: 'hello' }, options());
    t.mock.timers.tick(milliseconds);
    const result = await promise;
    assert.equal(result.statusCode, 504); assert.equal(signal.aborted, true);
  }
});

test('response body reading is cancelled and bounded even when the body stalls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false, responseStarted;
  const started = new Promise(resolve => { responseStarted = resolve; });
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } });
  const request = make(async () => { responseStarted(); return new Response(stream, { headers: { 'content-type': 'application/json' } }); }).health(options());
  await started; await Promise.resolve();
  t.mock.timers.tick(8000);
  assert.equal((await request).statusCode, 504); assert.equal(cancelled, true);
});

test('oversized, invalid UTF-8, malformed JSON, redirects, and unexpected response metadata are rejected', async () => {
  const cases = [
    () => new Response('x'.repeat(128 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    () => json(ready, 200, { 'content-length': String(128 * 1024 + 1) }),
    () => json(ready, 200, { 'content-length': '1' }),
    () => json(ready, 200, { 'content-length': 'bad' }),
    () => json(ready, 200, { 'content-encoding': 'gzip' }),
    () => new Response(Uint8Array.from([0xff]), { headers: { 'content-type': 'application/json' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response('null', { headers: { 'content-type': 'application/json' } }),
    () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
    () => json(ready, 200, { 'content-type': 'text/html' }),
    () => json(ready, 302, { location: 'https://example.invalid' }),
    () => { const response = json(ready); Object.defineProperty(response, 'redirected', { value: true }); return response; },
    () => { const response = json(ready); Object.defineProperty(response, 'url', { value: 'http://127.0.0.1:42001/stop' }); return response; },
  ];
  for (const fixture of cases) { let calls = 0; const result = await make(async () => { calls++; return fixture(); }).health(options()); assert.equal(result.statusCode, 502); assert.equal(calls, 1); }
});

test('malformed metadata cancels the upstream body without waiting for it', async () => {
  let cancelled = false, signal;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const result = await make(async (_, request) => { signal = request.signal; return new Response(body, { headers: { 'content-type': 'text/html' } }); }).health(options());
  assert.equal(result.statusCode, 502); assert.equal(cancelled, true); assert.equal(signal.aborted, true);
});

test('upstream errors use fixed public messages and never retry or change providers', async () => {
  for (const [status, expectedStatus] of [[400, 'unavailable'], [401, 'denied'], [403, 'denied'], [409, 'busy'], [413, 'unavailable'], [415, 'unavailable'], [423, 'stopped'], [500, 'unavailable'], [503, 'unavailable'], [504, 'unavailable']]) {
    let calls = 0;
    const result = await make(async () => { calls++; return json({ ...protocol, status: expectedStatus, message: `C:\\secret\\${token}`, code: token }, status); }).chat({ message: 'hello' }, options());
    assert.equal(result.statusCode, [401, 403].includes(status) ? 503 : status); assert.equal(result.body.status, expectedStatus);
    assert.equal(JSON.stringify(result).includes(token), false); assert.equal(calls, 1);
  }
  assert.equal((await make(async () => json({ ...protocol, status: 'complete' }, 503)).health(options())).statusCode, 502);
  let calls = 0;
  const result = await make(async () => { calls++; throw new Error(`ECONNREFUSED C:\\secret ${token}`); }).health(options());
  assert.equal(result.statusCode, 503); assert.equal(JSON.stringify(result).includes(token), false); assert.equal(calls, 1);
});

test('native fetch uses only the explicit local backend and sends canonical request fields', async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(req.url === '/health' ? ready : complete));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const adapter = createSunnyAdapter({ baseUrl: `http://127.0.0.1:${server.address().port}`, token });
  assert.equal((await adapter.health(options())).statusCode, 200);
  assert.equal((await adapter.chat({ message: 'hello' }, options())).statusCode, 200);
  assert.deepEqual(requests.map(value => [value.method, value.url]), [['GET', '/health'], ['POST', '/chat']]);
  assert.equal(requests[0].headers.authorization, `Bearer ${token}`);
  assert.equal(requests[0].headers.origin, undefined); assert.equal(requests[0].headers.cookie, undefined);
  assert.deepEqual(JSON.parse(requests[1].body), { message: 'hello', history: [] });
});
