import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../services/gateway/public/client.js', import.meta.url), 'utf8');
const code = 'a'.repeat(64), csrf = 'b'.repeat(64);
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

class Element {
  constructor() { this.children = []; this.listeners = new Map(); this.disabled = false; this.hidden = false; this.value = ''; this.content = ''; }
  set textContent(value) { this.content = String(value); this.children = []; }
  get textContent() { return this.content + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('HTML injection sink used'); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.content = ''; this.append(...children); }
  get firstElementChild() { return this.children[0]; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  addEventListener(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(handler); }
  async dispatch(name, values = {}) { for (const handler of this.listeners.get(name) ?? []) await handler({ preventDefault() {}, ...values }); }
  focus() { this.focused = true; }
  requestSubmit() { return this.dispatch('submit'); }
}

async function harness({ page = 'sunny', hash = '', route } = {}) {
  const names = ['disconnect', 'refresh', 'session-status', 'health-status', 'empty-chat', 'conversation', 'notice',
    'chat-form', 'message', 'cancel', 'send', 'pair-status', 'pair-details', 'pair-duration', 'pair-expiry',
    'pair-form', 'device-label', 'connect'];
  const elements = Object.fromEntries(names.map(name => [name, new Element()]));
  for (const name of ['disconnect', 'message', 'cancel', 'send', 'device-label', 'connect']) elements[name].disabled = true;
  elements['device-label'].value = 'Personal browser'; elements['pair-details'].hidden = true;
  const document = new Element(); document.body = { dataset: { page } }; document.hidden = false;
  document.cookie = `__Host-paradize-csrf=${csrf}`;
  document.getElementById = name => elements[name] ?? null;
  document.createElement = () => new Element();
  const window = new Element(), calls = [], events = [], timers = new Map(); let timer = 0;
  const now = Date.now();
  const session = { ownerId: 'owner', deviceId: 'device', sessionId: 'session', kind: 'browser', label: 'My phone', expiresAt: now + 86400000, accountGrants: [] };
  const health = { status: 'ready', model: 'qwen3:4b', toolsEnabled: false, memoryConnected: false, capabilities: ['local-chat'] };
  const location = { pathname: page === 'pair' ? '/pair' : '/', search: '', hash, replace: path => { events.push(['navigate', path]); } };
  const context = vm.createContext({ document, window, location, history: { replaceState: (...args) => {
    events.push(['strip', ...args]); location.hash = ''; location.search = '';
  } }, Intl, Date, TextEncoder, TextDecoder, Uint8Array, AbortController,
  setTimeout: (handler, delay) => { const id = ++timer; timers.set(id, { handler, delay }); return id; },
  clearTimeout: id => timers.delete(id), setInterval: () => ++timer,
  fetch: async (path, options) => {
    const call = { path, ...options, data: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call); events.push(['request', path]);
    const custom = await route?.(call, { session, health });
    if (custom !== undefined) return custom;
    if (path === '/api/session') return response(session);
    if (path === '/api/sunny/health') return response(health);
    if (path === '/api/sunny/chat') return response({ status: 'complete', message: 'A local reply.' });
    if (path === '/api/device-access/inspect') return response({ sessionDays: 7, expiresAt: now + 60000 });
    if (path === '/api/device-access/exchange') return response(session);
    if (path === '/api/device-access/disconnect') return response({ disconnected: true });
    if (path === '/api/sunny/cancel') return response({ cancelled: true, scope: 'this-device' });
    throw new Error('Unexpected path');
  } });
  Object.defineProperty(context, 'localStorage', { get() { throw new Error('Browser storage used'); } });
  Object.defineProperty(context, 'sessionStorage', { get() { throw new Error('Browser storage used'); } });
  vm.runInContext(source, context, { filename: 'client.js' });
  for (let i = 0; i < 4; i++) await flush();
  return { elements, document, window, calls, events, session, health, location, timers,
    send: async value => { elements.message.value = value; await elements['chat-form'].dispatch('submit'); } };
}

test('pairing fragment is removed before inspection and exchange requires explicit submit', async () => {
  const ui = await harness({ page: 'pair', hash: `#${code}` });
  assert.equal(ui.events[0][0], 'strip');
  assert.equal(ui.location.hash, '');
  assert.deepEqual(ui.calls.map(call => call.path), ['/api/device-access/inspect']);
  assert.equal(ui.calls[0].data.code, code);
  assert.equal(ui.elements['pair-duration'].textContent, '7 days');
  assert.equal(ui.elements.connect.disabled, false);
  ui.elements['device-label'].value = 'My iPhone';
  await ui.elements['pair-form'].dispatch('submit');
  const exchange = ui.calls[1];
  assert.equal(exchange.path, '/api/device-access/exchange');
  assert.deepEqual(exchange.data, { code, label: 'My iPhone' });
  assert.equal(exchange.headers['X-Paradize-Request'], 'browser');
  assert.equal(exchange.headers['X-Paradize-CSRF'], undefined);
  assert.equal(exchange.headers['Content-Type'], 'application/json');
  assert.deepEqual(ui.events.at(-1), ['navigate', '/']);
  await ui.elements['pair-form'].dispatch('submit');
  assert.equal(ui.calls.length, 2);
});

test('invalid pairing links make no requests and leaving a pair page destroys its in-memory code', async () => {
  const invalid = await harness({ page: 'pair', hash: '#not-a-code' });
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.location.hash, '');
  assert.equal(invalid.elements.connect.disabled, true);
  const ui = await harness({ page: 'pair', hash: `#${code}` });
  await ui.window.dispatch('pagehide'); await ui.window.dispatch('pageshow', { persisted: true });
  await ui.elements['pair-form'].dispatch('submit');
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.elements.connect.disabled, true);
});

