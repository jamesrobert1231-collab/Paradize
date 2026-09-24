# PostgreSQL owner-state storage

This adapter targets the approved **PostgreSQL 17** identity database. It has not
been run against PostgreSQL. The accompanying tests use a scripted driver and
prove JavaScript protocol/error handling only; they do not prove SQL syntax,
locking, durable writes, restart, database permissions or concurrent bootstrap.
There is no installed `pg` dependency, automatic migration, database connection
configuration, credential provisioning or active identity service here.

## Contract

`createPostgresIdentityStore({ pool })` accepts a node-postgres-compatible pool.
The caller owns its configuration, error handlers and shutdown. Each operation
checks out one client, runs one transaction, then releases that client. The
adapter never uses `pool.query()` for transaction statements.

- `read()` returns `{ state, now }`. Every successful read persists the database
  clock high-water mark; it requires the runtime's limited UPDATE privilege.
  `state:null` means the valid reserved anchor
  remains uninitialized. A missing row, incompatible envelope/version, malformed
  JSON, or inaccessible schema is an error; it is never interpreted as bootstrap.
  A catalog check also requires the migration's ordinary, permanent table with
  no row-security policy. It does not replace a full migration/privilege audit.
- `transact(update)` exclusively locks the same anchor before invoking a
  synchronous, bounded, side-effect-free callback with a cloned state and fresh
  database epoch milliseconds. The callback returns `{ state, value }`; only
  `value` is returned after COMMIT acknowledgement. It must not send messages,
  perform network/file I/O, issue nested store operations or return a Promise.
- A null state may remain null for an uninitialized denial. An established
  object cannot become null. Unchanged serialized state does not rewrite the
  identity state or increment its revision; the clock observation is still
  persisted. Changed state increments the bigint revision.
- The identity authority validates its own state schema and permission rules.
  The adapter validates the storage envelope and JSON representation. Historical
  account IDs and approvals must not be promoted to new authority here.

