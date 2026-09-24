import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserPolicy } from '../../services/gateway/browser-policy.mjs';

const origin = 'https://paradize.example:8443';
const token = 'a'.repeat(64), csrfToken = 'b'.repeat(64);
const cookies = `__Host-paradize=${token}; __Host-paradize-csrf=${csrfToken}`;
const policy = createBrowserPolicy({ origin });
function request(fields = {}, { encrypted = true, extraRaw = [] } = {}) {
  const headers = { host: 'paradize.example:8443', ...fields };
  return { socket: { encrypted }, headers, rawHeaders: [...Object.entries(headers).flat(), ...extraRaw] };
}
function mutation(fields = {}) {
  return request({ origin, 'content-type': 'application/json', 'x-paradize-request': 'browser', ...fields });
}
function denied(run, status = 403) {
  assert.throws(run, error => error.status === status && /^BROWSER_[A-Z_]+$/.test(error.message));
}

test('configuration is a single canonical HTTPS origin without URL adornments', () => {
  assert.equal(createBrowserPolicy({ origin: 'https://PARADIZE.example:8443' }).origin, origin);
  for (const invalid of [undefined, null, '', 'http://paradize.example', 'https://paradize.example/',
    'https://paradize.example/path', 'https://owner@paradize.example', 'https://paradize.example?',
    'https://paradize.example#', 'https://paradize.example:443', 'https://paradize.example:08443',
    ' https://paradize.example', 'https://paradize.example\\other', 'https://127.1',
    'https://paradize.example.', 'https://paradize.example:0', 'https://-paradize.example',
    'https://paradize..example', `https://${'a'.repeat(64)}.example`]) {
    denied(() => createBrowserPolicy({ origin: invalid }));
  }
  assert.equal(createBrowserPolicy({ origin: 'https://[::1]:8443' }).origin, 'https://[::1]:8443');
});

test('direct encrypted connection and exact Host are required, including on loopback', () => {
  assert.doesNotThrow(() => policy.assertRequest(request()));
  assert.doesNotThrow(() => policy.assertRequest(request({ host: 'PARADIZE.example:8443' })));
  for (const encrypted of [false, undefined, 'true', 1]) {
    const req = request(); req.socket.encrypted = encrypted;
    denied(() => policy.assertRequest(req));
  }
  for (const host of ['', 'localhost', 'paradize.example', 'paradize.example:443',
    'paradize.example:08443', 'sub.paradize.example:8443', 'paradize.example:8443.evil.test',
    'owner@paradize.example:8443', 'paradize.example:8443, evil.test', 'paradize.example:8443.']) {
    denied(() => policy.assertRequest(request({ host })));
  }
  const local = createBrowserPolicy({ origin: 'https://localhost' });
  denied(() => local.assertRequest(request({ host: 'localhost' }, { encrypted: false })));
});

test('proxy assertions and native bearer authorization are never browser authority', () => {
  for (const header of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
    'x-forwarded-unrecognized', 'x-real-ip', 'tailscale-user-login', 'tailscale-anything', 'authorization']) {
    denied(() => policy.assertRequest(request({ [header]: header === 'authorization' ? `Bearer ${token}` : 'localhost' })));
  }
});

test('Origin is exact and never inferred from Host or Referer', () => {
  assert.doesNotThrow(() => policy.assertRequest(request({ origin })));
  for (const supplied of ['null', 'http://paradize.example:8443', 'https://paradize.example',
    'https://sub.paradize.example:8443', 'https://paradize.example:8443/', 'https://PARADIZE.example:8443',
    `${origin} https://evil.example`, '']) {
    denied(() => policy.assertRequest(request({ origin: supplied })));
  }
  denied(() => policy.assertRequest(request({ referer: `${origin}/`, 'content-type': 'application/json',
    'x-paradize-request': 'browser' }), { mutation: true }));
});

test('mutations require exact origin, JSON and browser custom header', () => {
  for (const contentType of ['application/json', 'application/json; charset=utf-8', 'Application/JSON; Charset=UTF-8']) {
    assert.doesNotThrow(() => policy.assertRequest(mutation({ 'content-type': contentType }), { mutation: true }));
  }
  for (const missing of ['origin', 'content-type', 'x-paradize-request']) {
    const req = mutation(); delete req.headers[missing];
    req.rawHeaders = Object.entries(req.headers).flat();
    denied(() => policy.assertRequest(req, { mutation: true }));
  }
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data',
    'application/json; charset=utf-16', 'application/json; charset=utf-8; boundary=x', 'application/json, text/plain']) {
    denied(() => policy.assertRequest(mutation({ 'content-type': contentType }), { mutation: true }));
  }
  denied(() => policy.assertRequest(mutation({ 'x-paradize-request': 'Browser' }), { mutation: true }));
});

test('Fetch Metadata rejects siblings and cross-site requests with Safari absence fallback', () => {
  assert.doesNotThrow(() => policy.assertRequest(mutation(), { mutation: true }));
  assert.doesNotThrow(() => policy.assertRequest(mutation({ 'sec-fetch-site': 'same-origin' }), { mutation: true }));
  assert.doesNotThrow(() => policy.assertRequest(request({ 'sec-fetch-site': 'none' })));
  for (const site of ['cross-site', 'same-site', 'null', '', 'same-origin, cross-site']) {
    denied(() => policy.assertRequest(request({ 'sec-fetch-site': site })));
    denied(() => policy.assertRequest(mutation({ 'sec-fetch-site': site }), { mutation: true }));
  }
  denied(() => policy.assertRequest(mutation({ 'sec-fetch-site': 'none' }), { mutation: true }));
});

