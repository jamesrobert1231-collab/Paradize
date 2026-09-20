# Tech Help browser evidence adapter

## Persistent staging

### Windows import command

Run `scripts/import/Import-TechHelp.ps1 -ExportFile <downloaded-export.json> -ExpectedOrigin <verified-original-origin>`. The expected origin must come from the original browser page, not a guessed deployment URL. The wrapper provisions `.runtime/tech-help` with owner/SYSTEM permissions when empty, verifies ownership and access grants on existing entries, invokes the project Node runtime, and rechecks permissions after import. Output contains counts/status/hash only, never contact contents. Existing nonempty staging with unexpected grants is rejected rather than silently repaired.

September 15 qualification used only `tests/fixtures/tech-help-synthetic.json`, origin `https://help.example.test`, containing one explicitly synthetic suppressed contact. The first import reported `imported:true`; Windows PowerShell repeat reported `imported:false`. Folder readback showed protected inheritance, the normal Windows owner, and only owner/SYSTEM FullControl grants. Eight module tests also passed. Synthetic snapshot hash: `c71a225550a15e154bacd8dec0a287c9f6b7ee97386759bfcac3a6bada3457e9`. This fixture must never be counted as a real inquiry or admitted into production CRM data.

Normal-owner filesystem access is verified in this environment; malicious same-user mutation, power-loss recovery, physical device export, and CRM cutover are not qualified by this check.

`stagePipelineExport(directory, bytes, expectedOrigin)` validates a packet and stores its exact bytes under its SHA-256 name in an existing private directory. Repeated identical packets are verified without rewriting the original; changed packets remain separate snapshots. `readStagedPipeline` reconstructs the derived records from preserved bytes and checks their hash on each read. Neither function writes to the live browser or CRM.

Writes use an exclusive import lock, exclusive pending file, flush, byte readback, and rename. An interrupted lock or pending file requires reconciliation and is never automatically deleted/reused. Corrupted originals block import rather than being replaced. Linked directories and hard-linked files are rejected. This does not constitute a sandbox against another process running as the same Windows user or a power-loss recovery qualification.

The caller must provision and verify owner-only Windows permissions before real personal data is staged. Keep staging under the Git-excluded `.runtime` tree. No real export has been staged or activated. Full module verification: `node --test modules/tech-help/*.test.mjs` — eight tests passed, including repeat imports, separate snapshots, corrupt originals, interrupted state, invalid origin, and hard-link rejection.

Based on the inspected original `app/page.tsx` in the privately retained original Tech Help workspace: `PipelineContact` at line 27, browser storage read at 49, intake fields at 53–68, and status choices at 105. This module does not replace the original application.

`browser-export.js` runs on the original origin and browser profile. It downloads the exact `ovth-pipeline` string inside an envelope recording origin and capture time. It does not write storage or transmit records. A missing key stays `null`; it is never converted to an empty contact list.

`inspectPipelineExport(bytes, expectedOrigin)` validates a captured packet against an explicitly supplied original origin. It returns stable origin-scoped IDs, source/record hashes, original records including unknown fields, historical consent flags, and do-not-contact status. Duplicate IDs or malformed fields stop admission. The entire original export must be preserved before eventual persistence or cutover.

Verification: `node --test modules/tech-help/pipeline.test.mjs` covers the browser packet/adapter round trip using a simulated DOM, absent versus empty storage, consent combinations, suppression, stable identities and validation failures. This is not a real browser export. Current limitation: no original browser profile/origin has been reconciled and no real contacts have been imported. CRM persistence, membership mapping, reconciliation, single-writer cutover and rollback remain required. Dispatch stays disabled.
