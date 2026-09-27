// TEST ONLY. Scripted driver protocol, not a PostgreSQL server or durability proof.
export function createBootstrapProtocolFixture({ state = null, mode = 'ready' } = {}) {
  let saved = structuredClone(state), revision = state ? 1n : 0n, observed = 0;
  const calls = [];
  let connections = 0;
  const pool = { async connect() {
    connections++;
    if (mode === 'connection-error') throw new Error('synthetic-dsn-secret-must-not-leak');
    let pending = structuredClone(saved), nextRevision = revision, nextObserved = observed;
    return {
      async query(sql, values) {
        calls.push(sql);
        const row = value => ({ rows: [value], rowCount: 1 });
        if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED' || sql.startsWith('SET LOCAL ')) return { rows: [], rowCount: null };
        if (sql.includes('server_version_num')) return row({ version: '170011' });
        if (sql.startsWith('SELECT singleton')) return row({ singleton: 1, schema_version: 1, revision: String(revision), last_observed_at: String(observed), state_json: saved === null ? null : JSON.stringify(saved) });
        if (sql.startsWith('SELECT relkind')) return row({ relkind: 'r', relpersistence: 'p', relrowsecurity: false, relforcerowsecurity: false });
        if (sql.includes('clock_timestamp')) return row({ now: '1800000000123' });
        if (sql.startsWith('UPDATE paradize_identity.owner_state SET last_observed_at')) {
          nextObserved = Number(values[0]); return row({ last_observed_at: values[0] });
        }
        if (sql.startsWith('UPDATE paradize_identity.owner_state SET state')) {
          pending = JSON.parse(values[0]); nextRevision++;
          return row({ revision: String(nextRevision) });
        }
        if (sql === 'COMMIT') {
          saved = structuredClone(pending); revision = nextRevision; observed = nextObserved;
          if (mode === 'commit-uncertain') throw new Error('synthetic-commit-secret-must-not-leak');
          return { rows: [], rowCount: null };
        }
        if (sql === 'ROLLBACK') return { rows: [], rowCount: null };
        throw new Error('Unexpected synthetic protocol statement');
      },
      release() {},
    };
  } };
  return { pool, calls, get state() { return structuredClone(saved); }, get connections() { return connections; } };
}