test('raw security duplicates are rejected even when Node would discard or join one', () => {
  for (const [name, value] of Object.entries({ host: 'paradize.example:8443', origin, cookie: cookies,
    'content-type': 'application/json', 'x-paradize-request': 'browser', 'x-paradize-csrf': csrfToken,
    'sec-fetch-site': 'same-origin', 'content-length': '0', 'transfer-encoding': 'chunked' })) {
    const req = request({ [name]: value }, { extraRaw: [name.toUpperCase(), value] });
    denied(() => policy.assertRequest(req));
  }
  denied(() => policy.assertRequest(request({}, { extraRaw: ['HOST', 'evil.example'] })));
});

test('headers and rawHeaders must agree on security values and rejected assertions', () => {
  for (const name of ['host', 'origin', 'cookie', 'x-paradize-csrf', 'authorization', 'x-forwarded-host']) {
    const req = request(); req.headers[name] = 'different';
    denied(() => policy.assertRequest(req));
    const rawOnly = request({}, { extraRaw: [name, 'different'] });
    denied(() => policy.assertRequest(rawOnly));
  }
  const array = request(); array.headers.cookie = [cookies];
  denied(() => policy.credentials(array));
  const alias = request(); alias.headers.Host = alias.headers.host;
  denied(() => policy.assertRequest(alias));
  for (const rawHeaders of [undefined, null, ['Host'], ['Host', 7], ['Bad Name', 'value'],
    ['Host', 'paradize.example:8443\r\nX-Other: evil'], Array(202).fill('x')]) {
    const req = request(); req.rawHeaders = rawHeaders;
    denied(() => policy.assertRequest(req));
  }
});

test('credentials return only the exact pair of opaque 256-bit lowercase cookies', () => {
  assert.deepEqual(policy.credentials(request({ cookie: cookies })), { token, csrfToken });
  assert.deepEqual(policy.credentials(request({ cookie: `other=ignored; ${cookies}; another="valid"` })), { token, csrfToken });
  assert.equal(policy.credentials(request()), null);
  assert.equal(policy.credentials(request({ cookie: 'unrelated=one; unrelated=two' })), null);
  for (const cookie of [`__Host-paradize=${token}`, `__Host-paradize-csrf=${csrfToken}`,
    `${cookies}; __Host-paradize=${token}`, `${cookies}; __Host-paradize-csrf=${csrfToken}`,
    `__Host-paradize=${token.toUpperCase()}; __Host-paradize-csrf=${csrfToken}`,
    `__Host-paradize="${token}"; __Host-paradize-csrf=${csrfToken}`,
    `__Host-paradize=${'a'.repeat(63)}; __Host-paradize-csrf=${csrfToken}`,
    `__Host-paradize=${token}%20; __Host-paradize-csrf=${csrfToken}`,
    `__Host-paradize=; __Host-paradize-csrf=${csrfToken}`, `__host-paradize=${token}`,
    `${cookies}; malformed`, `${cookies}; bad name=value`, `${cookies}, another=value`,
    `${cookies}; other=with space`, `${cookies}; other=back\\slash`, `${cookies};`, '', 'other=' + 'x'.repeat(4096)]) {
    denied(() => policy.credentials(request({ cookie })), 401);
  }
});

test('CSRF header must exactly match cookie, pending the authority session-binding check', () => {
  assert.equal(policy.csrfHeader(request({ cookie: cookies, 'x-paradize-csrf': csrfToken })), csrfToken);
  for (const fields of [{}, { cookie: cookies }, { cookie: cookies, 'x-paradize-csrf': 'c'.repeat(64) },
    { cookie: cookies, 'x-paradize-csrf': csrfToken.toUpperCase() },
    { cookie: cookies, 'x-paradize-csrf': `${csrfToken}, ${csrfToken}` }]) {
    denied(() => policy.csrfHeader(request(fields)));
  }
});

test('issued and cleared cookies have required host scope and different script visibility', () => {
  assert.deepEqual(policy.issueCookies({ token, csrfToken, maxAgeSeconds: 86400 }), [
    `__Host-paradize=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
    `__Host-paradize-csrf=${csrfToken}; Secure; SameSite=Strict; Path=/; Max-Age=86400`,
  ]);
  assert.deepEqual(policy.clearCookies(), [
    '__Host-paradize=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    '__Host-paradize-csrf=; Secure; SameSite=Strict; Path=/; Max-Age=0',
  ]);
  for (const age of [0, -1, 2592001, Infinity, NaN, 0.5, '86400', undefined]) {
    denied(() => policy.issueCookies({ token, csrfToken, maxAgeSeconds: age }));
  }
  for (const age of [1, 2592000]) assert.equal(policy.issueCookies({ token, csrfToken, maxAgeSeconds: age }).length, 2);
  denied(() => policy.issueCookies({ token: `${token}\r\nInjected: x`, csrfToken, maxAgeSeconds: 1 }));
  for (const invalid of [undefined, null, Symbol('sensitive'), {}, 7]) {
    denied(() => policy.issueCookies({ token: invalid, csrfToken, maxAgeSeconds: 1 }));
    denied(() => policy.issueCookies({ token, csrfToken: invalid, maxAgeSeconds: 1 }));
  }
});

test('errors never echo caller-controlled URLs, cookies, or authorization', () => {
  const secret = 'caller-secret-value';
  for (const run of [() => createBrowserPolicy({ origin: `https://${secret}@evil.example` }),
    () => policy.assertRequest(request({ authorization: secret })),
    () => policy.credentials(request({ cookie: `__Host-paradize=${secret}` }))]) {
    assert.throws(run, error => !error.message.includes(secret) && Object.keys(error).join(',') === 'status');
  }
});