The migration reserves the singleton before any owner exists. Therefore two
concurrent bootstrap callbacks must contend for the same existing row, rather
than each observing an absent row and independently inserting an owner. Both
reads and changes take `FOR UPDATE`, under explicit READ COMMITTED, because
even reads must serialize their durable clock observation.
A separate `clock_timestamp()` query follows lock acquisition so time does not
predate a lock wait. A clock older than the persisted `last_observed_at` fails
closed; it is never clamped and cannot silently extend or revive an expired
session. This cross-process high-water mark survives ordinary restart, but
restoring an older database requires the explicit recovery/session-reset policy.
These are implementation choices based on PostgreSQL's
[row-locking rules](https://www.postgresql.org/docs/17/explicit-locking.html)
and [clock semantics](https://www.postgresql.org/docs/17/functions-datetime.html).
Real database qualification remains required.

## Limits and failure behavior

The adapter bounds acquisition to 5 seconds and each awaited driver query to
7 seconds. Database settings within each transaction bound lock waits to
2 seconds, statements and idle transactions to 5 seconds, and the transaction
to 10 seconds. A client-side timeout destroys the connection; a late acquired
client is also destroyed. Fixed server-side limits follow the PostgreSQL 17
[client defaults documentation](https://www.postgresql.org/docs/17/runtime-config-client.html).
Pool construction must also use a finite `connectionTimeoutMillis` and a small
`max`, and register a sanitized pool `error` handler. The pool remains private to
identity work. Idle pool lifetime and process shutdown remain caller duties.

State must be a plain JSON object, nesting at most 64, serialized UTF-8 size at
most 1 MiB. Undefined values, nonfinite numbers, dates, getters, sparse arrays,
functions, cycles and hidden/symbol properties are rejected. PostgreSQL also
checks its JSONB text size at 1 MiB, so added JSONB whitespace can make its
effective acceptance limit slightly stricter. It may also reject JSON values
that JSONB cannot represent; failure rolls back. Neither limit is a promise
that this single-blob design scales to unbounded devices or audit history.

No driver message, DSN, query parameters, callback exception text or nested
cause is returned or logged. Exposed errors carry fixed `IDENTITY_*` codes.
Callback domain denials should be returned as `value` with unchanged valid
state; unexpected callback exceptions become `IDENTITY_UPDATE_REJECTED`.
An acknowledgement failure during COMMIT becomes `IDENTITY_COMMIT_UNCERTAIN`:
the write may have committed. Do not automatically replay a pairing or creation
operation. Reconnect, read validated state and reconcile through the authority.

`synchronous_commit=on` is required within operations. Actual durability also
depends on qualified server storage, `fsync`, WAL/recovery configuration and
backup restoration. The trusted callback runs in-process; an infinite callback
can block JavaScript even though PostgreSQL ends its idle/overlong transaction.
This adapter is not a generated-code sandbox or a boundary against its Windows
owner, a database administrator or arbitrary trusted application code.

## Explicit installation boundary

Resolve the storage reserve first. Provision a new dedicated identity database
on PostgreSQL 17, separate from CRM, with confirmed local connection metadata.
Do not inherit the CRM `.env` files or run its test database preparer: it can
drop an existing database. This adapter does not install PostgreSQL or `pg`.
Pin and qualify the chosen `pg` version in the release lockfile when installing.

Use separate roles:

| Role | Privileges |
| --- | --- |
| Migration owner | Owns the identity database/schema/table; no routine application login with these credentials. Apply reviewed SQL only through the installation/recovery process. |
| Identity runtime | LOGIN, CONNECT to this database, USAGE on `paradize_identity`, SELECT on `owner_state`, UPDATE of only `state`, `revision` and `last_observed_at`. No ownership, superuser, BYPASSRLS, replication, CREATEDB, CREATEROLE, role membership, database/schema CREATE, or INSERT/DELETE/TRUNCATE. |
| CRM runtime | No connection or schema access to identity storage. Its own intact database remains separate. |

For a concretely provisioned runtime role named `paradize_identity_runtime`,
the migration owner grants only:

```sql
GRANT USAGE ON SCHEMA paradize_identity TO paradize_identity_runtime;
GRANT SELECT ON paradize_identity.owner_state TO paradize_identity_runtime;
GRANT UPDATE (state, revision, last_observed_at) ON paradize_identity.owner_state TO paradize_identity_runtime;
```

Database administration must separately revoke PUBLIC access to the dedicated
database and grant required CONNECT privileges explicitly. Remove CREATE from
PUBLIC on its `public` schema; deny unrelated roles through role grants and
host authentication configuration. Do not log passwords or full connection
strings. Qualify PostgreSQL and tracing configuration so bound state parameters
are not recorded in statement/error logs. Use the protected credential provisioning path and supported local
authentication; remote transport would require independently qualified TLS.

Apply `migrations/001-owner-state.sql` once as the migration owner. It deliberately
has no `IF NOT EXISTS` or repair/upsert path. An existing schema or interrupted
installation must be investigated before retrying, not dropped or overwritten.
Confirm the committed anchor has singleton 1, schema version 1, revision 0,
last-observed epoch 0 and SQL NULL state. Do not call this initialization an
owner or device grant.

## Required real PostgreSQL qualification

Use a newly allocated disposable database and synthetic identities, with
explicitly reviewed final connection metadata and isolated configuration.

1. Apply the migration on PostgreSQL 17 and exercise the runtime role. Confirm
   all allowed operations and denied DDL, insert, delete, truncate, schema/version
   edits, cross-database access, elevated role changes and unexpected row policies.
2. Hold the singleton lock on connection A. Run a transaction on connection B,
   release A within its timeout, and confirm B sees the new revision and a clock
   sampled after the wait. Verify both lock-timeout and successful wait paths.
3. Start competing owner creation and competing one-use pairing requests from
   independent processes. Prove exactly one authorized transition, with the loser
   observing committed state rather than creating another owner/session.
4. Interrupt before UPDATE, after UPDATE and around COMMIT acknowledgement.
   Restart client and database, verify retained state/revision, and reconcile an
   uncertain commit without replaying an external action or duplicating a session.
5. In disposable stores only, test missing anchor/schema, unsupported schema
   versions, corrupt/null-inconsistent states, role loss, PostgreSQL 16/18,
   disk-full and unavailable-server outcomes. No case may reset the owner.
6. Verify a successful read after an expiry commits its time high-water mark;
   a subsequent backward database-clock observation must fail across independent
   processes and restart. Verify expiry during lock contention and active work, device revocation across
   processes/restart, session replay rejection, and real browser/iPhone flows with
   the owner authority/gateway. This storage adapter alone cannot prove them.
7. Measure WAL/data growth and latency; perform encrypted backup, fresh-destination
   restore and rollback preserving post-cutover writes. Restored devices require
   the product's fresh pairing/reconnection policy rather than restored grants.

Node-postgres requires every transaction statement on the same checked-out
client and returning/discarding it afterward; see its
[transaction guide](https://node-postgres.com/features/transactions) and
[pool lifecycle API](https://node-postgres.com/apis/pool). No real-database result
is claimed until these journeys have authoritative receipts.
