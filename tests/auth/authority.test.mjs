import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createIdentityAuthority } from '../../packages/auth/authority.mjs';

const DAY = 86400000;
// This fixture tests authority rules and atomic-callback behavior, not PostgreSQL.
function fixture() {
  let state = null, now = Date.UTC(2026, 8, 24), queue = Promise.resolve();
  const store = {
    async read() { return { state: structuredClone(state), now }; },
    transact(update) {
      const operation = queue.then(() => {
        const result = update(structuredClone(state), now);
        state = structuredClone(result.state);
        return result.value;
      });
      queue = operation.catch(() => {}); return operation;
    },
  };
  return { store, authority: createIdentityAuthority({ store }),
    snapshot: () => structuredClone(state), advance: ms => { now += ms; },
    corrupt: edit => { edit(state); } };
}
async function initialized() {
  const f = fixture();
  f.ids = { ownerId: randomUUID(), installationId: randomUUID() };
  await f.authority.local.initialize(f.ids);
  return f;
}
async function browser(f, label = 'Test phone') {
  const pairing = await f.authority.local.createPairing({ sessionDays: 1 });
  return { pairing, session: await f.authority.remote.exchangePairing({ code: pairing.code, label }) };
}

test('owner initialization is explicit, stable and cannot replace an established owner', async () => {
  const f = fixture();
  await assert.rejects(f.authority.remote.authenticate('a'.repeat(64), 'native'));
  const ids = { ownerId: randomUUID(), installationId: randomUUID() };
  const first = await f.authority.local.initialize(ids);
  assert.equal(first.ownerId, ids.ownerId);
  const reopened = createIdentityAuthority({ store: f.store });
  assert.deepEqual(await reopened.local.initialize(ids), first);
  await assert.rejects(reopened.local.initialize({ ...ids, ownerId: randomUUID() }));
  assert.equal(f.snapshot().owner.id, ids.ownerId);
  assert.equal(typeof reopened.remote.initialize, 'undefined');
  assert.equal(typeof reopened.remote.createPairing, 'undefined');
});

test('pairing creates distinct owner/device/session IDs and persists only secret digests', async () => {
  const f = await initialized(), { pairing, session } = await browser(f);
  assert.equal(new Set([session.ownerId, session.deviceId, session.sessionId]).size, 3);
  assert.equal(session.ownerId, f.ids.ownerId);
  assert.equal(session.kind, 'browser');
  assert.deepEqual(session.accountGrants, []);
  const json = JSON.stringify(f.snapshot());
  for (const secret of [pairing.code, session.token, session.csrfToken]) assert.ok(!json.includes(secret));
  assert.equal((await f.authority.remote.authenticate(session.token, 'browser')).deviceId, session.deviceId);
  await assert.rejects(f.authority.remote.authenticate(session.token, 'native'));
  assert.equal(await f.authority.remote.checkCsrf(session.token, session.csrfToken), true);
  assert.equal(await f.authority.remote.checkCsrf(session.token, 'b'.repeat(64)), false);
});

test('pairing inspection reveals duration without consuming or returning the secret', async () => {
  const f = await initialized(), pair = await f.authority.local.createPairing({ sessionDays: 7 });
  const before = f.snapshot();
  assert.deepEqual(await f.authority.remote.inspectPairing({ code: pair.code }), { expiresAt: pair.expiresAt, sessionDays: 7 });
  assert.deepEqual(f.snapshot(), before);
  await f.authority.remote.exchangePairing({ code: pair.code, label: 'Inspected device' });
  await assert.rejects(f.authority.remote.inspectPairing({ code: pair.code }));
});

test('one-use pairing survives concurrent exchange attempts and authority reopening', async () => {
  const f = await initialized(), pair = await f.authority.local.createPairing({ sessionDays: 7 });
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () =>
    f.authority.remote.exchangePairing({ code: pair.code, label: 'Concurrent phone' })));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  const state = f.snapshot();
  assert.equal(state.devices.length, 1); assert.equal(state.sessions.length, 1);
  assert.equal(state.pairings[0].sessionId, state.sessions[0].id);
  await assert.rejects(createIdentityAuthority({ store: f.store }).remote.exchangePairing({ code: pair.code, label: 'Replay' }));
});

test('failed storage transaction grants no session and leaves pairing redeemable', async () => {
  const f = await initialized(), pair = await f.authority.local.createPairing({ sessionDays: 1 });
  const failing = createIdentityAuthority({ store: { read: f.store.read,
    async transact(update) { const { state, now } = await f.store.read(); update(state, now); throw new Error('Synthetic rollback'); } } });
  await assert.rejects(failing.remote.exchangePairing({ code: pair.code, label: 'Rollback phone' }));
  assert.equal(f.snapshot().sessions.length, 0);
  assert.equal(f.snapshot().pairings[0].consumedAt, null);
  assert.ok((await f.authority.remote.exchangePairing({ code: pair.code, label: 'Retry after known rollback' })).token);
});

