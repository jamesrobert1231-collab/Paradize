const MAX_STATE_BYTES = 1024 * 1024;
const CONNECT_TIMEOUT_MS = 5000;
const QUERY_TIMEOUT_MS = 7000;
const MAX_REVISION = 9223372036854775807n;
const knownErrors = new WeakSet();

function failure(code) {
  const error = new Error(`Identity storage unavailable (${code}).`);
  error.code = code;
  knownErrors.add(error);
  return error;
}

function safeError(error) {
  return knownErrors.has(error) ? error : failure('IDENTITY_STORAGE_UNAVAILABLE');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function serializeState(state) {
  if (!isObject(state)) throw failure('IDENTITY_STATE_INVALID');
  const active = new Set();
  function inspect(value, depth) {
    if (depth > 64) throw failure('IDENTITY_STATE_INVALID');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || !value || (!Array.isArray(value) && !isObject(value)) || active.has(value)) {
      throw failure('IDENTITY_STATE_INVALID');
    }
    if (Object.getOwnPropertySymbols(value).length) throw failure('IDENTITY_STATE_INVALID');
    active.add(value);
    const keys = Object.keys(value);
    if (Object.getOwnPropertyNames(value).length !== keys.length + (Array.isArray(value) ? 1 : 0)) {
      throw failure('IDENTITY_STATE_INVALID');
    }
    if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) {
      throw failure('IDENTITY_STATE_INVALID');
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw failure('IDENTITY_STATE_INVALID');
      inspect(descriptor.value, depth + 1);
    }
    active.delete(value);
  }
  inspect(state, 0);
  const json = JSON.stringify(state);
  if (Buffer.byteLength(json, 'utf8') > MAX_STATE_BYTES) throw failure('IDENTITY_STATE_TOO_LARGE');
  return json;
}

