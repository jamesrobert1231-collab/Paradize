# Preserved text and CRM import history

## Text sources

`scripts/import/text-record.ps1 -Source <selected .txt or .md file>` imports bounded,
strict UTF-8 text through the existing owner-protected knowledge workflow. It
retains original bytes, including a BOM and line endings, while indexing literal
text. Source links and instructions are not followed. Linked path ancestors,
concurrent writers, malformed encoding, binary controls and oversized inputs fail.
The launcher requires the provisioned bundled Node runtime, as other import tools do.

Repeated content is idempotent; changed content retains another revision. Imported
claims remain unverified and do not confer historical authority. No original store
is replaced, and no private records are included in this repository.

## CRM reconciliation preview

`reconcileTechHelp` now requires `importMappings` alongside contacts and suppressed
emails in its caller-supplied snapshot. Each mapping contains a 64-character
lowercase SHA-256 `sourceId` and `recordSha256`, an existing `contactId`, and a
boolean `doNotContactRecorded`. An empty array is valid only when no prior mappings
exist. Duplicate source IDs and orphaned or malformed mappings fail validation.

Explicit mappings preserve contact identity when an inquiry's email changes.
Changed hashes remain review items. Historical do-not-contact evidence survives
when a source inquiry disappears from a newer export. Current opt-outs propagate
across inquiries mapped to the same CRM contact, even with different emails.
Suppression on the mapped contact's current email is also retained. Returned
current and historical source IDs make those restrictions traceable.

`doNotContactRecorded` must retain historical restrictions, rather than reflect
only the newest inquiry status. The future database adapter must prove snapshot
completeness and consistency; the `complete:true` input is only a caller assertion.
Email matching remains a review signal, never permission to merge identities.
Every proposal denies dispatch and writes. No database migration, scheduled job,
outbound messaging, real-record cutover or rollback qualification is claimed.

## Validation

67 affected Node tests passed on Windows: 18 CRM/Tech Help tests, 45 Sunny tests,
and four text-import tests. These include the regression where two inquiry IDs
with different emails share an explicitly mapped contact and one opts out.
Text tests cover preserved Unicode/BOM/CRLF bytes, repeat/revised imports,
malformed and oversized inputs, writer locks, and linked ancestors.
Production database and live Unity/iPhone journeys remain release gates.
