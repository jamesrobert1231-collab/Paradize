'use strict';

// Capture the single-use fragment only in memory, then remove it before any API request.
let pairingCode = document.body.dataset.page === 'pair' && /^#[0-9a-f]{64}$/.test(location.hash) ? location.hash.slice(1) : null;
try { if (location.hash || location.search) history.replaceState(null, '', location.pathname); }
catch { pairingCode = null; }

const byId = id => document.getElementById(id);
const text = (id, value) => { const element = byId(id); if (element) element.textContent = value; };
const encoder = new TextEncoder();
let unauthorized = () => {};
const errorText = status => ({
  401: 'This device is no longer connected. Open a new connection link from PARADIZE on your PC.',
  403: 'This request was not accepted. Reload this page from your private PARADIZE address.',
  409: 'That action could not be completed in the current state. Check the connection and try again.',
  429: 'Sunny is handling another request. Wait a moment, then try again.',
  503: 'Sunny is not available right now. Check PARADIZE on your PC and try again.',
  504: 'The reply took too long. Please try again with a shorter message.',
}[status] || 'The request could not be completed. Check your connection and try again.');

function csrf() {
  const matches = document.cookie.split(';').map(value => value.trim()).filter(value => value.startsWith('__Host-paradize-csrf='));
  if (matches.length !== 1 || !/^__Host-paradize-csrf=[0-9a-f]{64}$/.test(matches[0])) {
    unauthorized(); throw new Error(errorText(401));
  }
  return matches[0].slice('__Host-paradize-csrf='.length);
}

async function api(path, { body, protectedPost = false, signal, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Paradize-Request'] = 'browser';
      if (protectedPost) headers['X-Paradize-CSRF'] = csrf();
    }
    let response;
    try {
      response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers,
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
        credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    } catch { throw new Error('The connection was interrupted. Check PARADIZE on your PC, then try again.'); }
    if (response.status === 401) unauthorized();
    if (!response.ok) throw new Error(errorText(response.status));
    if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error(errorText(0));
    let reader;
    try {
      reader = response.body.getReader();
      const parts = []; let length = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 131072) { await reader.cancel(); throw new Error(); }
        parts.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
      return result;
    } catch { throw new Error(errorText(0)); }
    finally { reader?.releaseLock(); }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function dateLabel(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(new Date(value).getTime())) throw new Error(errorText(0));
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function pairPage() {
  if (!pairingCode) {
    text('pair-status', 'Open a fresh connection link created in PARADIZE on your PC. This page cannot connect a device without that link.');
    return;
  }
  const form = byId('pair-form'), label = byId('device-label'), connect = byId('connect');
  let inspected = false, expiresAt = 0, attempted = false;
  window.addEventListener('pagehide', () => { pairingCode = null; connect.disabled = true; label.disabled = true; });
  window.addEventListener('pageshow', event => {
    if (event.persisted) text('pair-status', 'Open a fresh connection link created in PARADIZE on your PC.');
  });
  try {
    const details = await api('/api/device-access/inspect', { body: { code: pairingCode } });
    if (!pairingCode) return;
    if (![1, 7, 30].includes(details.sessionDays) || details.expiresAt <= Date.now()) throw new Error(errorText(0));
    text('pair-duration', `${details.sessionDays} ${details.sessionDays === 1 ? 'day' : 'days'}`);
    text('pair-expiry', dateLabel(details.expiresAt));
    expiresAt = details.expiresAt; inspected = true;
    byId('pair-details').hidden = false;
    text('pair-status', 'Ready when you are. Choose Connect this device to grant this browser access.');
    label.disabled = false; connect.disabled = false;
  } catch { pairingCode = null; text('pair-status', 'This connection link could not be confirmed. Create a fresh link on your PC and open it here.'); }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!inspected || attempted || !pairingCode) return;
    if (Date.now() >= expiresAt) {
      pairingCode = null; connect.disabled = true; label.disabled = true;
      text('pair-status', 'This link has expired. Create a new connection link on your PC.'); return;
    }
    const name = label.value.trim();
    if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
      text('pair-status', 'Enter a short, readable name for this browser.'); label.focus(); return;
    }
    attempted = true; connect.disabled = true; label.disabled = true;
    text('pair-status', 'Connecting this browser…');
    try {
      await api('/api/device-access/exchange', { body: { code: pairingCode, label: name } });
      pairingCode = null; location.replace('/');
    } catch {
      pairingCode = null;
      text('pair-status', 'Connection could not be confirmed. Check connected devices in PARADIZE on your PC before creating another link.');
    }
  });
}

