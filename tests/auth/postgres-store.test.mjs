import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresIdentityStore } from '../../packages/auth/postgres-store.mjs';

// Driver-protocol tests only: this harness does not execute SQL or prove PostgreSQL isolation.
function driver({ state = null, revision = state === null ? '0' : '1', observed = '0', change } = {}) {
  const calls = []; const releases = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      const replacement = change?.(text, values);
      if (replacement !== undefined) return replacement;
      if (text.includes('server_version_num')) return { rows: [{ version: '170011' }], rowCount: 1 };
      if (text.startsWith('SELECT singleton')) return { rows: [{ singleton: 1, schema_version: 1, revision, last_observed_at: observed, state_json: state === null ? null : JSON.stringify(state) }], rowCount: 1 };
      if (text.startsWith('SELECT relkind')) return { rows: [{ relkind: 'r', relpersistence: 'p', relrowsecurity: false, relforcerowsecurity: false }], rowCount: 1 };
      if (text.includes('clock_timestamp')) return { rows: [{ now: '1800000000123' }], rowCount: 1 };
      if (text.startsWith('UPDATE paradize_identity.owner_state SET last_observed_at')) return { rows: [{ last_observed_at: values[0] }], rowCount: 1 };
      if (text.startsWith('UPDATE paradize_identity.owner_state SET state')) return { rows: [{ revision: String(BigInt(revision) + 1n) }], rowCount: 1 };
      return { rows: [], rowCount: null };
    },
    release(destroy) { releases.push(destroy); },
  };
  return { calls, releases, client, pool: { async connect() { return client; } } };
}

test('read preserves the intentionally uninitialized anchor as null with database time', async () => {
  const db = driver();
  assert.deepEqual(await createPostgresIdentityStore({ pool: db.pool }).read(), { state: null, now: 1800000000123 });
  assert.equal(db.calls.at(-1).text, 'COMMIT');
  assert.deepEqual(db.releases, [false]);
});

test('transact locks before obtaining fresh time and writes before committing', async () => {
  const db = driver(); const store = createPostgresIdentityStore({ pool: db.pool });
  const result = await store.transact((state, now) => {
    assert.equal(state, null); assert.equal(now, 1800000000123);
    assert.match(db.calls.at(-1).text, /SET last_observed_at/);
    return { state: { owner: 'synthetic-owner' }, value: 'created' };
  });
  assert.equal(result, 'created');
  const lock = db.calls.findIndex(c => c.text.includes('FOR UPDATE'));
  const clock = db.calls.findIndex(c => c.text.includes('clock_timestamp'));
  const write = db.calls.findIndex(c => c.text.startsWith('UPDATE paradize_identity.owner_state SET state'));
  assert.ok(lock >= 0 && clock > lock && write > clock);
  assert.deepEqual(db.calls[write].values, ['{"owner":"synthetic-owner"}', '0']);
  assert.equal(db.calls.at(-1).text, 'COMMIT');
});

test('read locks before fresh time and returns an independent clone without changing identity state', async () => {
  const original = { owner: { id: 'synthetic' } }; const db = driver({ state: original });
  const result = await createPostgresIdentityStore({ pool: db.pool }).read();
  result.state.owner.id = 'changed';
  assert.equal(original.owner.id, 'synthetic');
  assert.ok(db.calls.findIndex(c => c.text.includes('FOR UPDATE')) < db.calls.findIndex(c => c.text.includes('clock_timestamp')));
  assert.equal(db.calls.some(c => c.text.includes('SET state')), false);
});

for (const state of [null, { owner: 'synthetic' }]) {
  test(`unchanged ${state === null ? 'uninitialized' : 'initialized'} state does not bump revision`, async () => {
    const db = driver({ state });
    assert.deepEqual(await createPostgresIdentityStore({ pool: db.pool }).transact(current => ({ state: current, value: { ok: false, code: 'denied' } })), { ok: false, code: 'denied' });
    assert.equal(db.calls.some(c => c.text.includes('SET state')), false);
    assert.equal(db.calls.at(-1).text, 'COMMIT');
  });
}

test('an established owner can never be reset to the uninitialized NULL anchor', async () => {
  const db = driver({ state: { owner: 'synthetic' } });
  await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).transact(() => ({ state: null, value: null })), { code: 'IDENTITY_STATE_INVALID' });
  assert.equal(db.calls.some(c => c.text.includes('SET state')), false);
  assert.equal(db.calls.at(-1).text, 'ROLLBACK');
  assert.deepEqual(db.releases, [true]);
});

test('missing, duplicate and malformed anchors fail instead of bootstrapping', async () => {
  const valid = { singleton: 1, schema_version: 1, revision: '0', last_observed_at: '0', state_json: null };
  const rows = [[], [valid, valid], [{ ...valid, schema_version: 2 }], [{ ...valid, singleton: 2 }],
    [{ ...valid, revision: '1' }], [{ ...valid, state_json: '{}' }],
    [{ ...valid, revision: '1', state_json: 'null' }], [{ ...valid, revision: '1', state_json: '[]' }],
    [{ ...valid, revision: '1', state_json: '{bad' }], [{ ...valid, revision: '9223372036854775808' }]];
  for (const records of rows) {
    let invoked = false;
    const db = driver({ change: sql => sql.startsWith('SELECT singleton') ? { rows: records, rowCount: records.length } : undefined });
    await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).transact(() => { invoked = true; }), /Identity storage unavailable/);
    assert.equal(invoked, false);
    assert.equal(db.calls.some(c => c.text.includes('clock_timestamp') || c.text.startsWith('UPDATE')), false);
    assert.equal(db.calls.at(-1).text, 'ROLLBACK');
  }
});

