# Private browser gateway — staged source

This transport connects a paired browser to Sunny's existing local service.
It is not installed, listening or activated by importing these modules. The
Unity launcher and native token behavior remain unchanged.

`createGatewayServer({origin,tls,identity,sunny})` returns an unbound HTTPS
server. Supply only `authority.remote` and a `createSunnyAdapter` result.
The authority's local capability must stay in the owner-restricted Windows
bootstrap process; it must never be available to this router. A loopback peer,
forwarded header or browser session is not trusted-launcher authority.

The configured origin must be one canonical HTTPS origin without a trailing
slash. This implementation terminates TLS directly and rejects proxy assertions,
native Authorization headers, mismatched Host/Origin and security-header
duplicates. Production certificate selection, private hostname routing and
trust on the actual iPhone still require qualification. Do not disable TLS
verification or place this service behind a proxy that changes the contract.

## Pairing and browser routes

An explicit trusted-local invitation selects a one-, seven- or thirty-day
session. Its ten-minute, single-use code belongs in the `/pair#<code>` fragment,
never a query, server log or saved configuration. The client immediately removes
the fragment, inspects the invitation and waits for an explicit Connect action.
Inspection grants no session. Exchange consumes the invitation atomically in
the authority and sets separate bearer and CSRF cookies.

The bearer uses `__Host-`, Secure, HttpOnly, SameSite=Strict and Path=/; the
separate script-readable nonce uses the same host, secure and same-site scope.
Every mutation requires the exact configured Origin, JSON, a custom browser
header and (after pairing) the session-bound CSRF nonce. Session secrets are
never returned in JSON. Pairing attempts and request sizes are bounded.

| Route | Purpose |
| --- | --- |
| `POST /api/device-access/inspect` | Show a valid invitation's duration and expiry. |
| `POST /api/device-access/exchange` | Pair a device once. |
| `GET /api/session` | Restore authenticated session information after reload. |
| `GET /api/sunny/health` | Show verified local Sunny availability. |
| `POST /api/sunny/chat` | Request local conversation with bounded in-memory history. |
| `POST /api/sunny/cancel` | Cancel only this device's current reply. |
| `POST /api/device-access/disconnect` | Persist self-revocation and clear its cookies. |

There are no browser routes for initialization, invitation issuance, native
credential creation, another device's revocation, global STOP, account grants,
knowledge originals, uploads, generated previews or WebSockets. These remain
separate integration work with their own access checks.

Active requests receive expiring, revocation-aware leases, propagate abort to
the Sunny adapter and revalidate before protected output. The native Sunny
service still admits one inference at a time across all clients. Its global
STOP is not used for browser cancellation. This transport is not a process
sandbox and cannot contain arbitrary code that ignores cancellation.

The adapter accepts only an explicit literal loopback endpoint and native token.
It calls only native `/health` and `/chat`, validates the local-only protocol,
bounds response reads, strips native diagnostics and sources, and has no paid
provider fallback or retry. The existing Sunny server must independently
confirm the inference daemon's cloud policy before sending conversation data.

## Qualification

Run `node --test tests/auth/*.test.mjs tests/gateway/*.test.mjs` on Windows with
Node 24 and PowerShell 7. The TLS helper generates a short-lived synthetic
localhost certificate in memory with .NET; it never installs a certificate or
persists a private key. Set `PARADIZE_TEST_PWSH` to an absolute PowerShell 7
executable path when it is not in either documented default location.

Tests include real HTTPS and real native Sunny HTTP, with synthetic identity
storage and synthetic Ollama responses. They do not qualify PostgreSQL, a live
model, a trusted Windows bootstrap channel, actual browser rendering or iPhone
access. DOM-harness checks, where present, likewise do not replace a browser.

Before activation, qualify PostgreSQL 17 and its restricted runtime role,
protected owner/installation configuration and vault, bootstrap-channel ACLs,
production TLS/private routing, module identity mappings, restore-time session
invalidation and actual iPhone pairing/reload/reconnect/revocation. Login grants
no mailbox, finance, sharing or device-control authority.
