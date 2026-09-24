# Owner and device authority

This is staged source for the approved PostgreSQL 17 identity service. It is not
the active Unity login and must not be exposed before its database and trusted
launcher boundary are qualified. No module initializes storage on import.

`createIdentityAuthority({store})` returns two separate capability objects:

- `local`: explicit owner initialization, pairing creation/cancellation, native
  session issuance, device listing, device revocation and global revocation.
  Only an owner-restricted Windows launcher channel may receive this object.
  A loopback address, forwarded header or browser cookie does not establish
  that authority. There is deliberately no HTTP bootstrap endpoint here.
- `remote`: pairing inspection/exchange, typed session authentication, browser CSRF checks,
  self-revocation and active-session leases. A browser session cannot issue a
  native credential or revoke an unrelated device through this capability.

Initialization requires the stable owner and installation UUIDs from protected
local configuration. Generate them once during an explicit fresh installation;
do not generate new ones when established state is missing, corrupt, expired or
revoked. Conflicting initialization fails. Stable owner, device and session IDs
are separate. Existing historical identities still require an explicit mapping
migration; importing history must not issue credentials or grants.

## Credentials and transactions

Pairing and session secrets use 256 random bits. The store contains only
domain-separated SHA-256 digests; bearer and CSRF secrets are returned once to
the trusted caller after the transaction commits. Do not log these results or
place them in receipts, URLs, assets, configuration committed to Git or installers.
The staged [browser gateway](../../services/gateway/README.md) puts the bearer
in a Secure, HttpOnly, SameSite=Strict cookie and enforces the configured origin
and session-bound CSRF nonce. Browser/native tokens are not interchangeable.
The gateway is not activated; actual transport/device qualification is pending.

Pairing links last ten minutes. The caller explicitly chooses the inherited
one-, seven- or thirty-day browser session duration; at most ten unused links
may be active. Native sessions currently last one day and require trusted local
issuance. Short-lived sessions do not change the persistent owner identity.
Pairing consumption and session creation occur in one serialized store update.
No credential is returned after a failed or uncertain commit; callers must not
retry an uncertain commit as though rollback had been established.

Revocation and expired records are retained. Global revocation advances the
owner generation without replacing the owner. Invalid, duplicate or inconsistent
records fail closed. State is bounded to 128 devices, 512 sessions and 512 pairing
records, plus a one-MiB serialized limit. Reaching a limit requires a reviewed
archival/migration procedure; it never silently deletes history or resets access.
That archival procedure is not implemented yet.

Authentication returns no mailbox, calendar, finance, sharing or device-control
account grants. Those remain separate consent and connector records.

## Cancellation and qualification

`watchSession` returns an AbortSignal and explicit `close()` method. It rechecks
the authoritative store, aborting on expiry, revocation, corruption or a failed
read. The known expiry also has an independent monotonic deadline, so a pending
database read cannot keep that lease alive. The default revocation polling
interval is one second, with bounded store-operation delays.
Consumers must honor the signal, close it when finished, and revalidate before
publishing protected output or admitting an external operation. A signal alone
does not qualify process cancellation, downloads or WebSockets.

The authority tests use an explicitly serialized in-memory fixture to exercise
rules, rollback boundaries and leases. They do not prove disk persistence,
cross-process atomicity or a real browser/iPhone journey. The PostgreSQL adapter
has separate protocol/error tests and [qualification instructions](README-postgres.md).
Actual PostgreSQL 17, protected configuration/vault, Windows bootstrap channel,
production gateway transport, module identity adapters and live client checks remain required
before activation. Existing launcher-token authentication remains unchanged.

The design reconciles Sunny's separate Node device sessions and Python atomic
pairing behavior. Detailed source inventories are retained privately; this
implementation does not import or execute preserved application servers or
migrate their live state. See the [identity foundation](../../docs/integrations/identity-foundation.md).
