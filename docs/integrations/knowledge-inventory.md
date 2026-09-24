# Imported knowledge availability

The Unity Knowledge district now checks the actual imported index instead of
displaying a static claim that all imports are pending. Visiting the district or
using Refresh imported records requests the owner-authenticated local endpoint
`GET /knowledge/status`. This check works independently of AI model availability.

The endpoint reports retained record and distinct source counts. Revisions count
as separate records. It returns no source paths, titles, excerpts, or original bytes.
Only an existing valid empty index reports `no-records`; a missing, damaged or
linked store returns unavailable with no counts. Standard native-loopback, owner,
forwarded-request rejection and credential-revocation checks remain in effect.
There are no provider calls or data writes.

This is index validation, not a full-original audit: original fingerprints are
checked by the existing search/download paths when accessed. Claims remain
unverified, and history supplies no new authority. Search remains separately
available if model chat is unavailable; this does not imply every historical
document has been imported or that original stores can be retired.

Unity validates the response version, state/count consistency, count bounds and
verification scope. Rejecting defaults prevent omitted fields from appearing to
be an explicitly empty index. Concurrent refreshes are suppressed, requests time
out, and reconnect/disable/destroy invalidates pending status replies. Status checks
do not change chat history, grant access, or resume stopped inference.

Sunny health presentation also distinguishes unconfirmed local-only policy, missing
local models, unavailable inference service and explicit pause. Unknown models or
health states cannot make chat appear ready.

Validation on September 23, 2026: all 52 Sunny tests passed, including seven new
inventory tests. All 51 C# bridge contract checks passed under .NET Framework and
Unity Mono. Non-Editor runtime source compiled against .NET Standard 2.1. Source-copy
checks passed on both runtimes. Actual Unity JSON parsing, coroutine behavior,
layout, repeated scene reload and the authenticated player journey remain unverified.
The current player has not been rebuilt; these are source changes pending deployment.