function sunnyPage() {
  const form = byId('chat-form'), message = byId('message'), conversation = byId('conversation');
  let session = null, healthy = false, busy = false, checking = false, controlPending = false;
  let generation = 0, accessRevision = 0, active = null, expiryTimer;
  let history = [];
  function controls() {
    message.disabled = !session || !healthy || busy || controlPending;
    byId('send').disabled = message.disabled;
    byId('cancel').disabled = !session || !busy || controlPending;
    byId('disconnect').disabled = !session || controlPending;
  }
  function clearSession(status = errorText(401)) {
    generation++; accessRevision++; active?.abort(); active = null; busy = false; healthy = false; session = null;
    clearTimeout(expiryTimer); history = []; conversation.replaceChildren(); message.value = '';
    byId('empty-chat').hidden = false;
    text('session-status', 'This device is not connected.');
    text('health-status', 'Reconnect this device to check Sunny’s availability.');
    text('notice', status); controls();
  }
  unauthorized = () => clearSession();
  function expireWhenDue() {
    clearTimeout(expiryTimer);
    if (!session) return;
    const remaining = session.expiresAt - Date.now();
    if (remaining <= 0) { clearSession(); return; }
    expiryTimer = setTimeout(expireWhenDue, Math.min(remaining + 10, 2147483647));
  }
  function addTurn(role, content) {
    const turn = document.createElement('li'); turn.className = `turn turn-${role}`;
    const speaker = document.createElement('span'); speaker.className = 'turn-speaker';
    speaker.textContent = role === 'user' ? 'You' : 'Sunny';
    const body = document.createElement('p'); body.className = 'turn-text'; body.textContent = content;
    turn.append(speaker, body); conversation.append(turn);
    while (conversation.children.length > 32) conversation.firstElementChild.remove();
    byId('empty-chat').hidden = true;
    conversation.scrollTop = conversation.scrollHeight;
  }
  async function checkConnection({ health = true } = {}) {
    if (checking) return;
    let revision = accessRevision;
    checking = true; byId('refresh').disabled = true;
    try {
      const current = await api('/api/session');
      if (revision !== accessRevision) return;
      if (current.kind !== 'browser' || typeof current.sessionId !== 'string' || typeof current.label !== 'string' ||
        current.expiresAt <= Date.now()) throw new Error(errorText(0));
      dateLabel(current.expiresAt);
      if (session && current.sessionId !== session.sessionId) {
        clearSession('This browser’s connection changed.'); revision = accessRevision;
      }
      session = current; expireWhenDue();
      if (!session) return;
      text('session-status', `${current.label} · Access expires ${dateLabel(current.expiresAt)}.`);
      if (health) {
        const state = await api('/api/sunny/health');
        if (revision !== accessRevision) return;
        healthy = state.status === 'ready' && state.toolsEnabled === false && state.memoryConnected === false &&
          Array.isArray(state.capabilities) && state.capabilities.includes('local-chat');
        text('health-status', healthy ? 'Sunny is ready for local chat.' : ({
          stopped: 'Sunny is paused. Resume it from PARADIZE on your PC.',
          'local-only-unconfirmed': 'Local-only AI access needs to be confirmed on your PC before chat can start.',
          'model-unavailable': 'Sunny needs a supported local model on your PC.',
          'ollama-unavailable': 'The local AI service is not available on your PC.',
        }[state.status] || 'Sunny is not ready for chat. Check PARADIZE on your PC.'));
        if (healthy) text('notice', '');
      }
    } catch (error) {
      healthy = false;
      text('notice', error.message);
      if (session) text('health-status', 'Connection could not be confirmed. Use Check connection to try again.');
    } finally { checking = false; byId('refresh').disabled = false; controls(); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!session || !healthy || busy || controlPending) return;
    const prompt = message.value.trim();
    if (!prompt || prompt.length > 2000) return;
    const context = history.slice(-8);
    while (encoder.encode(JSON.stringify({ message: prompt, history: context })).byteLength > 7900 && context.length) context.splice(0, 2);
    if (encoder.encode(JSON.stringify({ message: prompt, history: context })).byteLength > 7900) {
      text('notice', 'Please shorten your message so Sunny can receive it.'); return;
    }
    const turn = ++generation; busy = true; active = new AbortController(); controls();
    message.value = ''; addTurn('user', prompt); text('notice', 'Sunny is thinking locally…');
    try {
      const reply = await api('/api/sunny/chat', { body: { message: prompt, history: context }, protectedPost: true,
        signal: active.signal, timeout: 110000 });
      if (turn !== generation) return;
      if (reply.status !== 'complete' || typeof reply.message !== 'string' || !reply.message.trim()) throw new Error(errorText(0));
      addTurn('assistant', reply.message);
      if (reply.message.length <= 2000) history = [...context, { role: 'user', content: prompt }, { role: 'assistant', content: reply.message }].slice(-8);
      else history = [];
      text('notice', '');
    } catch (error) { if (turn === generation) text('notice', error.message); }
    finally { if (turn === generation) { busy = false; active = null; controls(); if (!message.disabled) message.focus(); } }
  });
  message.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); }
  });
  byId('cancel').addEventListener('click', async () => {
    if (!session || !busy || controlPending) return;
    controlPending = true; controls();
    try {
      const result = await api('/api/sunny/cancel', { body: {}, protectedPost: true });
      if (result.scope !== 'this-device' || typeof result.cancelled !== 'boolean') throw new Error(errorText(0));
      generation++; active?.abort(); active = null; busy = false;
      text('notice', result.cancelled ? 'This device’s reply was stopped.' : 'No reply was running for this device.');
    } catch (error) { text('notice', error.message); }
    finally { controlPending = false; controls(); }
  });
  byId('disconnect').addEventListener('click', async () => {
    if (!session || controlPending) return;
    controlPending = true; controls();
    try {
      const result = await api('/api/device-access/disconnect', { body: {}, protectedPost: true });
      if (result.disconnected !== true) throw new Error(errorText(0));
      clearSession('This device is disconnected. Create a new connection link on your PC to return.');
    } catch (error) { text('notice', error.message); }
    finally { controlPending = false; controls(); }
  });
  byId('refresh').addEventListener('click', () => checkConnection());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && session) checkConnection({ health: false }); });
  setInterval(() => { if (!document.hidden && session) checkConnection({ health: false }); }, 30000);
  window.addEventListener('pagehide', () => clearSession('Checking this device again…'));
  window.addEventListener('pageshow', event => { if (event.persisted) { clearSession('Checking this device again…'); checkConnection(); } });
  checkConnection();
}

if (document.body.dataset.page === 'pair') pairPage();
else if (document.body.dataset.page === 'sunny') sunnyPage();
