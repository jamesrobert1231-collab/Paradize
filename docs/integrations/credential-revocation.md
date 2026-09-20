# Native credential revocation — 2026-09-20

The source review found that the local service cached its startup token forever. Replacing the protected credential file did not revoke a running service. The new credential guard closes that specific gap without introducing a substitute identity database or migrating legacy sessions.

`services/sunny-local/credentials.mjs` bounds file reads, rejects nonregular or linked inputs, checks changes during reads, compares credentials in constant time, and latches observed invalidation. `server.mjs` uses the guard for the actual standalone entry point, checks before admission and successful JSON replies, polls every 250 ms to cancel an ongoing conversation/upload, and shuts down the standalone listener on invalidation. A fresh trusted launch loads the replacement; a live service never silently accepts it.

Synthetic verification covers observed rotation/deletion and resurrection rejection; missing/malformed/oversized/mismatched credentials; hard links and directory junctions; stale/new tokens against an existing service and a fresh service; active inference cancellation without retries; partial-upload cancellation; response-time revocation; and real child-process shutdown/port reuse. No real token, live Sunny process, remote account, or original data store is touched by these tests.

This is one prerequisite for the final owner/device system. It does not provide stable principal mapping, transactional device pairing, browser cookies, persistent device revocation, mailbox grants or iPhone qualification. PostgreSQL 17 remains the intended shared-service store; no alternate database was substituted. Database installation/qualification remains gated by the operating reserve.

The Windows launcher's owner-only ACL contract still applies. The polling interval is not a hard real-time bound under an event-loop stall, and already-delivered responses cannot be recalled. An owner-level process is outside this adapter's containment boundary. Existing active installations are unchanged until explicitly restarted with this source.
