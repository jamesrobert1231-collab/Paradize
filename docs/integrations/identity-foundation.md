# Owner identity and private browser access

The owner/device/session authority and browser gateway are staged source. They
are not the active Unity login, and this source update does not expose a port,
change credentials or start an account connection.

`packages/auth/authority.mjs` separates trusted-local administration from remote
pairing, typed sessions and self-revocation. One owner retains distinct device
and session identities. Pairing is atomic and single-use; only credential hashes
persist. Revocation history remains intact, expiry has a monotonic active-request
deadline and the store rejects clock regression. Login grants no mailbox,
calendar, finance, sharing or device-control access.

`packages/auth/postgres-store.mjs` and the explicit migration target PostgreSQL
17 in a dedicated identity database with a restricted runtime role, separate
from CRM. A permanent singleton anchors serialized updates, including bootstrap.
The adapter returns grants only after acknowledged COMMIT and never retries an
uncertain commit. Missing/corrupt established state is not a fresh installation.

`services/gateway/` connects the remote authority to browser pairing and local
Sunny conversation. It requires direct HTTPS, exact origin/Host, protected
cookies and a session-bound request nonce. Neither forwarding headers nor
native bearer tokens grant browser/launcher authority. It rechecks access
before inference and protected output, and cancellation affects only that
device's pending reply. Browser model output is text; conversation history is
bounded and kept only in page memory.

Tests exercise real HTTPS through the adapter to the real native Sunny HTTP
server, with synthetic identity storage and synthetic model output. A reviewed
upload/revocation race now rejects work before dispatch. Database tests exercise
driver protocol/error behavior; UI checks use a synthetic DOM. None establishes
real database durability, actual browser rendering or iPhone access.

Remaining activation work includes PostgreSQL 17 installation and role/locking/
restart qualification, protected stable owner configuration, Windows bootstrap
channel ACLs, production TLS/private routing, module account mappings, actual
iPhone pairing/reload/reconnect/revocation, and restore-time session invalidation.
The storage reserve remains a prerequisite to dependent installations/builds.
The existing native launcher authentication continues unchanged.

See the [authority contract](../../packages/auth/README.md),
[database qualification](../../packages/auth/README-postgres.md),
[browser gateway](../../services/gateway/README.md) and
[release status](../release-status.md).

## September 24 follow-up — protected owner initialization

`packages/auth/windows-owner-config.mjs` and `protect-owner-config.ps1` now
provide explicit fresh creation and read-only loading of distinct stable owner,
installation and native-device identifiers. The record uses Windows CurrentUser
DPAPI and exact owner/SYSTEM filesystem permissions. Existing empty directories,
pending files, corrupt records, unexpected permissions, hardlinks and reparse
paths stop setup; they are not repaired or replaced automatically.

`services/identity/windows-bootstrap.mjs` connects that existing protected record
to the PostgreSQL authority. Its short-lived child protocol accepts one bounded
`initialize-owner` request through inherited standard pipes and waits for EOF
before acting. It creates no session or pairing grant and opens no listener.
Conflicting owner/installation IDs and uncertain commits remain distinct failures.
A reviewed broken-pipe defect was reproduced and corrected so a disconnected
launcher does not cause an unhandled error stack.

This source is not wired into the live launcher. The production PostgreSQL pool,
driver and database still require qualification, as does native Sunny session
binding. Copying the DPAPI record does not qualify recovery under another Windows
profile. See [bootstrap contract and limits](../../services/identity/README.md).

September 27 verification: all **20 focused Windows configuration/bootstrap
tests passed** on Node 24.5.0, with no failures or skips. This includes actual
CurrentUser encryption, protected ACLs, process restart, competing creators,
interruption after reserving storage, corrupted records and inherited child
pipes. Database behavior in these checks still uses a scripted driver, not a
PostgreSQL server. No production identity record or live session was created.

Overall consolidation remains approximately **39%**, a planning estimate. This
source foundation does not complete persistent-login or release acceptance.
