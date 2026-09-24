import { Worker } from 'node:worker_threads';

export function readReview({ directory } = {}) {
  // DPAPI and SQLite work runs off the server event loop so owner STOP remains responsive.
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./read-worker.mjs', import.meta.url), { workerData: { directory } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Private review read timed out')); }, 45000);
    worker.once('message', value => { clearTimeout(timer); value.ok ? resolve(value.review) : reject(new Error('Private review store unavailable')); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Private review reader stopped')); });
  });
}
