import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createIdentityAuthority } from '../../packages/auth/authority.mjs';
import { createSunnyServer } from './server.mjs';
import { importDocument } from './knowledge.mjs';

const tags = { models: [{ name: 'qwen2.5:3b', size: 10 }] };
const headers = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function within(promise, ms = 1500) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Request did not settle promptly')), ms); })]); }
  finally { clearTimeout(timer); }
}

// Deliberately in-memory: these are real authority/HTTP integration checks,
// not PostgreSQL durability, driver, launcher or device qualification.
async function authorityFixture() {
  let state = null, now = Date.now(), queue = Promise.resolve(), unavailable = false, blocked = false;
  const store = {
    async read() { if (unavailable) throw new Error('private database detail'); if (blocked) return new Promise(() => {}); return { state: structuredClone(state), now }; },
    transact(update) {
      const operation = queue.then(() => { const result = update(structuredClone(state), now); state = structuredClone(result.state); return result.value; });
      queue = operation.catch(() => {}); return operation;
    },
  };
  const authority = createIdentityAuthority({ store });
  await authority.local.initialize({ ownerId: randomUUID(), installationId: randomUUID() });
  const native = await authority.local.createNativeSession({ deviceId: randomUUID(), label: 'Native test device' });
  return { authority, native, unavailable: value => { unavailable = value; }, blockReads: () => { blocked = true; }, advance: value => { now += value; } };
}