test('pairing expiry and session expiry apply at the exact deadline without deleting history', async () => {
  const f = await initialized(), pair = await f.authority.local.createPairing({ sessionDays: 1 });
  f.advance(10 * 60000);
  await assert.rejects(f.authority.remote.exchangePairing({ code: pair.code, label: 'Late phone' }));
  const { session } = await browser(f);
  f.advance(DAY - 100); assert.ok(await f.authority.remote.authenticate(session.token, 'browser'));
  f.advance(100); await assert.rejects(f.authority.remote.authenticate(session.token, 'browser'));
  assert.equal(f.snapshot().sessions.length, 1); assert.equal(f.snapshot().pairings.length, 2);
});

test('self-revocation cannot revoke a different device and survives reopening', async () => {
  const f = await initialized(), a = (await browser(f, 'A')).session, b = (await browser(f, 'B')).session;
  await f.authority.remote.revokeSelf(a.token, 'browser');
  await assert.rejects(createIdentityAuthority({ store: f.store }).remote.authenticate(a.token, 'browser'));
  assert.ok(await f.authority.remote.authenticate(b.token, 'browser'));
  assert.equal(f.snapshot().devices.length, 2);
  await f.authority.local.revokeDevice(b.deviceId);
  await assert.rejects(f.authority.remote.authenticate(b.token, 'browser'));
});

test('global revocation keeps the same owner and invalidates outstanding pairings', async () => {
  const f = await initialized(), { session } = await browser(f);
  const pair = await f.authority.local.createPairing({ sessionDays: 30 });
  await f.authority.local.revokeAll();
  await assert.rejects(f.authority.remote.authenticate(session.token, 'browser'));
  await assert.rejects(f.authority.remote.exchangePairing({ code: pair.code, label: 'Old link' }));
  assert.equal((await browser(f)).session.ownerId, f.ids.ownerId);
  assert.equal(f.snapshot().owner.epoch, 1);
});

test('native issuance is local-only and device revocation cannot be undone by reuse', async () => {
  const f = await initialized(), id = randomUUID();
  const native = await f.authority.local.createNativeSession({ deviceId: id, label: 'Unity' });
  assert.equal(native.csrfToken, null); assert.equal(native.kind, 'native');
  await assert.rejects(f.authority.remote.authenticate(native.token, 'browser'));
  await f.authority.local.revokeDevice(id);
  await assert.rejects(f.authority.local.createNativeSession({ deviceId: id, label: 'Unity' }));
  assert.equal(typeof f.authority.remote.createNativeSession, 'undefined');
});

test('malformed established state and clock rollback fail closed without changing owner', async () => {
  const f = await initialized(), { session } = await browser(f);
  f.corrupt(state => { state.sessions[0].ownerId = randomUUID(); });
  await assert.rejects(f.authority.remote.authenticate(session.token, 'browser'));
  await assert.rejects(f.authority.local.initialize(f.ids));
  assert.equal(f.snapshot().owner.id, f.ids.ownerId);
  const other = await initialized(); other.advance(-1);
  await assert.rejects(other.authority.local.createPairing({ sessionDays: 1 }));
});

test('only inherited durations are admitted and active pairing count is bounded', async () => {
  const f = await initialized();
  await assert.rejects(f.authority.local.createPairing({ sessionDays: 2 }));
  for (let i = 0; i < 10; i++) await f.authority.local.createPairing({ sessionDays: 1 });
  await assert.rejects(f.authority.local.createPairing({ sessionDays: 1 }));
  assert.equal(f.snapshot().pairings.length, 10);
});

test('cancelling a pairing retains its history and never grants access', async () => {
  const f = await initialized(), pair = await f.authority.local.createPairing({ sessionDays: 1 });
  await f.authority.local.cancelPairing(pair.pairingId);
  await assert.rejects(f.authority.remote.exchangePairing({ code: pair.code, label: 'Cancelled phone' }));
  assert.equal(f.snapshot().pairings.length, 1);
  assert.equal(f.snapshot().devices.length, 0);
  assert.equal(f.snapshot().sessions.length, 0);
});

test('invalid pairing and browser labels leave the full established state unchanged', async () => {
  const f = await initialized(), pair = await f.authority.local.createPairing({ sessionDays: 1 });
  const before = f.snapshot();
  for (const request of [{ code: 'a'.repeat(64), label: 'Unknown code' },
    { code: pair.code, label: 'line\nbreak' }, { code: pair.code, label: 'x'.repeat(81) }]) {
    await assert.rejects(f.authority.remote.exchangePairing(request));
    assert.deepEqual(f.snapshot(), before);
  }
});

