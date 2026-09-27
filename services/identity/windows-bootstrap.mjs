import fs from 'node:fs';
import { loadWindowsOwnerConfig } from '../../packages/auth/windows-owner-config.mjs';
import { createIdentityAuthority } from '../../packages/auth/authority.mjs';
import { createPostgresIdentityStore } from '../../packages/auth/postgres-store.mjs';

const MAX_REQUEST_BYTES = 256;
const INPUT_TIMEOUT_MS = 5000;
const OUTPUT_TIMEOUT_MS = 2000;
const knownErrors = new WeakSet();

function failure(code) {
  const error = new Error(`Owner bootstrap unavailable (${code}).`);
  error.code = code;
  knownErrors.add(error);
  return error;
}

function safeFailure(error) {
  if (knownErrors.has(error)) return error;
  if (error?.code === 'IDENTITY_COMMIT_UNCERTAIN') return failure('BOOTSTRAP_COMMIT_UNCERTAIN');
  if (error?.code === 'owner-identity-conflict') return failure('BOOTSTRAP_OWNER_CONFLICT');
  return failure('BOOTSTRAP_DATABASE_UNAVAILABLE');
}

/** Existing protected configuration only. Creation is a separate, explicit setup action. */
export async function initializeWindowsOwner({ pool, directory } = {}) {
  if (process.platform !== 'win32') throw failure('BOOTSTRAP_WINDOWS_REQUIRED');
  let config;
  try { config = loadWindowsOwnerConfig({ directory }); }
  catch { throw failure('BOOTSTRAP_OWNER_CONFIG_UNAVAILABLE'); }
  try {
    // No memory/JSON fallback, implicit migration, driver loading or environment DSN.
    const authority = createIdentityAuthority({ store: createPostgresIdentityStore({ pool }) });
    return await authority.local.initialize({ ownerId: config.ownerId, installationId: config.installationId });
  } catch (error) { throw safeFailure(error); }
}

function requireRedirectedStdio() {
  if (process.platform !== 'win32') throw failure('BOOTSTRAP_WINDOWS_REQUIRED');
  for (const fd of [0, 1]) {
    const info = fs.fstatSync(fd);
    // Windows anonymous pipes have no POSIX FIFO bit. Reject console and file
    // redirects; the trusted host must spawn with stdio: ['pipe', 'pipe', 'pipe'].
    if (info.isFile() || info.isDirectory() || info.isCharacterDevice()) throw failure('BOOTSTRAP_PIPE_REQUIRED');
  }
  if (process.stdin.isTTY || process.stdout.isTTY) throw failure('BOOTSTRAP_PIPE_REQUIRED');
}

async function readRequest(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > INPUT_TIMEOUT_MS) {
    throw failure('BOOTSTRAP_REQUEST_INVALID');
  }
  let timer;
  const pending = (async () => {
    const chunks = []; let length = 0;
    for await (const chunk of process.stdin) {
      if (!(chunk instanceof Uint8Array)) throw failure('BOOTSTRAP_REQUEST_INVALID');
      length += chunk.byteLength;
      if (length > MAX_REQUEST_BYTES) throw failure('BOOTSTRAP_REQUEST_TOO_LARGE');
      chunks.push(chunk);
    }
    let request;
    try { request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length))); }
    catch { throw failure('BOOTSTRAP_REQUEST_INVALID'); }
    if (!request || Array.isArray(request) || Object.keys(request).sort().join(',') !== 'operation,version' ||
        request.version !== 1 || request.operation !== 'initialize-owner') throw failure('BOOTSTRAP_REQUEST_INVALID');
  })();
  try {
    await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(failure('BOOTSTRAP_INPUT_TIMEOUT')), timeoutMs);
    })]);
  } catch (error) {
    process.stdin.destroy();
    throw knownErrors.has(error) ? error : failure('BOOTSTRAP_REQUEST_INVALID');
  } finally { clearTimeout(timer); }
}

async function writeResponse(response) {
  let timer;
  // A failed write invokes its callback and emits a separate stream error. Keep
  // this one-shot child's listener through teardown so neither escapes to stderr.
  const absorbError = () => {};
  process.stdout.on('error', absorbError);
  try {
    await Promise.race([
      new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(response)}\n`, error => error ? reject(error) : resolve())),
      new Promise((_, reject) => { timer = setTimeout(reject, OUTPUT_TIMEOUT_MS); }),
    ]);
    process.stdout.removeListener('error', absorbError);
  } catch (error) {
    process.stdout.destroy();
    throw error;
  } finally { clearTimeout(timer); }
}

/**
 * Host integration seam for a short-lived, same-owner Windows child. The trusted
 * host supplies its qualified PostgreSQL pool and owns shutdown/error handling.
 * One strict stdin request, one bounded stdout result, no listener or grant API.
 * This module deliberately has no standalone driver/bootstrap executable yet.
 */
export async function runWindowsBootstrap({ pool, directory, inputTimeoutMs = INPUT_TIMEOUT_MS } = {}) {
  try { requireRedirectedStdio(); } catch { return 2; }
  let response;
  try {
    await readRequest(inputTimeoutMs);
    const result = await initializeWindowsOwner({ pool, directory });
    response = { version: 1, ok: true, result };
  } catch (error) {
    response = { version: 1, ok: false, code: knownErrors.has(error) ? error.code : 'BOOTSTRAP_FAILED' };
  }
  try { await writeResponse(response); } catch { return 2; }
  return response.ok ? 0 : 1;
}
