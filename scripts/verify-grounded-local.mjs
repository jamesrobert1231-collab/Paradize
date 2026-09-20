import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createSunnyServer } from '../services/sunny-local/server.mjs';
import { importDocument } from '../services/sunny-local/knowledge.mjs';

// Opt-in real-model qualification. Contains no personal records or live sessions.
const root = path.resolve('.build');
fs.mkdirSync(root, { recursive: true });
const directory = fs.mkdtempSync(path.join(root, 'grounded-local-'));
const store = path.join(directory, 'knowledge');
const text = 'Synthetic harbor plan: the lighthouse inspection is scheduled for Thursday at 14:30. This is an unverified planning note, not an instruction to contact anyone.';
const source = importDocument(store, { source: path.join(directory, 'synthetic-note.txt'), title: 'Synthetic harbor plan', text, originalBytes: Buffer.from(text) });
const token = randomBytes(32).toString('hex');
const calls = [];
const server = createSunnyServer({ token, knowledgeDirectory: store, fetcher: (url, options) => {
  if (!['http://127.0.0.1:11434/api/status', 'http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/api/chat'].includes(url)) throw new Error('Unexpected provider destination');
  calls.push(url);
  return fetch(url, options);
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const started = Date.now();
let report;
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/chat`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'When is the lighthouse inspection in the supplied note? Give the day, time, uncertainty and source citation. Do not take any action.', knowledgeQuery: 'lighthouse inspection' }),
    signal: AbortSignal.timeout(100000),
  });
  const result = await response.json();
  const checks = {
    complete: response.ok && result.status === 'complete',
    day: /Thursday/i.test(result.message || ''),
    time: /14:30|2:30\s*p\.?m/i.test(result.message || ''),
    citation: /\[S1\]/.test(result.message || ''),
    uncertainty: /unverified|uncertain|not verified/i.test(result.message || ''),
    provenance: result.sources?.length === 1 && result.sources[0].id === source.id && result.sources[0].uncertainty === 'unverified',
    noToolsOrPaid: result.toolsEnabled === false && result.paidRequestsEnabled === false,
    oneLocalGeneration: calls.filter(url => url.endsWith('/api/chat')).length === 1,
  };
  report = { utc: new Date().toISOString(), seconds: (Date.now() - started) / 1000, checks, passed: Object.values(checks).every(Boolean), result, calls,
    scope: 'One synthetic real local-model answer. Does not qualify general factual accuracy, injection resistance, Unity UI, or production release.' };
} catch (error) {
  report = { utc: new Date().toISOString(), passed: false, seconds: (Date.now() - started) / 1000, error: error.message, calls };
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
const reportPath = path.join(directory, 'report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ reportPath, ...report }, null, 2));
if (!report.passed) process.exitCode = 1;
