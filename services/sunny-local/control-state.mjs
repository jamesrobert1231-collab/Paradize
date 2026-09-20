import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Stored inside the launcher's owner-restricted directory. No historical grant is imported.
export function controlState(file) {
  let stopped = false;
  if (file && fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('Invalid control state');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1 || typeof data.stopped !== 'boolean') throw new Error('Invalid control state');
    stopped = data.stopped;
  }
  return {
    get stopped() { return stopped; },
    set(value) {
      if (value) stopped = true; // A failed STOP write still closes admission in this process.
      if (file) {
        const temporary = path.join(path.dirname(file), `.control-${randomUUID()}.tmp`);
        try {
          const fd = fs.openSync(temporary, 'wx', 0o600);
          try { fs.writeFileSync(fd, JSON.stringify({ version: 1, stopped: value })); fs.fsyncSync(fd); }
          finally { fs.closeSync(fd); }
          fs.renameSync(temporary, file);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      }
      stopped = value; // Resume takes effect only after its durable write succeeds.
    },
  };
}