test('Sunny model markup is displayed literally and protected posts use the CSRF cookie', async () => {
  const markup = '<img src=x onerror="window.compromised=true"><script>alert(1)</script>';
  const ui = await harness({ route: call => call.path === '/api/sunny/chat' ? response({ status: 'complete', message: markup }) : undefined });
  assert.equal(ui.elements.message.disabled, false);
  await ui.send('A question');
  const body = ui.elements.conversation.children.at(-1).children[1];
  assert.equal(body.textContent, markup); assert.equal(body.children.length, 0);
  const chat = ui.calls.find(call => call.path === '/api/sunny/chat');
  assert.equal(chat.headers['X-Paradize-CSRF'], csrf);
  assert.equal(chat.headers['X-Paradize-Request'], 'browser');
  assert.equal(chat.redirect, 'error'); assert.equal(chat.credentials, 'same-origin');
  assert.deepEqual(chat.data, { message: 'A question', history: [] });
});

test('401 clears visible conversation, unsent text and history before reconnection', async () => {
  let denied = false;
  const ui = await harness({ route: call => call.path === '/api/session' && denied ? response({ message: 'server-private-text' }, 401) : undefined });
  await ui.send('Private question');
  ui.elements.message.value = 'Unsent private thought'; denied = true;
  await ui.elements.refresh.dispatch('click');
  assert.equal(ui.elements.conversation.children.length, 0); assert.equal(ui.elements.message.value, '');
  assert.equal(ui.elements.message.disabled, true); assert.equal(ui.elements.disconnect.disabled, true);
  assert.match(ui.elements.notice.textContent, /no longer connected/);
  assert.doesNotMatch(ui.elements.notice.textContent, /server-private-text/);
  denied = false; await ui.elements.refresh.dispatch('click'); await ui.send('New conversation');
  assert.deepEqual(ui.calls.filter(call => call.path === '/api/sunny/chat').at(-1).data.history, []);
});