test('only a PostgreSQL 17 server version is accepted before accessing identity state', async () => {
  for (const version of ['160010', '180000', '170000bad', 170000, null]) {
    const db = driver({ change: sql => sql.includes('server_version_num') ? { rows: [{ version }], rowCount: 1 } : undefined });
    await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).read(), { code: 'IDENTITY_POSTGRES_VERSION_UNSUPPORTED' });
    assert.equal(db.calls.some(c => c.text.startsWith('SELECT singleton')), false);
  }
});

test('fresh database time must be a positive safe epoch-millisecond integer', async () => {
  for (const now of ['0', '-1', '1.5', '9007199254740992', null]) {
    const db = driver({ change: sql => sql.includes('clock_timestamp') ? { rows: [{ now }], rowCount: 1 } : undefined });
    await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).read(), { code: 'IDENTITY_CLOCK_INVALID' });
  }
});

test('callback exceptions and driver errors do not expose their messages or causes', async () => {
  const secret = 'synthetic password or callback secret';
  for (const mode of ['callback', 'driver']) {
    const db = driver({ change: sql => { if (mode === 'driver' && sql.startsWith('SELECT singleton')) throw new Error(secret); } });
    await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).transact(() => { throw new Error(secret); }), error => {
      assert.equal(error.code, mode === 'callback' ? 'IDENTITY_UPDATE_REJECTED' : 'IDENTITY_STORAGE_UNAVAILABLE');
      assert.equal(`${error.stack}${JSON.stringify(error)}`.includes(secret), false);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(db.calls.at(-1).text, 'ROLLBACK');
    assert.deepEqual(db.releases, [true]);
  }
});

test('asynchronous and malformed callback returns are rejected without an identity-state UPDATE', async () => {
  for (const update of [async () => { throw new Error('synthetic secret'); }, () => null, () => ({ state: {} }), () => ({ state: {}, value: true, then() {} })]) {
    const db = driver();
    await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).transact(update), { code: 'IDENTITY_UPDATE_INVALID' });
    assert.equal(db.calls.some(c => c.text.includes('SET state')), false);
  }
});

test('state serialization rejects oversized and non-JSON state rather than silently coercing it', async () => {
  const hidden = {}; Object.defineProperty(hidden, 'toJSON', { value: () => ({}) });
  const circular = {}; circular.self = circular;
  const states = [{ text: 'x'.repeat(1024 * 1024) }, { bad: undefined }, { bad: Infinity }, { bad: 1n },
    { bad: new Date() }, { bad: () => {} }, { bad: Array(2) }, { get secret() { throw new Error('synthetic secret'); } }, hidden, circular, []];
  for (const state of states) {
    const db = driver();
    await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).transact(() => ({ state, value: true })), /Identity storage unavailable/);
    assert.equal(db.calls.some(c => c.text.includes('SET state')), false);
  }
});

test('failed update acknowledgement rolls back and discards the checked-out connection', async () => {
  const db = driver({ change: sql => sql.includes('SET state') ? { rows: [], rowCount: 0 } : undefined });
  await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).transact(() => ({ state: {}, value: true })), { code: 'IDENTITY_ENVELOPE_INVALID' });
  assert.equal(db.calls.at(-1).text, 'ROLLBACK');
  assert.deepEqual(db.releases, [true]);
});

test('COMMIT acknowledgement failure is uncertain and never retries the callback', async () => {
  let callbacks = 0;
  const db = driver({ change: sql => { if (sql === 'COMMIT') throw new Error('secret connection detail'); } });
  await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).transact(() => { callbacks++; return { state: {}, value: true }; }), { code: 'IDENTITY_COMMIT_UNCERTAIN' });
  assert.equal(callbacks, 1);
  assert.equal(db.calls.filter(c => c.text === 'COMMIT').length, 1);
  assert.deepEqual(db.releases, [true]);
});

test('rollback failure still discards connection and preserves the sanitized first error', async () => {
  const db = driver({ change: sql => { if (sql === 'ROLLBACK') throw new Error('secret connection detail'); } });
  await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).transact(() => { throw new Error('secret'); }), { code: 'IDENTITY_UPDATE_REJECTED' });
  assert.deepEqual(db.releases, [true]);
});

test('BEGIN and connection failures are sanitized and do not issue an invented rollback', async () => {
  const db = driver({ change: sql => { if (sql.startsWith('BEGIN')) throw new Error('secret'); } });
  await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).read(), { code: 'IDENTITY_STORAGE_UNAVAILABLE' });
  assert.equal(db.calls.some(c => c.text === 'ROLLBACK'), false);
  assert.deepEqual(db.releases, [true]);
  await assert.rejects(createPostgresIdentityStore({ pool: { connect() { throw new Error('secret'); } } }).read(), { code: 'IDENTITY_STORAGE_UNAVAILABLE' });
});

