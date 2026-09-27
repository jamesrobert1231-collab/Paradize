# Windows owner bootstrap

This is staged source for the private Windows launcher. It is not activated in
the installed player, native Sunny service or browser gateway. PostgreSQL 17,
its driver, restricted role, pool configuration and the production launcher
entry point still require qualification. No database or account is created by
importing these modules.

## Initialization order

1. The trusted setup process explicitly creates a new protected owner record
   with `createWindowsOwnerConfig()` from `packages/auth/windows-owner-config.mjs`.
   Ordinary startup uses `loadWindowsOwnerConfig()` and never regenerates IDs.
2. Persist that record before touching the identity database. The record holds
   distinct owner, installation and native-device UUIDs, not live session tokens
   or external account permissions. Its default location is the current user's
   local application data under `PARADIZE/identity`.
3. The trusted Windows launcher starts its reviewed, short-lived child with
   redirected stdin, stdout and stderr pipes. Its host code creates a dedicated,
   qualified PostgreSQL pool and calls `runWindowsBootstrap({ pool })`.
   The launcher and child own deadlines, pool error handling and shutdown.
   Do not accept a driver path, connection string or configuration directory
   from browser requests or the input message.
4. Send exactly `{"version":1,"operation":"initialize-owner"}` and close stdin.
   A valid request must finish within five seconds and at most 256 UTF-8 bytes.
   The handler returns one JSON result after database COMMIT acknowledgement.
5. Accept only an exit status of zero and a matching successful response.
   `result` contains `ownerId`, `installationId` and database `createdAt`.
   There is no pairing, native-session issuance or remote administration command
   in this bootstrap protocol. Those capabilities require later integration.

`initializeWindowsOwner({ pool, directory })` is also an in-process seam for a
trusted host. `directory` is host configuration, useful for synthetic tests; it
is never supplied by the pipe request. The function loads an existing protected
record before connecting to the database and always constructs the existing
PostgreSQL identity adapter. There is no alternate JSON, SQLite or memory store.

The pipe handler uses only the child process's inherited standard handles. It
opens no listener and rejects console/file redirection. This is a same-Windows-
owner integration contract, not protection against malicious code already
running as that owner. It does not authenticate an arbitrary TCP socket handed
to the process as a standard handle. The launcher must create the child and its
private anonymous pipes itself; the gateway must never host this handler.

## Failure and recovery

- Missing, unreadable, corrupt or ambiguous protected storage stops bootstrap
  before any database connection. Setup never repairs it by generating a new
  owner. Preserve it for recovery.
- A different owner or installation already in PostgreSQL is a conflict. The
  stored owner is not replaced.
- Database failures return a fixed code without query, driver, connection or
  credential details. Commit uncertainty is separate and is not automatically
  retried. A lost child response also does not establish success; reconcile
  the stable record and database explicitly before continuing.
- This step creates no grants. Recovery must still revoke historical sessions,
  require fresh pairing and reconnect accounts as needed. Copying a DPAPI blob
  does not establish recoverability under another Windows profile.
- A caller that imports this module must supply a bounded, dedicated pool,
  register sanitized pool error handling and close the pool when the child ends.
  No `pg` dependency is implicitly installed or loaded.

## Validation boundary

`tests/auth/windows-bootstrap.test.mjs` exercises the real Windows protected
record and actual inherited child pipes. The database collaborator is explicitly
a scripted driver fixture in test files. That proves orchestration and refusal
behavior, not SQL syntax, real database transactions, durability, concurrent
bootstrap, cross-process revocation or restricted-role isolation.

Windows configuration tests cover actual CurrentUser encryption and filesystem
protection separately. Production PostgreSQL, launcher lifecycle, native Sunny
session binding, browser/iPhone journeys and profile-independent encrypted
recovery remain required before cutover.