test('history is bounded to eight turns and long answers remain visible but are not resubmitted', async () => {
  let long = false;
  const ui = await harness({ route: call => call.path === '/api/sunny/chat' && long ? response({ status: 'complete', message: 'x'.repeat(2500) }) : undefined });
  for (let index = 0; index < 6; index++) await ui.send(`Question ${index}`);
  assert.equal(ui.calls.filter(call => call.path === '/api/sunny/chat').at(-1).data.history.length, 8);
  long = true; await ui.send('A longer answer');
  assert.equal(ui.elements.conversation.children.at(-1).children[1].textContent.length, 2500);
  long = false; await ui.send('Continue');
  assert.deepEqual(ui.calls.filter(call => call.path === '/api/sunny/chat').at(-1).data.history, []);
  for (let index = 0; index < 4; index++) await ui.send('😃'.repeat(1000));
  for (const call of ui.calls.filter(call => call.path === '/api/sunny/chat')) {
    assert.ok(Buffer.byteLength(call.body) <= 7900); assert.ok(call.data.history.length <= 8);
    assert.ok(call.data.history.every(turn => turn.content.length <= 2000));
  }
});

test('a stale connection check cannot restore the UI after disconnect', async () => {
  let delayed = false;
  const pending = deferred();
  const ui = await harness({ route: call => call.path === '/api/session' && delayed ? pending.promise : undefined });
  await ui.send('A thought'); delayed = true;
  const refresh = ui.elements.refresh.dispatch('click'); await flush();
  await ui.elements.disconnect.dispatch('click');
  pending.resolve(response(ui.session)); await refresh;
  assert.equal(ui.elements.message.disabled, true); assert.equal(ui.elements.conversation.children.length, 0);
  assert.match(ui.elements.notice.textContent, /disconnected/);
  const disconnect = ui.calls.find(call => call.path === '/api/device-access/disconnect');
  assert.equal(disconnect.headers['X-Paradize-CSRF'], csrf);
});

test('cancellation prevents a second chat while the control request is pending', async () => {
  const pendingChat = deferred(), pendingCancel = deferred();
  const ui = await harness({ route: call => call.path === '/api/sunny/chat' ? pendingChat.promise :
    call.path === '/api/sunny/cancel' ? pendingCancel.promise : undefined });
  const send = ui.send('Please respond'); await flush();
  const cancel = ui.elements.cancel.dispatch('click'); await flush();
  pendingChat.resolve(response({ status: 'complete', message: 'Finished just now.' })); await send;
  assert.equal(ui.elements.message.disabled, true);
  await ui.send('Should wait');
  assert.equal(ui.calls.filter(call => call.path === '/api/sunny/chat').length, 1);
  pendingCancel.resolve(response({ cancelled: false, scope: 'this-device' })); await cancel;
  assert.equal(ui.elements.message.disabled, false);
  assert.match(ui.elements.notice.textContent, /No reply was running for this device/);
  assert.equal(ui.calls.find(call => call.path === '/api/sunny/cancel').headers['X-Paradize-CSRF'], csrf);
});

test('missing CSRF does not transmit a protected operation and page departure clears memory', async () => {
  const ui = await harness(); await ui.send('Private thought');
  ui.document.cookie = ''; await ui.send('Must not send');
  assert.equal(ui.calls.filter(call => call.path === '/api/sunny/chat').length, 1);
  assert.equal(ui.elements.conversation.children.length, 0);
  const second = await harness(); await second.send('Another thought');
  second.elements.message.value = 'Unsent'; await second.window.dispatch('pagehide');
  assert.equal(second.elements.conversation.children.length, 0); assert.equal(second.elements.message.value, '');
  assert.equal(second.elements.message.disabled, true);
});

test('pages provide labeled controls and no inline or external active content', async () => {
  for (const name of ['index.html', 'pair.html']) {
    const html = await readFile(new URL(`../../services/gateway/public/${name}`, import.meta.url), 'utf8');
    assert.match(html, /<html lang="en">/); assert.match(html, /<main\b/); assert.match(html, /<h1\b/);
    assert.match(html, /<label for=/); assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /\s(?:on[a-z]+|style)\s*=/i);
    assert.doesNotMatch(html, /<(?:iframe|object|embed|style)\b/i);
    assert.doesNotMatch(html, /(?:src|href)="https?:/i);
    assert.match(html, /<script src="\/assets\/client\.js" defer><\/script>/);
  }
});
