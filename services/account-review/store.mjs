import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const maximumBytes = 2 * 1024 * 1024;
const helper = fileURLToPath(new URL('./protect-state.ps1', import.meta.url));
const initial = () => ({
  version: 1, sources: {}, cases: {}, notifications: {},
  policy: { mode: 'prepare', paused: false, standingPermissions: [] },
});

function failure(message, code = 'REVIEW_STORE_INVALID') {
  return Object.assign(new Error(message), { code });
}

function serialize(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 ||
      !['sources', 'cases', 'notifications', 'policy'].every(key =>
        data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]))) {
    throw failure('Invalid account review state.');
  }
  // Only JSON values are accepted; reject silent loss of undefined, bigint, or nonfinite numbers.
  const serialized = JSON.stringify(data, (_key, value) => {
    if (value === undefined || typeof value === 'bigint' || typeof value === 'function' ||
        typeof value === 'symbol' || (typeof value === 'number' && !Number.isFinite(value))) {
      throw failure('Account review state must contain only JSON values.');
    }
    return value;
  });
  if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) throw failure('Account review state exceeds 2 MiB.');
  return serialized;
}

export function defaultDirectory() {
  const base = process.env.LOCALAPPDATA;
  if (!base) throw failure('LOCALAPPDATA is unavailable.');
  return path.join(base, 'PARADIZE', 'account-review');
}

/** Owner-local, synchronous encrypted storage. Transforms return the complete next JSON state. */
export function openStore({ directory = defaultDirectory(), existingOnly = false } = {}) {
  if (process.platform !== 'win32') throw failure('Account review storage requires Windows DPAPI.');
  if (typeof directory !== 'string' || !/^[A-Za-z]:[\\/]/.test(directory) ||
      directory.slice(2).includes(':') || directory.includes('\0') ||
      directory.split(/[\\/]/).some(part => part === '..' || /[. ]$/.test(part))) {
    throw failure('A dedicated absolute local Windows storage path is required.');
  }
  directory = path.resolve(directory);
  if (directory === path.parse(directory).root) throw failure('A dedicated storage directory is required.');
  const powershellDirectory = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0');
  const powershell = path.join(powershellDirectory, 'powershell.exe');
  function protect(operation, payload) {
    const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper], {
      input: JSON.stringify({ operation, directory, ...(payload === undefined ? {} : { payload }) }),
      // A PowerShell 7 parent can leave an incompatible Windows PowerShell module search path.
      env: { ...process.env, PSModulePath: path.join(powershellDirectory, 'Modules') },
      encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) throw failure('Account review storage protection failed; state was not reset.', 'REVIEW_STORE_PROTECTION');
    try { return JSON.parse(result.stdout); }
    catch { throw failure('Invalid response from account review storage protection.'); }
  }
  const encrypt = serialized => Buffer.from(protect('encrypt', serialized).value, 'base64');
  function decrypt(payload) {
    if (!(payload instanceof Uint8Array) || payload.byteLength > maximumBytes + 65536) throw failure('Invalid encrypted account review state.');
    let data;
    try { data = JSON.parse(protect('decrypt', Buffer.from(payload).toString('base64')).value); }
    catch (error) {
      if (error.code === 'REVIEW_STORE_PROTECTION') throw error;
      throw failure('Account review state is corrupt; state was not reset.');
    }
    serialize(data);
    return data;
  }
  const filename = path.join(directory, 'state.sqlite');
  if (existingOnly && !fs.existsSync(filename)) throw failure('Account review store has not been initialized.', 'REVIEW_STORE_MISSING');
  protect(existingOnly ? 'validate' : 'provision');
  const existed = fs.existsSync(filename);
  let database;
  let closed = false;
  function ensureOpen() { if (closed) throw failure('Account review store is closed.'); }
  function readRecord() {
    const rows = database.prepare('SELECT id, revision, payload FROM review_state').all();
    if (rows.length !== 1 || rows[0].id !== 1 || !Number.isSafeInteger(rows[0].revision) || rows[0].revision < 0) {
      throw failure('Invalid account review database; state was not reset.');
    }
    return { revision: rows[0].revision, data: decrypt(rows[0].payload) };
  }
  function transaction(action) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }
  try {
    database = new DatabaseSync(filename);
    database.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF; PRAGMA temp_store = MEMORY;');
    transaction(() => {
      const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length === 0 && !existed && !existingOnly) {
        database.exec('CREATE TABLE review_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision >= 0), payload BLOB NOT NULL) STRICT');
        database.prepare('INSERT INTO review_state (id, revision, payload) VALUES (1, 0, ?)').run(encrypt(serialize(initial())));
      } else if (tables.length !== 1 || tables[0].name !== 'review_state') {
        throw failure('Unexpected account review database; state was not reset.');
      }
      readRecord();
    });
  } catch (error) {
    database?.close();
    throw error;
  }
  return {
    read() { ensureOpen(); return readRecord(); },
    update(expectedRevision, transform) {
      ensureOpen();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER || typeof transform !== 'function') {
        throw failure('A valid expected revision and synchronous transform are required.');
      }
      return transaction(() => {
        const current = readRecord();
        if (current.revision !== expectedRevision) throw failure('Account review state changed; read it again before updating.', 'REVIEW_STORE_CONFLICT');
        const next = transform(current.data);
        if (next?.then) throw failure('Account review transforms must be synchronous.');
        const serialized = serialize(next);
        const payload = encrypt(serialized);
        const revision = expectedRevision + 1;
        const result = database.prepare('UPDATE review_state SET revision = ?, payload = ? WHERE id = 1 AND revision = ?').run(revision, payload, expectedRevision);
        if (result.changes !== 1) throw failure('Account review state changed; read it again before updating.', 'REVIEW_STORE_CONFLICT');
        return { revision, data: JSON.parse(serialized) };
      });
    },
    close() { if (!closed) { database.close(); closed = true; } },
  };
}
