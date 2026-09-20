import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const valid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// ACL provisioning remains the trusted Windows launcher's responsibility.
// Read a bounded regular file, rejecting links and changes during the read.
function readToken(file) {
  const absolute = path.resolve(file);
  for (let cursor = path.dirname(absolute);;) {
    const info = fs.lstatSync(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid credential directory');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const before = fs.lstatSync(absolute, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 128n) throw new Error('Invalid credential file');
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Credential file changed');
    const bytes = Buffer.alloc(129);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(fd, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(absolute, { bigint: true });
    if (count > 128 || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1n ||
        [after, current].some(item => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => item[key] !== before[key]))) {
      throw new Error('Credential file changed');
    }
    const token = bytes.subarray(0, count).toString('utf8').trim();
    bytes.fill(0);
    if (!valid(token)) throw new Error('Invalid credential');
    return token;
  } finally { fs.closeSync(fd); }
}

export function credentialGuard({ token, tokenFile } = {}) {
  const initial = tokenFile ? readToken(tokenFile) : token;
  if (!valid(initial) || (token !== undefined && token !== initial)) throw new Error('A valid 256-bit owner credential is required');
  const expected = Buffer.from(initial, 'hex');
  let revoked = false;
  function current() {
    if (revoked) return false;
    if (tokenFile) {
      try { revoked = !timingSafeEqual(expected, Buffer.from(readToken(tokenFile), 'hex')); }
      catch { revoked = true; }
    }
    return !revoked;
  }
  return {
    current,
    accepts(value) { return current() && valid(value) && timingSafeEqual(expected, Buffer.from(value, 'hex')); },
    // A running server never adopts replacement credentials or resurrects a
    // credential after an observed failure. Trusted relaunch is required.
  };
}