async function fixture(t, options = {}) {
  const f = await authorityFixture();
  const calls = [];
  const fetcher = async (url, init) => {
    assert.ok(['http://127.0.0.1:11434/api/status', 'http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/api/chat'].includes(url), 'Only the fixed local provider is allowed');
    calls.push({ url, init });
    if (options.fetcher) return options.fetcher(url, init, f);
    return Response.json(url.endsWith('/api/status') ? { cloud: { disabled: true } } : url.endsWith('/api/tags') ? tags : { done: true, message: { content: 'Local test reply.' } });
  };
  const server = createSunnyServer({ identity: options.identity?.(f) ?? f.authority.remote, fetcher, leaseIntervalMs: 10, inferenceTimeoutMs: 2000,
    ...options.server });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.sunnyClose?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (route, token = f.native.token, body) => fetch(url + route, {
    method: body === undefined ? 'GET' : 'POST', headers: headers(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...f, server, url, request, calls };
}

test('persistent native sessions reach the actual HTTP bridge and browser sessions cannot cross the native boundary', async t => {
  const f = await fixture(t);
  let response = await f.request('/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).protocolVersion, 2);
  const invitation = await f.authority.local.createPairing({ sessionDays: 1 });
  const browser = await f.authority.remote.exchangePairing({ code: invitation.code, label: 'Browser test device' });
  const count = f.calls.length;
  for (const token of [browser.token, 'f'.repeat(64)]) {
    response = await f.request('/health', token);
    assert.equal(response.status, 401);
  }
  assert.equal(f.calls.length, count, 'Denied requests never reach inference');
  response = await f.request('/chat', f.native.token, { message: 'Hello' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.message, 'Local test reply.');
  assert.equal(body.paidRequestsEnabled, false);
});

test('identity selection rejects malformed, privileged and mixed configuration without legacy fallback', async () => {
  const f = await authorityFixture();
  for (const identity of [undefined, null, {}, f.authority, { ...f.authority.remote, local: f.authority.local }]) {
    assert.throws(() => createSunnyServer({ identity, token: 'a'.repeat(64) }), /identity/i);
    assert.throws(() => createSunnyServer({ identity }), /identity/i);
  }
  assert.throws(() => createSunnyServer({ identity: f.authority.remote, tokenFile: 'never-read-this-file' }), /identity/i);
  assert.throws(() => createSunnyServer({ identity: f.authority.remote, token: 'a'.repeat(64) }), /identity/i);
});

test('identity store failure and native transport denials never reach private readers or providers', async t => {
  let reads = 0;
  const f = await fixture(t, { server: { reviewReader: () => { reads++; return { private: 'retained records' }; } } });
  for (const extra of [{ Origin: 'https://example.invalid' }, { 'X-Forwarded-For': '127.0.0.1' }]) {
    const response = await fetch(f.url + '/health', { headers: { ...headers(f.native.token), ...extra } });
    assert.equal(response.status, 403);
  }
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.get(f.url + '/health', { headers: { ...headers(f.native.token), Host: 'example.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(wrongHost, 403);
  f.unavailable(true);
  const response = await f.request('/actions/review');
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private database detail|retained records/);
  assert.equal(reads, 0); assert.equal(f.calls.length, 0);
});

test('revocation abandons non-cooperative inference and releases admission for an unrelated native session', async t => {
  const entered = deferred(), abandoned = deferred(); let signal;
  const f = await fixture(t, { fetcher: (url, init) => {
    if (url.endsWith('/api/chat') && !signal) { signal = init.signal; entered.resolve(); return abandoned.promise; }
    return Response.json(url.endsWith('/api/status') ? { cloud: { disabled: true } } : url.endsWith('/api/tags') ? tags : { done: true, message: { content: 'Second session reply.' } });
  } });
  const sibling = await f.authority.local.createNativeSession({ deviceId: randomUUID(), label: 'Second native device' });
  let shutdowns = 0; f.server.on('credentials-revoked', () => { shutdowns++; });
  const pending = f.request('/chat', f.native.token, { message: 'First request' });
  await within(entered.promise);
  await f.authority.local.revokeDevice(f.native.deviceId);
  const denied = await within(pending);
  assert.equal(denied.status, 401); assert.equal(signal.aborted, true);
  const next = await within(f.request('/chat', sibling.token, { message: 'Second request' }));
  assert.equal(next.status, 200); assert.equal((await next.json()).message, 'Second session reply.');
  assert.equal(shutdowns, 0, 'One revoked session must not shut down the shared service');
  let cancelled = false;
  abandoned.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true, 'A response arriving after cancellation must be discarded');
});

test('monotonic expiry interrupts a stalled provider body even when identity polling never settles', async t => {
  const entered = deferred(); let returned = false;
  const f = await fixture(t, { fetcher: url => {
    if (url.endsWith('/api/chat')) return { ok: true, body: { [Symbol.asyncIterator]() { return {
      next() { entered.resolve(); return new Promise(() => {}); },
      return() { returned = true; return new Promise(() => {}); },
    }; } } };
    return Response.json(url.endsWith('/api/status') ? { cloud: { disabled: true } } : tags);
  } });
  f.advance(86400000 - 350);
  const pending = f.request('/chat', f.native.token, { message: 'Wait for body' });
  await within(entered.promise); f.blockReads();
  assert.equal((await within(pending)).status, 401);
  assert.equal(returned, true);
});

test('revocation during model discovery is rechecked before private conversation transmission', async t => {
  const f = await fixture(t, { server: { leaseIntervalMs: 10000 }, fetcher: async (url, _init, state) => {
    if (url.endsWith('/api/tags')) await state.authority.local.revokeDevice(state.native.deviceId);
    return Response.json(url.endsWith('/api/status') ? { cloud: { disabled: true } } : tags);
  } });
  const response = await f.request('/chat', f.native.token, { message: 'Must stay private' });
  assert.equal(response.status, 401);
  assert.equal(f.calls.filter(call => call.url.endsWith('/api/chat')).length, 0);
});

test('revocation after review read withholds JSON even before the polling interval', async t => {
  let f;
  f = await fixture(t, { server: { leaseIntervalMs: 10000, reviewReader: async () => {
    await f.authority.local.revokeDevice(f.native.deviceId); return { privateRecord: 'Must not leave the server' };
  } } });
  const response = await f.request('/actions/review');
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /Must not leave|privateRecord/);
  assert.equal(f.calls.length, 0);
});

test('identity failure at JSON delivery cannot expose the already-read private result', async t => {
  let f;
  f = await fixture(t, { server: { leaseIntervalMs: 10000, reviewReader: async () => {
    f.unavailable(true); return { privateRecord: 'Must not leave the server' };
  } } });
  const response = await f.request('/actions/review');
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /Must not leave|privateRecord|private database detail/);
  assert.equal(f.calls.length, 0);
});

test('a lease aborted in authorization continuations cannot pass the final JSON output boundary', async t => {
  for (let depth = 0; depth <= 6; depth++) {
    const interrupted = new AbortController(); let checks = 0, abortedAtOutput = false;
    const f = await fixture(t, { server: { leaseIntervalMs: 10000, reviewReader: () => ({ privateRecord: 'PRIVATE-PAYLOAD' }) }, identity: state => ({
      ...state.authority.remote,
      async watchSession(...args) {
        const lease = await state.authority.remote.watchSession(...args);
        return { ...lease, signal: AbortSignal.any([lease.signal, interrupted.signal]) };
      },
      async authenticate(...args) {
        const session = await state.authority.remote.authenticate(...args);
        if (++checks === 2) {
          const later = remaining => remaining ? queueMicrotask(() => later(remaining - 1)) :
            interrupted.abort(Object.assign(new Error('Session revoked'), { code: 'session-no-longer-authorized' }));
          later(depth);
        }
        return session;
      },
    }) });
    f.server.prependListener('request', (_req, res) => {
      const end = res.end;
      res.end = function (...args) { if (String(args[0]).includes('PRIVATE-PAYLOAD')) abortedAtOutput = interrupted.signal.aborted; return end.apply(this, args); };
    });
    await (await f.request('/actions/review')).text();
    assert.equal(abortedAtOutput, false, `No private output after the lease is aborted at continuation depth ${depth}`);
  }
});

test('authorization continuation cancellation also guards binary writes and durable control mutations', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-native-output-race-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'store');
  const imported = importDocument(directory, { source: path.join(root, 'source.txt'), title: 'Test source', text: 'Test source', originalBytes: Buffer.from('PRIVATE-BINARY') });
  for (const mode of ['binary', 'control']) {
    const interrupted = new AbortController(); let checks = 0;
    const controlFile = path.join(root, mode + '-control.json');
    const f = await fixture(t, { server: { leaseIntervalMs: 10000, knowledgeDirectory: directory, controlFile }, identity: state => ({
      ...state.authority.remote,
      async watchSession(...args) {
        const lease = await state.authority.remote.watchSession(...args);
        return { ...lease, signal: AbortSignal.any([lease.signal, interrupted.signal]) };
      },
      async authenticate(...args) {
        const session = await state.authority.remote.authenticate(...args);
        if (++checks === 2) {
          const later = remaining => remaining ? queueMicrotask(() => later(remaining - 1)) :
            interrupted.abort(Object.assign(new Error('Session revoked'), { code: 'session-no-longer-authorized' }));
          later(3);
        }
        return session;
      },
    }) });
    const response = await f.request(mode === 'binary' ? '/knowledge/original/' + imported.id : '/control/stop', f.native.token, mode === 'control' ? {} : undefined);
    assert.equal(response.status, 401, mode);
    assert.doesNotMatch(await response.text(), /PRIVATE-BINARY/);
    assert.equal(fs.existsSync(controlFile), false, 'Cancelled authorization must not persist a control mutation');
  }
});

test('a completed model reply is withheld when its native session was revoked before output', async t => {
  const f = await fixture(t, { server: { leaseIntervalMs: 10000 }, fetcher: async (url, _init, state) => {
    if (url.endsWith('/api/chat')) {
      await state.authority.local.revokeDevice(state.native.deviceId);
      return Response.json({ done: true, message: { content: 'Protected generated answer' } });
    }
    return Response.json(url.endsWith('/api/status') ? { cloud: { disabled: true } } : tags);
  } });
  const response = await f.request('/chat', f.native.token, { message: 'Hello' });
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /Protected generated answer/);
  assert.equal(f.calls.filter(call => call.url.endsWith('/api/chat')).length, 1);
});

