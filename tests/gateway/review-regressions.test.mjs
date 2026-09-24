import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createIdentityAuthority } from '../../packages/auth/authority.mjs';
import { createGatewayHandler } from '../../services/gateway/server.mjs';
import { createTestTls } from './tls-fixture.mjs';

const tls = createTestTls();

test('revocation during a pending chat upload prevents dispatch before the lease poll runs', async t => {
  let state = null, queue = Promise.resolve(), handler, csrfChecked;
  const now = Date.now();
  const checked = new Promise(resolve => { csrfChecked = resolve; });
  const store = {
    async read() { return { state: structuredClone(state), now }; },
    transact(update) {
      const result = queue.then(() => { const next = update(structuredClone(state), now); state = structuredClone(next.state); return next.value; });
      queue = result.catch(() => {}); return result;
    },
  };
  const authority = createIdentityAuthority({ store });
  await authority.local.initialize({ ownerId: randomUUID(), installationId: randomUUID() });
  const invitation = await authority.local.createPairing({ sessionDays: 1 });
  const device = await authority.remote.exchangePairing({ code: invitation.code, label: 'Upload-race fixture' });
  const remote = { ...authority.remote, async checkCsrf(...args) { const accepted = await authority.remote.checkCsrf(...args); csrfChecked(); return accepted; } };
  let dispatched = 0;
  const sunny = {
    async health() { return { statusCode: 200, body: { status: 'ready' } }; },
    async chat() { dispatched++; return { statusCode: 200, body: { status: 'complete', message: 'This should not be generated.' } }; },
  };
  const server = https.createServer({ pfx: tls.pfx, passphrase: tls.passphrase }, (req, res) => handler(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `https://127.0.0.1:${server.address().port}`;
  handler = createGatewayHandler({ origin, identity: remote, sunny, leaseIntervalMs: 10000 });
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const content = JSON.stringify({ message: 'Delayed upload', history: [] });
  let request;
  const result = new Promise((resolve, reject) => {
    request = https.request(origin + '/api/sunny/chat', { method: 'POST', ca: tls.ca, servername: 'localhost', agent: false,
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Paradize-Request': 'browser',
        'X-Paradize-CSRF': device.csrfToken, 'Content-Length': Buffer.byteLength(content),
        Cookie: `__Host-paradize=${device.token}; __Host-paradize-csrf=${device.csrfToken}` } }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', reject); request.setTimeout(4000, () => request.destroy(new Error('Synthetic upload-race request timeout')));
    request.write(content.slice(0, 1));
  });
  await checked;
  await authority.local.revokeDevice(device.deviceId);
  request.end(content.slice(1));
  const response = await result;
  assert.equal(response.status, 401);
  assert.equal(response.text.includes('This should not be generated.'), false);
  assert.equal(dispatched, 0, 'A revoked browser must not dispatch new Sunny work after its upload completes.');
});
