import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const helper = fileURLToPath(new URL('./protect-owner-config.ps1', import.meta.url));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fields = ['version', 'ownerId', 'installationId', 'nativeDeviceId'];
function failure(code) { return Object.assign(new Error(code), { code }); }

/** Validate and copy, so callers cannot mutate the protected record in memory. */
export function validateWindowsOwnerConfig(record) {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
      Object.getPrototypeOf(record) !== Object.prototype ||
      Reflect.ownKeys(record).length !== fields.length ||
      fields.some(field => !Object.hasOwn(record, field))) throw failure('OWNER_CONFIG_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(record);
    if (fields.some(field => !Object.hasOwn(descriptors[field], 'value') || !descriptors[field].enumerable)) {
      throw failure('OWNER_CONFIG_INVALID');
    }
    const copy = Object.fromEntries(fields.map(field => [field, descriptors[field].value]));
    if (copy.version !== 1 || fields.slice(1).some(field => typeof copy[field] !== 'string' || !UUID.test(copy[field])) ||
        new Set(fields.slice(1).map(field => copy[field])).size !== 3) throw failure('OWNER_CONFIG_INVALID');
    return Object.freeze(copy);
  } catch {
    throw failure('OWNER_CONFIG_INVALID');
  }
}

function invoke(operation, options) {
  if (process.platform !== 'win32') throw failure('OWNER_CONFIG_WINDOWS_REQUIRED');
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => key !== 'directory')) throw failure('OWNER_CONFIG_OPTIONS_INVALID');
    const directory = options.directory ?? (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'PARADIZE', 'identity'));
    // The helper independently checks every path segment and holds ancestor handles.
    if (typeof directory !== 'string' || !/^[a-z]:\\/i.test(directory) ||
        directory.length > 220 || /[\x00-\x1f]/.test(directory)) throw failure('OWNER_CONFIG_DIRECTORY_INVALID');
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const powershellDirectory = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
    const child = spawnSync(path.join(powershellDirectory, 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper], {
        input: JSON.stringify({ operation, directory }), encoding: 'utf8', windowsHide: true,
        env: { ...process.env, PSModulePath: path.join(powershellDirectory, 'Modules') },
        timeout: 30000, maxBuffer: 16384,
      });
    if (child.error || child.signal || child.status !== 0 || child.stderr.trim() || child.stdout.length > 1024) {
      throw failure('OWNER_CONFIG_UNAVAILABLE');
    }
    return validateWindowsOwnerConfig(JSON.parse(child.stdout.replace(/^\uFEFF/, '').trim()));
  } catch {
    // Paths, DPAPI exception text and decrypted input never escape through errors.
    throw failure('OWNER_CONFIG_UNAVAILABLE');
  }
}

/** Explicit one-time provisioning. Existing directories, even empty, are never reused. */
export function createWindowsOwnerConfig(options = {}) { return invoke('create', options); }

/** Read only: never creates directories, repairs ACLs, or replaces damaged records. */
export function loadWindowsOwnerConfig(options = {}) { return invoke('load', options); }