test('revocation cancels health discovery even when its provider ignores the signal', async t => {
  const entered = deferred(); let signal;
  const f = await fixture(t, { fetcher: (_url, init) => { signal = init.signal; entered.resolve(); return new Promise(() => {}); } });
  const pending = f.request('/health');
  await within(entered.promise); await f.authority.local.revokeDevice(f.native.deviceId);
  assert.equal((await within(pending)).status, 401);
  assert.equal(signal.aborted, true); assert.equal(f.calls.length, 1);
});

test('native authorization is rechecked immediately before binary original headers and bytes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-native-original-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'store'), bytes = Buffer.from('PRIVATE ORIGINAL BYTES');
  const imported = importDocument(directory, { source: path.join(root, 'synthetic.txt'), title: 'Synthetic original', text: 'Synthetic text', originalBytes: bytes });
  let calls = 0;
  const f = await fixture(t, { server: { knowledgeDirectory: directory, leaseIntervalMs: 10000 }, identity: state => ({
    ...state.authority.remote,
    async authenticate(token, kind) {
      // The first explicit check admits the HTTP request; the second protects output.
      if (++calls === 2) await state.authority.local.revokeDevice(state.native.deviceId);
      return state.authority.remote.authenticate(token, kind);
    },
  }) });
  const response = await f.request('/knowledge/original/' + imported.id);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('content-disposition'), null);
  assert.doesNotMatch(await response.text(), /PRIVATE ORIGINAL BYTES/);
  assert.equal(f.calls.length, 0);
});

