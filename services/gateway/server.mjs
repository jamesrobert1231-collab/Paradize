import https from 'node:https';
import { readFileSync } from 'node:fs';
import { createBrowserPolicy } from './browser-policy.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fault = (status, message) => Object.assign(new Error(message), { status });
const publicSession = value => ({ ownerId: value.ownerId, deviceId: value.deviceId, sessionId: value.sessionId,
  kind: value.kind, label: value.label, expiresAt: value.expiresAt, accountGrants: [] });
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']], ['/pair', ['pair.html', 'text/html; charset=utf-8']],
  ['/assets/client.js', ['client.js', 'text/javascript; charset=utf-8']], ['/assets/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const routes = new Set(['GET /api/session', 'GET /api/sunny/health', 'POST /api/sunny/chat', 'POST /api/sunny/cancel',
  'POST /api/device-access/inspect', 'POST /api/device-access/exchange', 'POST /api/device-access/disconnect']);
const requiredRemote = ['inspectPairing', 'exchangePairing', 'authenticate', 'checkCsrf', 'revokeSelf', 'watchSession'];

function interruptible(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    if (signal.aborted) aborted();
  });
}

async function readJson(req, signal) {
  if (req.headers['content-encoding']) throw fault(400, 'Send an uncompressed JSON request.');
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 8192)) throw fault(413, 'The request is too large.');
  return interruptible(new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const clean = () => { req.off('data', data); req.off('end', end); req.off('error', error); signal.removeEventListener('abort', aborted); };
    const error = e => { clean(); reject(e); };
    const aborted = () => error(signal.reason);
    const data = chunk => {
      size += chunk.length;
      if (size > 8192) { error(fault(413, 'The request is too large.')); req.resume(); }
      else chunks.push(chunk);
    };
    const end = () => {
      clean();
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!object(value)) throw new Error();
        resolve(value);
      } catch { reject(fault(400, 'Send a valid JSON object.')); }
    };
    req.on('data', data); req.once('end', end); req.once('error', error);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  }), signal);
}

function fields(value, required, optional = []) {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw fault(400, 'The request contains unsupported fields.');
}

