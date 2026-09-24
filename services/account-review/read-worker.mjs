import { parentPort, workerData } from 'node:worker_threads';
import { openStore } from './store.mjs';
import { planReview } from './model.mjs';

let store;
try {
  store = openStore({ directory: workerData.directory, existingOnly: true });
  const { revision, data } = store.read();
  parentPort.postMessage({ ok: true, review: { revision, ...planReview(data) } });
} catch { parentPort.postMessage({ ok: false }); }
finally { store?.close(); }
