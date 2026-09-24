# Source update status — 2026-09-23

PARADIZE remains a developing private Unity environment with Sunny as its conversational interface. This public repository contains reviewed source and licensed assets. Updating it does not activate account connections, scheduled work, generated-code execution or a new installed player.

## Current source update

- Added the Windows account-review register: encrypted case history, per-source checkpoints, explicit approval evidence, dispatch-attempt records and notification deduplication. The owner-only Sunny bridge exposes its review plan without invoking a model or enabling external actions. See [account review](../services/account-review/README.md).
- Corrected acknowledgment of notifications for maximum-length source and case identifiers. Valid records can now be marked reported without repeating unchanged notices; invalid identifiers and mismatched fingerprints remain rejected. A failing regression reproduced the original error before the fix.
- Updated the developer documentation and rebuilt Codex's Graft navigation cache: 68 source map files plus INDEX.md, 444 nodes and 947 edges. Generated graph files remain local and can be rebuilt from source.

Fresh validation in the publication checkout on Windows with Node 24.5.0: **155 tests passed, zero failures or skips**. This includes actual DPAPI-encrypted temporary SQLite storage, reopen/readback, concurrent revision conflicts, corruption handling, the protected Sunny review route, approval and notification boundaries, plus the existing Sunny, import, CRM and recovery suites. The focused model suite passed all 18 tests after the notification fix. The staged diff passed whitespace validation and a review for private paths, credentials and records.

The register is not a standalone account connector or an autonomous executor. Its Windows-profile encryption is not a portable backup. There is no Unity action-inbox panel or verified mobile delivery yet. Tests use synthetic temporary state and do not modify live accounts, credentials or scheduler settings.

## Earlier integrated source

- The Knowledge district can request owner-protected index counts independently of model availability. It distinguishes an unavailable store from a valid empty index; original documents are checked when accessed. See [knowledge inventory](integrations/knowledge-inventory.md).
- Text imports preserve UTF-8 originals and provenance; CRM reconciliation retains historical identifiers and opt-out restrictions. See [import history](integrations/import-history.md).
- Sunny requires the local inference daemon to confirm cloud access is disabled before conversation data is sent. Credential rotation invalidates the running bridge. See [local-only inference](integrations/local-only-inference.md) and [credential revocation](integrations/credential-revocation.md).
- The human FBX in this public repository has normalized source paths and retained asset attribution. The private original is preserved. Fresh Unity import/render qualification of the public copy remains required.

Earlier source checks passed 51 bridge-contract assertions and 12 source-copy assertions on both .NET Framework and Unity Mono; runtime C# compiled against Unity's .NET Standard 2.1 references. Those are historical source checks, not fresh player or visual acceptance results. This update does not change Unity C# or assets.

## Remaining release requirements

Persistent owner identity and device pairing, real iPhone/browser access, reconciliation of the stronger Sunny capabilities, staged knowledge/finance and CRM cutovers, combined video workflows, qualified WSL/container execution, production encrypted Drive recovery, installer/upgrade/rollback journeys, performance and realistic visual acceptance remain incomplete.

The Windows build helper requires 14 GiB free, including the 10 GiB operating reserve. Job records and output checks alone do not qualify a sandbox. Upstream inventories do not establish runtime integration. Synthetic recovery tests do not qualify recovery of production databases, media or credentials without the original Windows profile. The island's moon/tide model remains illustrative.

Overall product completion remains approximately **39%**, a planning estimate rather than a measured percentage of passed acceptance criteria. Publishing source does not complete the consolidation release or the inherited unfinished Sunny/world requirements.
