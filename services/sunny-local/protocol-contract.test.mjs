import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSunnyServer } from './server.mjs';

test('actual Sunny health is accepted by the Windows launcher contract; prior response is rejected', { skip: process.platform !== 'win32' }, async t => {
  const token = 'd'.repeat(64);
  const server = createSunnyServer({ token, fetcher: async () => Response.json({ cloud: { disabled: false } }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const health = await (await fetch(`http://127.0.0.1:${server.address().port}/health`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(health.status, 'local-only-unconfirmed');
  assert.equal(health.service, 'paradize-sunny-local');
  assert.equal(health.protocolVersion, 2);
  assert.equal(health.localOnlyPolicyRequired, true);
  const script = fileURLToPath(new URL('../../scripts/Sunny-HealthContract.ps1', import.meta.url)).replaceAll("'", "''");
  const command = `. '${script}'; $h=[Console]::In.ReadToEnd() | ConvertFrom-Json; if(Test-SunnyHealthContract $h){exit 0}else{exit 2}`;
  for (const [payload, expected] of [[health, 0], [{ status: 'ready', provider: 'ollama', paidRequestsEnabled: false }, 2]]) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stderr);
  }
});