test('control mutation cannot use authorization retained from admission', async t => {
  let armed = true, calls = 0;
  const f = await fixture(t, { server: { leaseIntervalMs: 10000 }, identity: state => ({
    ...state.authority.remote,
    async authenticate(token, kind) {
      if (armed && ++calls === 2) { armed = false; await state.authority.local.revokeDevice(state.native.deviceId); }
      return state.authority.remote.authenticate(token, kind);
    },
  }) });
  const sibling = await f.authority.local.createNativeSession({ deviceId: randomUUID(), label: 'Control observer' });
  assert.equal((await f.request('/control/stop', f.native.token, {})).status, 401);
  assert.equal((await (await f.request('/health', sibling.token)).json()).status, 'ready');
});

test('a lease acquired after client disconnect is promptly closed', async t => {
  const entered = deferred(), release = deferred(), closed = deferred();
  const f = await fixture(t, { identity: state => ({
    ...state.authority.remote,
    async watchSession(...args) {
      entered.resolve(); await release.promise;
      const lease = await state.authority.remote.watchSession(...args);
      return { ...lease, close() { lease.close(); closed.resolve(); } };
    },
  }) });
  const request = http.get(f.url + '/health', { headers: headers(f.native.token) });
  request.on('error', () => {}); t.after(() => request.destroy());
  await within(entered.promise);
  const disconnected = new Promise(resolve => request.once('close', resolve));
  request.destroy(); await within(disconnected);
  release.resolve(); await within(closed.promise);
  assert.equal(f.calls.length, 0);
});

test('request deadline releases a pending lease acquisition and closes the eventual lease', async t => {
  const release = deferred(), closed = deferred();
  const f = await fixture(t, { server: { requestTimeoutMs: 50 }, identity: state => ({
    ...state.authority.remote,
    async watchSession(...args) {
      await release.promise; const lease = await state.authority.remote.watchSession(...args);
      return { ...lease, close() { lease.close(); closed.resolve(); } };
    },
  }) });
  assert.equal((await within(f.request('/health'))).status, 503);
  release.resolve(); await within(closed.promise);
  assert.equal(f.calls.length, 0);
});