function oneRow(result, code = 'IDENTITY_ENVELOPE_INVALID') {
  if (!result || result.rowCount !== 1 || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure(code);
  return result.rows[0];
}

function decodeEnvelope(result) {
  const row = oneRow(result);
  if (!row || row.singleton !== 1 || row.schema_version !== 1 || typeof row.revision !== 'string' ||
      !/^(0|[1-9][0-9]{0,18})$/.test(row.revision) || BigInt(row.revision) > MAX_REVISION ||
      typeof row.last_observed_at !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(row.last_observed_at) ||
      !Number.isSafeInteger(Number(row.last_observed_at))) {
    throw failure('IDENTITY_ENVELOPE_INVALID');
  }
  if (row.state_json === null && row.revision === '0') return { state: null, serialized: null, revision: row.revision, observed: row.last_observed_at };
  if (row.revision === '0' || typeof row.state_json !== 'string' || Buffer.byteLength(row.state_json, 'utf8') > MAX_STATE_BYTES) {
    throw failure('IDENTITY_ENVELOPE_INVALID');
  }
  let state;
  try { state = JSON.parse(row.state_json); } catch { throw failure('IDENTITY_ENVELOPE_INVALID'); }
  return { state, serialized: serializeState(state), revision: row.revision, observed: row.last_observed_at };
}

async function acquire(pool) {
  let expired = false;
  let timer;
  const pending = Promise.resolve().then(() => pool.connect()).then(client => {
    if (expired) {
      try { client?.release(true); } catch { /* No driver error or connection detail escapes. */ }
      throw failure('IDENTITY_CONNECT_TIMEOUT');
    }
    return client;
  });
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(failure('IDENTITY_CONNECT_TIMEOUT')); }, CONNECT_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

/**
 * PostgreSQL 17 transaction boundary. No database is contacted until read/transact.
 * The caller owns pool configuration, shutdown, identity schema validation and grants.
 */
export function createPostgresIdentityStore({ pool } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw failure('IDENTITY_POOL_INVALID');

  async function run(update) {
    let client, began = false, released = false;
    function release(destroy) {
      if (released || !client) return;
      released = true;
      try { client.release(destroy); } catch { throw failure('IDENTITY_RELEASE_FAILED'); }
    }
    async function query(text, values) {
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(() => client.query(text, values)),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              try { release(true); } catch { /* Timeout remains the public outcome. */ }
              reject(failure('IDENTITY_QUERY_TIMEOUT'));
            }, QUERY_TIMEOUT_MS);
          }),
        ]);
      } finally { clearTimeout(timer); }
    }
    try {
      client = await acquire(pool);
      if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') throw failure('IDENTITY_POOL_INVALID');
      await query('BEGIN ISOLATION LEVEL READ COMMITTED'); began = true;
      const version = oneRow(await query("SELECT pg_catalog.current_setting('server_version_num') AS version"));
      if (typeof version.version !== 'string' || !/^17[0-9]{4}$/.test(version.version)) throw failure('IDENTITY_POSTGRES_VERSION_UNSUPPORTED');
      await query("SET LOCAL search_path = pg_catalog; SET LOCAL row_security = off; SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s'; SET LOCAL idle_in_transaction_session_timeout = '5s'; SET LOCAL transaction_timeout = '10s'; SET LOCAL synchronous_commit = on");
      // Lock the pre-existing NULL anchor as well as an initialized state: no insert/upsert bootstrap race.
      // Reads also take the exclusive lock because their clock observation must persist atomically.
      const envelope = decodeEnvelope(await query('SELECT singleton, schema_version, revision::text AS revision, state::text AS state_json, last_observed_at::text AS last_observed_at FROM paradize_identity.owner_state FOR UPDATE'));
      // Check after acquiring the relation lock: an unlogged table/view is not the durable migration target.
      const relation = oneRow(await query("SELECT relkind, relpersistence, relrowsecurity, relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'paradize_identity.owner_state'::pg_catalog.regclass"));
      if (relation.relkind !== 'r' || relation.relpersistence !== 'p' || relation.relrowsecurity !== false || relation.relforcerowsecurity !== false) {
        throw failure('IDENTITY_SCHEMA_UNSUPPORTED');
      }
      // A separate statement is deliberate: now()/transaction_timestamp() predates any lock wait.
      const clock = oneRow(await query('SELECT pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()) * 1000)::text AS now'));
      if (typeof clock.now !== 'string' || !/^[1-9][0-9]{0,15}$/.test(clock.now) || !Number.isSafeInteger(Number(clock.now))) {
        throw failure('IDENTITY_CLOCK_INVALID');
      }
      const now = Number(clock.now);
      if (now < Number(envelope.observed)) throw failure('IDENTITY_CLOCK_REGRESSED');
      const observation = oneRow(await query('UPDATE paradize_identity.owner_state SET last_observed_at = $1::bigint WHERE singleton = 1 AND schema_version = 1 AND last_observed_at = $2::bigint RETURNING last_observed_at::text AS last_observed_at', [clock.now, envelope.observed]));
      if (observation.last_observed_at !== clock.now) throw failure('IDENTITY_ENVELOPE_INVALID');
      let result = { state: structuredClone(envelope.state), now };
      if (update) {
        let next;
        try { next = update(structuredClone(envelope.state), now); } catch { throw failure('IDENTITY_UPDATE_REJECTED'); }
        if (!isObject(next) || typeof next.then === 'function' || !Object.hasOwn(next, 'state') || !Object.hasOwn(next, 'value')) {
          // Attach a rejection handler to accidentally returned Promises without awaiting them.
          if (next instanceof Promise) next.catch(() => {});
          throw failure('IDENTITY_UPDATE_INVALID');
        }
        let serialized;
        if (next.state === null && envelope.state === null) serialized = null;
        else serialized = serializeState(next.state);
        if (serialized !== envelope.serialized) {
          if (BigInt(envelope.revision) === MAX_REVISION) throw failure('IDENTITY_REVISION_EXHAUSTED');
          const changed = oneRow(await query('UPDATE paradize_identity.owner_state SET state = $1::jsonb, revision = revision + 1 WHERE singleton = 1 AND schema_version = 1 AND revision = $2::bigint RETURNING revision::text AS revision', [serialized, envelope.revision]));
          if (changed.revision !== String(BigInt(envelope.revision) + 1n)) throw failure('IDENTITY_ENVELOPE_INVALID');
        }
        result = next.value;
      }
      try { await query('COMMIT'); } catch {
        // The server may have committed before the acknowledgement was lost. Never retry automatically.
        throw failure('IDENTITY_COMMIT_UNCERTAIN');
      }
      began = false;
      release(false);
      return result;
    } catch (error) {
      if (began && !released) {
        try { await query('ROLLBACK'); } catch { /* Destroy the connection even if rollback is unconfirmed. */ }
      }
      try { release(true); } catch { /* Preserve the sanitized operation failure. */ }
      throw safeError(error);
    }
  }

  return Object.freeze({
    read: () => run(null),
    transact(update) {
      if (typeof update !== 'function') return Promise.reject(failure('IDENTITY_UPDATE_INVALID'));
      return run(update);
    },
  });
}