test('late acquisition after the deadline releases and destroys that connection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deliver; const db = driver();
  const pool = { connect: () => new Promise(resolve => { deliver = resolve; }) };
  const pending = createPostgresIdentityStore({ pool }).read();
  const rejected = assert.rejects(pending, { code: 'IDENTITY_CONNECT_TIMEOUT' });
  await Promise.resolve();
  t.mock.timers.tick(5001);
  await rejected;
  deliver(db.client);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(db.releases, [true]);
  assert.equal(db.calls.length, 0);
});

test('an unresponsive query deadline destroys the connection and prevents reuse', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered; const entry = new Promise(resolve => { entered = resolve; });
  const db = driver({ change: sql => { if (sql.startsWith('BEGIN')) { entered(); return new Promise(() => {}); } } });
  const pending = createPostgresIdentityStore({ pool: db.pool }).read();
  const rejected = assert.rejects(pending, { code: 'IDENTITY_QUERY_TIMEOUT' });
  await entry; t.mock.timers.tick(7001); await rejected;
  assert.deepEqual(db.releases, [true]);
  assert.equal(db.calls.length, 1);
});

test('every successful operation bounds database waits and restores connection settings at transaction end', async () => {
  const db = driver(); await createPostgresIdentityStore({ pool: db.pool }).read();
  assert.equal(db.calls[0].text, 'BEGIN ISOLATION LEVEL READ COMMITTED');
  const settings = db.calls.find(c => c.text.startsWith('SET LOCAL')).text;
  for (const required of ["lock_timeout = '2s'", "statement_timeout = '5s'", "idle_in_transaction_session_timeout = '5s'", "transaction_timeout = '10s'", 'synchronous_commit = on']) assert.ok(settings.includes(required));
});

test('read persists its fresh clock observation under the exclusive lock before COMMIT', async () => {
  const db = driver({ observed: '1800000000000' });
  await createPostgresIdentityStore({ pool: db.pool }).read();
  const lock = db.calls.findIndex(c => c.text.includes('FOR UPDATE'));
  const clock = db.calls.findIndex(c => c.text.includes('clock_timestamp'));
  const observation = db.calls.findIndex(c => c.text.includes('SET last_observed_at'));
  const commit = db.calls.findIndex(c => c.text === 'COMMIT');
  assert.ok(lock >= 0 && lock < clock && clock < observation && observation < commit);
  assert.deepEqual(db.calls[observation].values, ['1800000000123', '1800000000000']);
  assert.equal(db.calls.some(c => c.text.includes('revision = revision + 1')), false);
});

test('persisted clock high-water rejects regression for reads and changes before callback or write', async () => {
  for (const operation of ['read', 'transact']) {
    const db = driver({ observed: '1800000000124' }); let called = false;
    const store = createPostgresIdentityStore({ pool: db.pool });
    const result = operation === 'read' ? store.read() : store.transact(state => { called = true; return { state, value: true }; });
    await assert.rejects(result, { code: 'IDENTITY_CLOCK_REGRESSED' });
    assert.equal(called, false);
    assert.equal(db.calls.some(c => c.text.startsWith('UPDATE')), false);
    assert.equal(db.calls.at(-1).text, 'ROLLBACK');
  }
});

test('missing or corrupt clock high-water and failed observation acknowledgement fail closed', async () => {
  for (const observed of [undefined, null, '-1', '9007199254740992', 123]) {
    const db = driver({ change: sql => sql.startsWith('SELECT singleton') ? { rows: [{ singleton: 1, schema_version: 1, revision: '0', state_json: null, last_observed_at: observed }], rowCount: 1 } : undefined });
    await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).read(), { code: 'IDENTITY_ENVELOPE_INVALID' });
  }
  const db = driver({ change: sql => sql.includes('SET last_observed_at') ? { rows: [{ last_observed_at: '0' }], rowCount: 1 } : undefined });
  await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).read(), { code: 'IDENTITY_ENVELOPE_INVALID' });
  assert.equal(db.calls.at(-1).text, 'ROLLBACK');
});

test('unlogged, temporary, view or policy-bearing schema targets are rejected', async () => {
  const valid = { relkind: 'r', relpersistence: 'p', relrowsecurity: false, relforcerowsecurity: false };
  for (const override of [{ relkind: 'v' }, { relkind: 'p' }, { relpersistence: 'u' }, { relpersistence: 't' }, { relrowsecurity: true }, { relforcerowsecurity: true }]) {
    const db = driver({ change: sql => sql.startsWith('SELECT relkind') ? { rows: [{ ...valid, ...override }], rowCount: 1 } : undefined });
    await assert.rejects(createPostgresIdentityStore({ pool: db.pool }).read(), { code: 'IDENTITY_SCHEMA_UNSUPPORTED' });
    assert.equal(db.calls.some(c => c.text.includes('clock_timestamp') || c.text.startsWith('UPDATE')), false);
  }
});
