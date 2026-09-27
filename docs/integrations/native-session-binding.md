# Native Sunny session binding

The staged Sunny server can use the persistent owner's native-device sessions.
The installed launcher continues to use its existing local credential until the
production database, session delivery and device journeys are qualified.

## Host integration contract

Pass the remote identity capability to `createSunnyServer({ identity, ... })`.
Only `authenticate` and `watchSession` are required; Sunny never receives the
trusted-local capability that initializes owners or issues sessions. Every
identity call requests the `native` device kind. Browser credentials cannot
authenticate directly to this service.

Supplying `identity` selects that mode exclusively, including when the supplied
value is invalid. Invalid configuration throws, and identity failures deny the
request. Do not pass `token` or `tokenFile` alongside identity. The legacy mode is
available only when identity is not configured; it is not a recovery fallback.

The lease polling interval defaults to 1,000 ms. The request deadline defaults
to 100,000 ms, with the existing 90,000 ms inference deadline. Revocation is
observed through authoritative reads and lease polling; this does not promise
instantaneous notification between polls. A lease also expires independently
of a stalled poll.

Each request owns its cancellation controller and lease. Access is checked
after upload, immediately before model transmission, before protected JSON or
original-file output, and before changing STOP state. Disconnects, expiry,
revocation, deadlines and shutdown cancel pending work. A collaborator that
ignores cancellation cannot retain chat admission or emit its late result.
Revoking one native session does not revoke a sibling session.

Call `server.sunnyClose()` before `server.close()` during host shutdown. It
stops admitting requests and cancels existing ones before HTTP connections
drain. A lease resolving after cancellation is closed when it arrives.

Loopback/Host restrictions, rejection of browser origins and forwarding headers,
single-chat admission, protocol version 2 and zero-paid/local-only inference
checks remain in force. The browser gateway keeps its own browser session and
must use an explicitly supplied native session for its Sunny adapter; it must
never forward browser credentials or expose owner initialization.

## Qualification boundary

Focused integration tests use the real identity authority and real HTTP with
synthetic records in its memory store. Held collaborators make cancellation
and revocation races reproducible. This evidence does not establish real
PostgreSQL durability, cross-process revocation or production session delivery.

Activation still requires PostgreSQL 17 and restricted-role qualification,
trusted native-session issuance and protected delivery, launcher restart and
expiry behavior, Unity/browser/iPhone journeys, and recovery that invalidates
historical sessions. No account grants, live credentials or data cutovers are
created by this source integration. See [identity foundation](identity-foundation.md)
and [release status](../release-status.md) for the current verified checkpoint.
