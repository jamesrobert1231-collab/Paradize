import { timingSafeEqual } from 'node:crypto';

const TOKEN = /^[0-9a-f]{64}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const COOKIE_VALUE = /^(?:[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*|"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*")$/;
const SESSION_COOKIE = '__Host-paradize';
const CSRF_COOKIE = '__Host-paradize-csrf';
const CRITICAL_HEADERS = new Set([
  'host', 'origin', 'cookie', 'authorization', 'content-type', 'content-length',
  'transfer-encoding', 'sec-fetch-site', 'x-paradize-request', 'x-paradize-csrf',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const denied = (code, status = 403) => Object.assign(new Error(code), { status });
const prohibited = name => name === 'authorization' || name === 'forwarded' || name === 'x-real-ip' ||
  name.startsWith('x-forwarded-') || name.startsWith('tailscale-');
const critical = name => CRITICAL_HEADERS.has(name) || prohibited(name);

// Never use proxy assertions, loopback addresses or native bearer headers to establish browser authority.
function inspectHeaders(req) {
  if (!object(req) || !object(req.headers) || !Array.isArray(req.rawHeaders) ||
    req.rawHeaders.length > 200 || req.rawHeaders.length % 2 !== 0) {
    throw denied('BROWSER_HEADERS_INVALID');
  }
  const raw = new Map();
  let totalBytes = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i], value = req.rawHeaders[i + 1];
    if (typeof name !== 'string' || name.length > 128 || !HEADER_NAME.test(name) ||
      typeof value !== 'string' || value.length > 16384 || /[^\x20-\x7E]/.test(value)) throw denied('BROWSER_HEADERS_INVALID');
    totalBytes += name.length + value.length + 4;
    if (totalBytes > 16384) throw denied('BROWSER_HEADERS_INVALID');
    const key = name.toLowerCase();
    if (prohibited(key)) throw denied('BROWSER_ASSERTION_DENIED');
    if (critical(key)) {
      if (raw.has(key)) throw denied('BROWSER_HEADERS_INVALID');
      raw.set(key, value);
    }
  }
  const normalized = new Map();
  const keys = Object.keys(req.headers);
  if (keys.length > 100) throw denied('BROWSER_HEADERS_INVALID');
  for (const name of keys) {
    const key = name.toLowerCase();
    if (prohibited(key)) throw denied('BROWSER_ASSERTION_DENIED');
    if (critical(key)) {
      const value = req.headers[name];
      if (normalized.has(key) || typeof value !== 'string' || !raw.has(key) || raw.get(key) !== value) {
        throw denied('BROWSER_HEADERS_INVALID');
      }
      normalized.set(key, value);
    }
  }
  if (normalized.size !== raw.size) throw denied('BROWSER_HEADERS_INVALID');
  return raw;
}

function parseCredentials(headers) {
  if (!headers.has('cookie')) return null;
  const cookie = headers.get('cookie');
  if (!cookie || cookie.length > 4096) throw denied('BROWSER_COOKIE_INVALID', 401);
  const pieces = cookie.split(';');
  if (pieces.length > 64) throw denied('BROWSER_COOKIE_INVALID', 401);
  const auth = new Map();
  for (const piece of pieces) {
    // Only delimiter whitespace is ignored. Cookie values are never decoded, unquoted or trimmed.
    const pair = piece.replace(/^ +/, '');
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator), value = pair.slice(separator + 1);
    if (separator <= 0 || !HEADER_NAME.test(name) || !COOKIE_VALUE.test(value)) {
      throw denied('BROWSER_COOKIE_INVALID', 401);
    }
    if ([SESSION_COOKIE.toLowerCase(), CSRF_COOKIE.toLowerCase()].includes(name.toLowerCase())) {
      if (![SESSION_COOKIE, CSRF_COOKIE].includes(name) || auth.has(name) || !TOKEN.test(value)) {
        throw denied('BROWSER_COOKIE_INVALID', 401);
      }
      auth.set(name, value);
    }
  }
  if (auth.size === 0) return null;
  if (auth.size !== 2) throw denied('BROWSER_COOKIE_INVALID', 401);
  return { token: auth.get(SESSION_COOKIE), csrfToken: auth.get(CSRF_COOKIE) };
}

function configuredOrigin(value) {
  if (typeof value !== 'string' || value.length > 512 ||
    !/^https:\/\/(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:.]+\])(?::[0-9]{1,5})?$/.test(value)) {
    throw denied('BROWSER_ORIGIN_INVALID');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw denied('BROWSER_ORIGIN_INVALID'); }
  const host = parsed.hostname;
  const validHost = host.startsWith('[') || (host.length <= 253 && host.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)));
  if (parsed.origin.toLowerCase() !== value.toLowerCase() || !validHost || parsed.port === '0') {
    throw denied('BROWSER_ORIGIN_INVALID');
  }
  return parsed;
}

function cookieStrings(token, csrfToken, maxAgeSeconds) {
  return [
    `${SESSION_COOKIE}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`,
    `${CSRF_COOKIE}=${csrfToken}; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`,
  ];
}

export function createBrowserPolicy(options = {}) {
  const target = configuredOrigin(object(options) ? options.origin : undefined);
  const origin = target.origin;
  return Object.freeze({
    origin,
    assertRequest(req, options = {}) {
      if (!object(options) || (options.mutation !== undefined && typeof options.mutation !== 'boolean')) {
        throw denied('BROWSER_REQUEST_INVALID');
      }
      const mutation = options.mutation === true;
      if (req?.socket?.encrypted !== true) throw denied('BROWSER_TLS_REQUIRED');
      const headers = inspectHeaders(req);
      if (headers.get('host')?.toLowerCase() !== target.host) throw denied('BROWSER_HOST_DENIED');
      if ((headers.has('origin') && headers.get('origin') !== origin) || (mutation && !headers.has('origin'))) {
        throw denied('BROWSER_ORIGIN_DENIED');
      }
      const site = headers.get('sec-fetch-site');
      if (headers.has('sec-fetch-site') && site !== 'same-origin' && !(site === 'none' && !mutation)) {
        throw denied('BROWSER_FETCH_SITE_DENIED');
      }
      if (mutation && (headers.get('x-paradize-request') !== 'browser' ||
        !/^application\/json(?:; *charset=utf-8)?$/i.test(headers.get('content-type') ?? ''))) {
        throw denied('BROWSER_MUTATION_DENIED');
      }
    },
    credentials(req) { return parseCredentials(inspectHeaders(req)); },
    csrfHeader(req) {
      const headers = inspectHeaders(req), credentials = parseCredentials(headers);
      const supplied = headers.get('x-paradize-csrf');
      if (!credentials || typeof supplied !== 'string' || !TOKEN.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(credentials.csrfToken, 'hex'))) {
        throw denied('BROWSER_CSRF_DENIED');
      }
      // The gateway must additionally call authority.remote.checkCsrf to bind this nonce to the session.
      return supplied;
    },
    issueCookies(options = {}) {
      if (!object(options) || typeof options.token !== 'string' || typeof options.csrfToken !== 'string' ||
        !TOKEN.test(options.token) || !TOKEN.test(options.csrfToken) ||
        !Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 1 || options.maxAgeSeconds > 2592000) {
        throw denied('BROWSER_COOKIE_OPTIONS_INVALID');
      }
      return cookieStrings(options.token, options.csrfToken, options.maxAgeSeconds);
    },
    clearCookies() { return cookieStrings('', '', 0); },
  });
}
