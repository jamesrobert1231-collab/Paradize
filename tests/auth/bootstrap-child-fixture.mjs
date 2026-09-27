// TEST ONLY. No real database, production configuration or external connection.
import { runWindowsBootstrap } from '../../services/identity/windows-bootstrap.mjs';
import { createBootstrapProtocolFixture } from './bootstrap-protocol-fixture.mjs';

const [directory, mode, timeout] = process.argv.slice(2);
if (!directory || !['ready', 'connection-error', 'commit-uncertain'].includes(mode)) process.exitCode = 2;
else {
  const { pool } = createBootstrapProtocolFixture({ mode });
  if (process.send) process.send({ ready: true });
  process.exitCode = await runWindowsBootstrap({ pool, directory, inputTimeoutMs: Number(timeout) });
}
if (process.connected) process.disconnect();