// Only the remote capability is accepted. This module cannot bootstrap owners,
// issue pairing invitations, select native routes or authorize account access.
export function createGatewayHandler({ origin, identity, sunny, leaseIntervalMs = 1000 } = {}) {
  const policy = createBrowserPolicy({ origin });
  if (!object(identity) || requiredRemote.some(key => typeof identity[key] !== 'function') ||
      Object.keys(identity).some(key => !requiredRemote.includes(key)) ||
      typeof sunny?.health !== 'function' || typeof sunny?.chat !== 'function' ||
      !Number.isInteger(leaseIntervalMs) || leaseIntervalMs < 10 || leaseIntervalMs > 10000) throw new TypeError('Remote identity and Sunny adapters are required.');
  const activeChats = new Map(), requests = new Set(), attempts = new Map(); let closed = false;
  const rateLimit = req => {
    const now = performance.now();
    for (const [peer, value] of attempts) if (now - value.at >= 60000) attempts.delete(peer);
    const peer = req.socket.remoteAddress;
    if (!peer || (!attempts.has(peer) && attempts.size >= 256)) throw fault(429, 'Pairing is busy. Try again in a minute.');
    const entry = attempts.get(peer) ?? { at: now, count: 0 }; attempts.set(peer, entry);
    if (++entry.count > 10) throw fault(429, 'Too many pairing attempts. Try again in a minute.');
  };
  const handler = async (req, res) => {
    const controller = new AbortController(); requests.add(controller);
    const deadline = setTimeout(() => controller.abort(fault(504, 'The request did not finish in time.')), 100000);
    const disconnected = () => { if (!res.writableEnded) controller.abort(fault(499, 'The browser disconnected.')); };
    req.once('aborted', disconnected); res.once('close', disconnected);
    let lease, credentials, chatDevice;
    let signal = controller.signal;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      if (res.destroyed || res.writableEnded) return;
      const content = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': content.length }); res.end(content);
    };
    const authenticated = async () => {
      const session = await interruptible(identity.authenticate(credentials.token, 'browser'), signal);
      signal.throwIfAborted(); return publicSession(session);
    };
    try {
      if (closed) throw fault(503, 'Browser access is shutting down.');
      policy.assertRequest(req, { mutation: req.method !== 'GET' });
      if (req.method === 'GET' && staticFiles.has(req.url)) {
        const [file, type] = staticFiles.get(req.url);
        send(200, readFileSync(new URL(`./public/${file}`, import.meta.url)), type); return;
      }
      if (!routes.has(`${req.method} ${req.url}`)) throw fault(404, 'This browser route is unavailable.');
      credentials = policy.credentials(req);
      if (req.url === '/api/device-access/inspect' || req.url === '/api/device-access/exchange') {
        rateLimit(req);
        if (credentials) throw fault(409, 'Disconnect this device before pairing again.');
        const body = await readJson(req, signal);
        if (req.url.endsWith('/inspect')) {
          fields(body, ['code']);
          const result = await interruptible(identity.inspectPairing(body), signal);
          signal.throwIfAborted(); send(200, result); return;
        }
        fields(body, ['code', 'label']);
        const session = await interruptible(identity.exchangePairing(body), signal);
        const confirmed = await interruptible(identity.authenticate(session.token, 'browser'), signal);
        signal.throwIfAborted();
        res.setHeader('Set-Cookie', policy.issueCookies({ token: session.token, csrfToken: session.csrfToken,
          maxAgeSeconds: Math.max(1, Math.min(2592000, Math.floor((session.expiresAt - Date.now()) / 1000))) }));
        send(200, publicSession(confirmed)); return;
      }
      if (!credentials) throw fault(401, 'Connect this device using a fresh invitation from the trusted launcher.');
      const pendingLease = identity.watchSession(credentials.token, 'browser', { intervalMs: leaseIntervalMs });
      // A late store response must not leave a lease polling after disconnect.
      void pendingLease.then(value => { if (controller.signal.aborted) value.close(); }, () => {});
      lease = await interruptible(pendingLease, signal);
      signal = AbortSignal.any([controller.signal, lease.signal]); signal.throwIfAborted();
      if (req.method === 'POST') {
        const csrf = policy.csrfHeader(req);
        if (!await interruptible(identity.checkCsrf(credentials.token, csrf), signal)) throw fault(403, 'The browser request could not be verified. Reload and try again.');
        signal.throwIfAborted();
      }
      if (req.url === '/api/session') { send(200, await authenticated()); return; }
      const body = req.method === 'POST' ? await readJson(req, signal) : null;
      if (req.url === '/api/device-access/disconnect') {
        fields(body, []); await interruptible(identity.revokeSelf(credentials.token, 'browser'), signal);
        activeChats.get(lease.identity.deviceId)?.abort(fault(401, 'This device was disconnected.'));
        res.setHeader('Set-Cookie', policy.clearCookies()); send(200, { disconnected: true }); return;
      }
      if (req.url === '/api/sunny/cancel') {
        fields(body, []); await authenticated();
        const current = activeChats.get(lease.identity.deviceId); current?.abort(fault(409, 'This reply was stopped.'));
        send(200, { cancelled: Boolean(current), scope: 'this-device' }); return;
      }
      let result;
      if (req.url === '/api/sunny/chat') {
        fields(body, ['message'], ['history']);
        if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000 ||
          (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 8 || body.history.some(turn =>
            !object(turn) || Object.keys(turn).length !== 2 || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string' || turn.content.length > 2000)))) {
          throw fault(400, 'Send a message up to 2000 characters and at most eight conversation turns.');
        }
        // Uploading the body can outlive revocation. Recheck immediately before
        // admitting inference, rather than relying only on the polling lease.
        await authenticated();
        chatDevice = lease.identity.deviceId;
        if (activeChats.has(chatDevice)) { chatDevice = undefined; throw fault(409, 'This device already has a reply in progress.'); }
        activeChats.set(chatDevice, controller);
        result = await interruptible(sunny.chat(body, { signal }), signal);
      } else {
        await authenticated();
        result = await interruptible(sunny.health({ signal }), signal);
      }
      await authenticated();
      if (!Number.isInteger(result?.statusCode) || result.statusCode < 200 || result.statusCode > 599 || !object(result.body)) throw fault(502, 'Sunny returned an unsupported response.');
      send(result.statusCode, result.body);
    } catch (error) {
      const identityDenied = /^(?:session-|credential-|pairing-|device-invalid)/.test(error?.code || '');
      const status = identityDenied ? 401 : ([400, 401, 403, 404, 409, 413, 429, 499, 502, 503, 504].includes(error?.status) ? error.status : 503);
      if (status === 401) res.setHeader('Set-Cookie', policy.clearCookies());
      // Only locally defined messages are exposed; adapter/storage errors may
      // contain credentials, SQL or paths and are never serialized.
      const messages = { 400: 'The browser request is invalid.', 401: 'Device access expired or changed. Connect again using a fresh invitation.',
        403: 'The browser request could not be verified.', 404: 'This browser route is unavailable.', 409: 'The request was stopped or another reply is in progress.',
        413: 'The request is too large.', 429: 'Too many pairing attempts. Try again in a minute.', 499: 'The browser disconnected.',
        502: 'Sunny returned an unsupported response.', 503: 'Private browser access is unavailable. Try again after the local service is ready.', 504: 'The request did not finish in time.' };
      send(status, { status: status < 500 ? 'denied' : 'unavailable', message: messages[status] });
    } finally {
      if (chatDevice && activeChats.get(chatDevice) === controller) activeChats.delete(chatDevice);
      lease?.close(); clearTimeout(deadline); controller.abort(); requests.delete(controller);
      req.off('aborted', disconnected); res.off('close', disconnected); req.resume();
    }
  };
  handler.close = () => { closed = true; for (const controller of requests) controller.abort(fault(503, 'Browser access is shutting down.')); attempts.clear(); };
  return handler;
}

// Caller supplies its qualified certificate and remote-only authority. No
// listener, certificate installation or trusted-local capability is implicit.
export function createGatewayServer({ tls, ...options }) {
  if (!tls || (!tls.pfx && !(tls.key && tls.cert))) throw new TypeError('Explicit TLS credentials are required.');
  const handler = createGatewayHandler(options);
  const server = https.createServer({ ...tls, minVersion: 'TLSv1.2', maxHeaderSize: 16384 }, handler);
  server.headersTimeout = 5000; server.requestTimeout = 10000; server.keepAliveTimeout = 2000; server.maxConnections = 32;
  const rejectUpgrade = (_req, socket) => socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  server.on('upgrade', rejectUpgrade); server.on('connect', rejectUpgrade);
  server.on('close', handler.close); server.gatewayClose = handler.close;
  return server;
}