test('revoked partial upload is terminated and the chat admission slot becomes usable', async t => {
  const f = await fixture(t);
  const sibling = await f.authority.local.createNativeSession({ deviceId: randomUUID(), label: 'Upload observer' });
  const request = http.request(f.url + '/chat', { method: 'POST', headers: { ...headers(f.native.token), 'Content-Length': '1000' } });
  request.on('error', () => {}); t.after(() => request.destroy());
  const disconnected = new Promise(resolve => request.once('close', resolve));
  request.write('{"message":"unfinished');
  let admitted = false;
  for (let i = 0; i < 50; i++) {
    if ((await (await f.request('/health', sibling.token)).json()).activeRequest) { admitted = true; break; }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(admitted, true);
  await f.authority.local.revokeDevice(f.native.deviceId); await within(disconnected);
  assert.equal(f.calls.filter(call => call.url.endsWith('/api/chat')).length, 0);
  assert.equal((await within(f.request('/chat', sibling.token, { message: 'After revoked upload' }))).status, 200);
});

test('a partial upload denied before admission closes its connection without waiting for the missing body', async t => {
  const f = await fixture(t);
  await f.authority.local.revokeDevice(f.native.deviceId);
  const request = http.request(f.url + '/chat', { method: 'POST', headers: { ...headers(f.native.token), 'Content-Length': '1000' } });
  request.on('error', () => {}); t.after(() => request.destroy());
  const closed = new Promise(resolve => request.once('close', resolve));
  request.write('{"message":"unfinished');
  await within(closed);
  assert.equal(f.calls.length, 0);
});

test('upload completion must reauthenticate before model discovery even without a polling tick', async t => {
  let explicitChecks = 0;
  const f = await fixture(t, { server: { leaseIntervalMs: 10000 }, identity: state => ({
    ...state.authority.remote,
    async authenticate(token, kind) {
      if (++explicitChecks === 2) await state.authority.local.revokeDevice(state.native.deviceId);
      return state.authority.remote.authenticate(token, kind);
    },
  }) });
  assert.equal((await f.request('/chat', f.native.token, { message: 'Uploaded data' })).status, 401);
  assert.equal(f.calls.length, 0);
});

test('simultaneous native chats keep one admission slot and a late cancelled result cannot release its successor', async t => {
  const entered = deferred(), first = deferred(), nextEntered = deferred(), next = deferred(); let generations = 0;
  const f = await fixture(t, { fetcher: url => {
    if (url.endsWith('/api/chat')) {
      if (++generations === 1) { entered.resolve(); return first.promise; }
      nextEntered.resolve(); return next.promise;
    }
    return Response.json(url.endsWith('/api/status') ? { cloud: { disabled: true } } : tags);
  } });
  const sibling = await f.authority.local.createNativeSession({ deviceId: randomUUID(), label: 'Successor session' });
  const a = f.request('/chat', f.native.token, { message: 'First request' });
  await within(entered.promise);
  assert.equal((await f.request('/chat', sibling.token, { message: 'Concurrent request' })).status, 409);
  await f.authority.local.revokeDevice(f.native.deviceId);
  assert.equal((await within(a)).status, 401);
  const b = f.request('/chat', sibling.token, { message: 'Successor request' });
  await within(nextEntered.promise);
  first.resolve(Response.json({ done: true, message: { content: 'Discarded old reply' } }));
  assert.equal((await (await f.request('/health', sibling.token)).json()).activeRequest, true);
  assert.equal((await f.request('/chat', sibling.token, { message: 'Still busy' })).status, 409);
  next.resolve(Response.json({ done: true, message: { content: 'Valid successor reply' } }));
  const response = await within(b);
  assert.equal(response.status, 200); assert.equal((await response.json()).message, 'Valid successor reply');
  assert.equal(generations, 2);
});

test('pre-close shutdown aborts a non-cooperative review reader and all active leases', async t => {
  const entered = deferred(), release = deferred(); let closed = 0;
  const f = await fixture(t, { server: { reviewReader: () => { entered.resolve(); return release.promise; } }, identity: state => ({
    ...state.authority.remote,
    async watchSession(...args) { const lease = await state.authority.remote.watchSession(...args); return { ...lease, close() { closed++; lease.close(); } }; },
  }) });
  const pending = f.request('/actions/review');
  await within(entered.promise); f.server.sunnyClose();
  const response = await within(pending);
  assert.equal(response.status, 503); assert.equal(closed, 1);
  assert.doesNotMatch(await response.text(), /private-record/);
  assert.equal((await f.request('/health')).status, 503);
  release.resolve({ 'private-record': 'late data' });
  assert.equal(f.calls.length, 0);
});