test('duplicate identities and inconsistent pairing/session relationships fail closed', async () => {
  for (const corrupt of [
    state => { state.devices[0].id = state.owner.id; },
    state => { state.pairings[0].sessionId = randomUUID(); },
    state => { state.sessions[0].csrfHash = null; },
    state => { state.owner.epoch = -1; },
    state => { state.pairings = []; },
    state => { state.pairings.push({ ...state.pairings[0], id: randomUUID(), secretHash: 'a'.repeat(64) }); },
  ]) {
    const f = await initialized(), { session } = await browser(f);
    f.corrupt(corrupt);
    await assert.rejects(f.authority.remote.authenticate(session.token, 'browser'));
  }
});

test('revocation history cannot describe a later pairing exchange or active revoked device', async () => {
  const f = await initialized(), pair = await f.authority.local.createPairing({ sessionDays: 1 });
  f.advance(1000);
  const session = await f.authority.remote.exchangePairing({ code: pair.code, label: 'Phone' });
  f.corrupt(state => { state.pairings[0].revokedAt = state.pairings[0].createdAt; });
  await assert.rejects(f.authority.remote.authenticate(session.token, 'browser'));
  const other = await initialized(), native = await other.authority.local.createNativeSession({ deviceId: randomUUID(), label: 'Unity' });
  await other.authority.local.revokeDevice(native.deviceId);
  other.corrupt(state => { state.sessions[0].revokedAt = null; });
  await assert.rejects(other.authority.remote.authenticate(native.token, 'native'));
});

test('stored native sessions cannot acquire a longer browser lifetime', async () => {
  const f = await initialized();
  const session = await f.authority.local.createNativeSession({ deviceId: randomUUID(), label: 'Unity' });
  f.corrupt(state => { state.sessions[0].expiresAt = state.sessions[0].createdAt + 30 * DAY; });
  await assert.rejects(f.authority.remote.authenticate(session.token, 'native'));
});

test('known expiry aborts independently of polling and a pending store read', async () => {
  const f = await initialized(), { session } = await browser(f);
  f.advance(DAY - 100);
  let reads = 0, finishRead;
  const store = { ...f.store, read() {
    if (++reads === 1) return f.store.read();
    return new Promise(resolve => { finishRead = async () => resolve(await f.store.read()); });
  } };
  const lease = await createIdentityAuthority({ store }).remote.watchSession(session.token, 'browser', { intervalMs: 10 });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Known expiry waited for a pending read')), 2000);
    lease.signal.addEventListener('abort', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
  assert.equal(lease.signal.aborted, true); assert.ok(reads >= 2);
  assert.equal(lease.signal.reason.code, 'session-expired');
  await finishRead(); lease.close();
});

test('delayed authority reads cannot authenticate or accept CSRF after the sampled expiry', async () => {
  const f = await initialized(), { session } = await browser(f);
  f.advance(DAY - 10);
  const delayed = createIdentityAuthority({ store: { ...f.store, async read() {
    const sampled = await f.store.read();
    await new Promise(resolve => setTimeout(resolve, 40));
    return sampled;
  } } });
  await assert.rejects(delayed.remote.authenticate(session.token, 'browser'));
  await assert.rejects(delayed.remote.checkCsrf(session.token, session.csrfToken));
  await assert.rejects(delayed.remote.watchSession(session.token, 'browser'));
});

test('an active session lease expires and explicit disposal aborts consumers', async () => {
  const f = await initialized(), { session } = await browser(f);
  const lease = await f.authority.remote.watchSession(session.token, 'browser', { intervalMs: 10 });
  const expiry = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Expiry was not observed')), 3000);
    lease.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  f.advance(DAY); await expiry;
  assert.equal(lease.signal.aborted, true);
  const next = (await browser(f)).session;
  const disposed = await f.authority.remote.watchSession(next.token, 'browser');
  disposed.close(); disposed.close();
  assert.equal(disposed.signal.aborted, true);
});

test('session lease aborts after persisted revocation and on authority failure', async () => {
  const f = await initialized(), { session } = await browser(f);
  const lease = await f.authority.remote.watchSession(session.token, 'browser', { intervalMs: 10 });
  await f.authority.remote.revokeSelf(session.token, 'browser');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Revocation was not observed')), 3000);
    lease.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  assert.equal(lease.signal.aborted, true); lease.close();
  const other = await initialized(), b = (await browser(other)).session;
  const active = await other.authority.remote.watchSession(b.token, 'browser', { intervalMs: 10 });
  other.corrupt(state => { state.version = 99; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Authority failure was not observed')), 3000);
    active.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  assert.equal(active.signal.aborted, true); active.close();
});
