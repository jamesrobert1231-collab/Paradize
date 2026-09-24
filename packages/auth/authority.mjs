import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const DAY = 86400000, PAIRING_TTL = 10 * 60000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const MAX_RECORDS = 512, MAX_DEVICES = 128;
class IdentityError extends Error {
  constructor(code) { super(code); this.name = 'IdentityError'; this.code = code; }
}
const fail = code => { throw new IdentityError(code); };
const requireValue = (condition, code = 'identity-state-invalid') => { if (!condition) fail(code); };
const hash = (domain, secret) => createHash('sha256').update(`paradize:${domain}:v1:${secret}`).digest('hex');
const newSecret = () => randomBytes(32).toString('hex');
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const uuid = value => typeof value === 'string' && UUID.test(value);
const digest = value => typeof value === 'string' && HEX.test(value);
const safeLabel = value => typeof value === 'string' && value.length >= 1 && value.length <= 80 &&
  value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
function shape(value, names) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Object.keys(value).sort().join(',') === names.split(',').sort().join(','));
}
function digestEqual(a, b) { return digest(a) && digest(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
function secret(value) { requireValue(digest(value), 'credential-invalid'); return value; }
function kind(value) { requireValue(value === 'browser' || value === 'native', 'device-kind-invalid'); return value; }

// Validate every stored record; established corrupt state is never reset or pruned.
export function validateIdentityState(state, now) {
  requireValue(validTime(now));
  shape(state, 'version,owner,lastObservedAt,devices,sessions,pairings');
  shape(state.owner, 'id,installationId,createdAt,epoch');
  requireValue(state.version === 1 && uuid(state.owner.id) && uuid(state.owner.installationId) &&
    state.owner.id !== state.owner.installationId && validTime(state.owner.createdAt) &&
    Number.isSafeInteger(state.owner.epoch) && state.owner.epoch >= 0 && state.owner.epoch < 2147483647 &&
    validTime(state.lastObservedAt) && state.lastObservedAt >= state.owner.createdAt && now >= state.lastObservedAt);
  requireValue(Array.isArray(state.devices) && state.devices.length <= MAX_DEVICES &&
    Array.isArray(state.sessions) && state.sessions.length <= MAX_RECORDS &&
    Array.isArray(state.pairings) && state.pairings.length <= MAX_RECORDS &&
    Buffer.byteLength(JSON.stringify(state)) <= 1024 * 1024);
  const ids = new Set([state.owner.id, state.owner.installationId]);
  const hashes = new Set(), devices = new Map(), sessions = new Map(), pairedSessions = new Set();
  const record = value => {
    requireValue(uuid(value.id) && !ids.has(value.id) && value.ownerId === state.owner.id &&
      validTime(value.createdAt) && value.createdAt >= state.owner.createdAt && value.createdAt <= state.lastObservedAt &&
      (value.revokedAt === null || (validTime(value.revokedAt) && value.revokedAt >= value.createdAt && value.revokedAt <= state.lastObservedAt)));
    ids.add(value.id);
  };
  const credential = value => {
    requireValue(digest(value.secretHash) && !hashes.has(value.secretHash) &&
      Number.isSafeInteger(value.epoch) && value.epoch >= 0 && value.epoch <= state.owner.epoch &&
      validTime(value.expiresAt) && value.expiresAt > value.createdAt);
    hashes.add(value.secretHash);
  };
  for (const device of state.devices) {
    shape(device, 'id,ownerId,kind,label,createdAt,revokedAt'); record(device);
    requireValue(['browser', 'native'].includes(device.kind) && safeLabel(device.label)); devices.set(device.id, device);
  }
  for (const session of state.sessions) {
    shape(session, 'id,ownerId,deviceId,epoch,secretHash,csrfHash,createdAt,expiresAt,revokedAt');
    record(session); credential(session);
    const device = devices.get(session.deviceId);
    requireValue(device && session.createdAt >= device.createdAt && session.expiresAt - session.createdAt <= 30 * DAY &&
      (device.kind !== 'native' || session.expiresAt - session.createdAt === DAY) &&
      (device.revokedAt === null ? session.revokedAt === null :
        session.createdAt <= device.revokedAt && session.revokedAt === device.revokedAt) &&
      (device.kind === 'browser' ? digest(session.csrfHash) : session.csrfHash === null));
    sessions.set(session.id, session);
  }
  for (const pairing of state.pairings) {
    shape(pairing, 'id,ownerId,epoch,secretHash,createdAt,expiresAt,sessionDays,consumedAt,sessionId,revokedAt');
    record(pairing); credential(pairing);
    requireValue(pairing.expiresAt - pairing.createdAt === PAIRING_TTL && [1, 7, 30].includes(pairing.sessionDays));
    if (pairing.consumedAt === null) requireValue(pairing.sessionId === null);
    else {
      const session = sessions.get(pairing.sessionId);
      requireValue(validTime(pairing.consumedAt) && pairing.consumedAt >= pairing.createdAt &&
        pairing.consumedAt < pairing.expiresAt && pairing.consumedAt <= state.lastObservedAt && session && !pairedSessions.has(session.id) &&
        (pairing.revokedAt === null || pairing.consumedAt <= pairing.revokedAt) &&
        session.createdAt === pairing.consumedAt && session.epoch === pairing.epoch &&
        session.expiresAt - session.createdAt === pairing.sessionDays * DAY && devices.get(session.deviceId).kind === 'browser');
      pairedSessions.add(session.id);
    }
  }
  for (const session of state.sessions) if (devices.get(session.deviceId).kind === 'browser') requireValue(pairedSessions.has(session.id));
  return state;
}

function sessionIn(state, now, token, expectedKind) {
  secret(token); kind(expectedKind);
  const wanted = hash('session', token), session = state.sessions.find(item => digestEqual(item.secretHash, wanted));
  const device = session && state.devices.find(item => item.id === session.deviceId);
  requireValue(session && device && device.kind === expectedKind && session.epoch === state.owner.epoch &&
    session.revokedAt === null && device.revokedAt === null && now < session.expiresAt, 'session-invalid');
  return { session, device };
}
function publicSession(state, session, device) {
  return { ownerId: state.owner.id, deviceId: device.id, sessionId: session.id,
    kind: device.kind, label: device.label, expiresAt: session.expiresAt, accountGrants: [] };
}
function addSession(state, now, device, days, token, csrfToken) {
  requireValue(state.sessions.length < MAX_RECORDS, 'identity-history-capacity');
  const session = { id: randomUUID(), ownerId: state.owner.id, deviceId: device.id, epoch: state.owner.epoch,
    secretHash: hash('session', token), csrfHash: csrfToken === null ? null : hash('csrf', csrfToken),
    createdAt: now, expiresAt: now + days * DAY, revokedAt: null };
  state.sessions.push(session); return session;
}
function revokeDevice(state, now, deviceId) {
  const device = state.devices.find(item => item.id === deviceId);
  requireValue(device, 'device-not-found');
  device.revokedAt ??= now;
  for (const session of state.sessions) if (session.deviceId === deviceId) session.revokedAt ??= now;
  return { ownerId: state.owner.id, deviceId, revoked: true };
}

/** local is a trusted-launcher capability; never pass it to a network router. */
export function createIdentityAuthority({ store }) {
  if (!store || typeof store.read !== 'function' || typeof store.transact !== 'function') throw new TypeError('Identity store required');
  async function read() {
    const started = performance.now(), result = await store.read(), observedAt = performance.now();
    requireValue(result && result.state !== null, 'owner-not-initialized');
    const state = validateIdentityState(result.state, result.now);
    // Database time was sampled before the read's COMMIT/return. Account for
    // the entire elapsed read conservatively so delayed data cannot extend access.
    const now = result.now + Math.ceil(observedAt - started);
    requireValue(validTime(now));
    return { state, now, observedAt };
  }
  async function currentSession(token, expectedKind) {
    const { state, now, observedAt } = await read(), { session, device } = sessionIn(state, now, token, expectedKind);
    const deadline = observedAt + session.expiresAt - now;
    requireValue(performance.now() < deadline, 'session-invalid');
    return { state, session, device, deadline };
  }
  async function change(operation, { allowEmpty = false } = {}) {
    const result = await store.transact((stored, now) => {
      requireValue(validTime(now));
      if (stored !== null) validateIdentityState(stored, now);
      const state = structuredClone(stored);
      try {
        requireValue(state !== null || allowEmpty, 'owner-not-initialized');
        const changed = operation(state, now);
        validateIdentityState(changed.state, now);
        return { state: changed.state, value: { ok: true, result: changed.result } };
      } catch (error) {
        if (!(error instanceof IdentityError)) throw error;
        return { state: stored, value: { ok: false, code: error.code } };
      }
    });
    if (!result || result.ok !== true) fail(result?.code || 'identity-update-rejected');
    return result.result;
  }
  const local = Object.freeze({
    async initialize({ ownerId, installationId }) {
      requireValue(uuid(ownerId) && uuid(installationId) && ownerId !== installationId, 'owner-identity-invalid');
      return change((state, now) => {
        if (state === null) state = { version: 1, owner: { id: ownerId, installationId, createdAt: now, epoch: 0 },
          lastObservedAt: now, devices: [], sessions: [], pairings: [] };
        requireValue(state.owner.id === ownerId && state.owner.installationId === installationId, 'owner-identity-conflict');
        return { state, result: { ownerId, installationId, createdAt: state.owner.createdAt } };
      }, { allowEmpty: true });
    },
    async createPairing({ sessionDays }) {
      requireValue([1, 7, 30].includes(sessionDays), 'session-duration-invalid');
      const code = newSecret();
      return change((state, now) => {
        requireValue(state.pairings.length < MAX_RECORDS, 'identity-history-capacity');
        requireValue(state.pairings.filter(p => p.epoch === state.owner.epoch && p.revokedAt === null &&
          p.consumedAt === null && p.expiresAt > now).length < 10, 'active-pairing-capacity');
        const pairing = { id: randomUUID(), ownerId: state.owner.id, epoch: state.owner.epoch,
          secretHash: hash('pairing', code), createdAt: now, expiresAt: now + PAIRING_TTL,
          sessionDays, consumedAt: null, sessionId: null, revokedAt: null };
        state.pairings.push(pairing); state.lastObservedAt = now;
        return { state, result: { pairingId: pairing.id, code, expiresAt: pairing.expiresAt, sessionDays } };
      });
    },
    async cancelPairing(pairingId) {
      requireValue(uuid(pairingId), 'pairing-invalid');
      return change((state, now) => {
        const pairing = state.pairings.find(p => p.id === pairingId);
        requireValue(pairing, 'pairing-invalid'); pairing.revokedAt ??= now; state.lastObservedAt = now;
        return { state, result: { pairingId, revoked: true } };
      });
    },
    async createNativeSession({ deviceId, label }) {
      requireValue(uuid(deviceId) && safeLabel(label), 'device-invalid');
      const token = newSecret();
      return change((state, now) => {
        let device = state.devices.find(d => d.id === deviceId);
        if (device) requireValue(device.kind === 'native' && device.revokedAt === null, 'device-revoked');
        else {
          requireValue(state.devices.length < MAX_DEVICES, 'identity-history-capacity');
          device = { id: deviceId, ownerId: state.owner.id, kind: 'native', label, createdAt: now, revokedAt: null };
          state.devices.push(device);
        }
        const session = addSession(state, now, device, 1, token, null); state.lastObservedAt = now;
        return { state, result: { ...publicSession(state, session, device), token, csrfToken: null } };
      });
    },
    async revokeDevice(deviceId) {
      requireValue(uuid(deviceId), 'device-invalid');
      return change((state, now) => {
        const result = revokeDevice(state, now, deviceId); state.lastObservedAt = now; return { state, result };
      });
    },
    async revokeAll() {
      return change((state, now) => {
        state.owner.epoch++; state.lastObservedAt = now;
        for (const device of state.devices) revokeDevice(state, now, device.id);
        for (const pairing of state.pairings) pairing.revokedAt ??= now;
        return { state, result: { ownerId: state.owner.id, revoked: true, epoch: state.owner.epoch } };
      });
    },
    async devices() {
      const { state } = await read();
      return { ownerId: state.owner.id, devices: structuredClone(state.devices) };
    },
  });
  const remote = Object.freeze({
    async inspectPairing({ code }) {
      secret(code);
      const { state, now } = await read(), wanted = hash('pairing', code);
      const pairing = state.pairings.find(p => digestEqual(p.secretHash, wanted));
      requireValue(pairing && pairing.consumedAt === null && pairing.revokedAt === null &&
        pairing.epoch === state.owner.epoch && now < pairing.expiresAt, 'pairing-invalid');
      return { expiresAt: pairing.expiresAt, sessionDays: pairing.sessionDays };
    },
    async exchangePairing({ code, label }) {
      secret(code); requireValue(safeLabel(label), 'device-invalid');
      const token = newSecret(), csrfToken = newSecret();
      return change((state, now) => {
        const wanted = hash('pairing', code), pairing = state.pairings.find(p => digestEqual(p.secretHash, wanted));
        requireValue(pairing && pairing.consumedAt === null && pairing.revokedAt === null &&
          pairing.epoch === state.owner.epoch && now < pairing.expiresAt, 'pairing-invalid');
        requireValue(state.devices.length < MAX_DEVICES, 'identity-history-capacity');
        const device = { id: randomUUID(), ownerId: state.owner.id, kind: 'browser', label, createdAt: now, revokedAt: null };
        state.devices.push(device);
        const session = addSession(state, now, device, pairing.sessionDays, token, csrfToken);
        pairing.consumedAt = now; pairing.sessionId = session.id; state.lastObservedAt = now;
        return { state, result: { ...publicSession(state, session, device), token, csrfToken } };
      });
    },
    async authenticate(token, expectedKind) {
      const { state, session, device } = await currentSession(token, expectedKind);
      return publicSession(state, session, device);
    },
    async checkCsrf(token, csrfToken) {
      const { session } = await currentSession(token, 'browser');
      return digest(csrfToken) && digestEqual(session.csrfHash, hash('csrf', csrfToken));
    },
    async revokeSelf(token, expectedKind) {
      return change((state, now) => {
        const { device } = sessionIn(state, now, token, expectedKind);
        const result = revokeDevice(state, now, device.id); state.lastObservedAt = now;
        return { state, result };
      });
    },
    async watchSession(token, expectedKind, { intervalMs = 1000 } = {}) {
      requireValue(Number.isInteger(intervalMs) && intervalMs >= 10 && intervalMs <= 10000, 'watch-interval-invalid');
      const { state, session, device, deadline } = await currentSession(token, expectedKind);
      const identity = publicSession(state, session, device), controller = new AbortController();
      // Anchor expiry to monotonic elapsed time, independent of slow reads and
      // polling. Subtract all initial read time conservatively, never extend it.
      requireValue(performance.now() < deadline, 'session-invalid');
      let timer = null, expiryTimer = null, closed = false;
      const stop = code => {
        closed = true; clearTimeout(timer); clearTimeout(expiryTimer);
        if (!controller.signal.aborted) controller.abort(new IdentityError(code));
      };
      const close = () => stop('session-lease-closed');
      const expire = () => {
        if (closed) return;
        const remaining = deadline - performance.now();
        if (remaining <= 0) { stop('session-expired'); return; }
        expiryTimer = setTimeout(expire, Math.min(Math.ceil(remaining), 2147483647)); expiryTimer.unref?.();
      };
      const poll = async () => {
        try { await remote.authenticate(token, expectedKind); }
        catch { stop('session-no-longer-authorized'); return; }
        if (!closed) { timer = setTimeout(poll, intervalMs); timer.unref?.(); }
      };
      expire();
      if (!closed) { timer = setTimeout(poll, intervalMs); timer.unref?.(); }
      return { identity, signal: controller.signal, close };
    },
  });
  return Object.freeze({ local, remote });
}
