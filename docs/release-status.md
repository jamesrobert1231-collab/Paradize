# Source update status — 2026-09-23

PARADIZE remains a developing private Unity environment with Sunny as its conversational interface. This public repository contains reviewed source and licensed assets. Updating it does not activate account connections, scheduled work, generated-code execution or a new installed player.

## Current source update

- Added a streamed multipart backup verifier that checks every cloud part and the ordered complete-file hash without creating another local installer. It reuses the existing restore manifest validation and records `restored:false`. See [streaming recovery](integrations/streaming-recovery.md).
- Added bounded input and download handling, sanitized failure messages, and explicit Windows terminal framing and cleanup. Short terminal receipts correct wrapping that interrupted the initial live trial.
- Rebuilt Codex's Graft navigation cache: 70 source map files plus INDEX.md, 466 nodes and 1015 edges. Generated graph files remain local and can be rebuilt from source.

Fresh validation in the publication checkout on Windows with Node 24.5.0: **168 tests passed, zero failures or skips**, including 52 recovery tests and the existing account-review, Sunny, import and CRM suites. A live 28-part, 231,465,552-byte cloud backup passed per-part hashes, the expected complete-file hash and terminal exit. Independent source review found no material defects. Private backup manifests, cloud identifiers, signed URLs and local state are excluded from publication.

Streaming verification establishes byte integrity, not a reconstructed-file or complete installation restore. Process-level peak memory, production recovery and recovery without the original Windows profile remain unqualified. No local data is deleted by the verifier.

## Earlier integrated source

- The Windows account-review register preserves encrypted case history, checkpoints, approval evidence and notification state. Maximum-length notification identifiers are covered by regression tests. Its protected Sunny route does not enable provider actions, scheduling or a Unity action-inbox panel; Windows-profile encryption is not portable recovery. See [account review](../services/account-review/README.md).
- The Knowledge district can request owner-protected index counts independently of model availability. It distinguishes an unavailable store from a valid empty index; original documents are checked when accessed. See [knowledge inventory](integrations/knowledge-inventory.md).
- Text imports preserve UTF-8 originals and provenance; CRM reconciliation retains historical identifiers and opt-out restrictions. See [import history](integrations/import-history.md).
- Sunny requires the local inference daemon to confirm cloud access is disabled before conversation data is sent. Credential rotation invalidates the running bridge. See [local-only inference](integrations/local-only-inference.md) and [credential revocation](integrations/credential-revocation.md).
- The human FBX in this public repository has normalized source paths and retained asset attribution. The private original is preserved. Fresh Unity import/render qualification of the public copy remains required.

Earlier source checks passed 51 bridge-contract assertions and 12 source-copy assertions on both .NET Framework and Unity Mono; runtime C# compiled against Unity's .NET Standard 2.1 references. Those are historical source checks, not fresh player or visual acceptance results. This update does not change Unity C# or assets.

## Remaining release requirements

Persistent owner identity and device pairing, real iPhone/browser access, reconciliation of the stronger Sunny capabilities, staged knowledge/finance and CRM cutovers, combined video workflows, qualified WSL/container execution, production encrypted Drive recovery, installer/upgrade/rollback journeys, performance and realistic visual acceptance remain incomplete.

The Windows build helper requires 14 GiB free, including the 10 GiB operating reserve. Job records and output checks alone do not qualify a sandbox. Upstream inventories do not establish runtime integration. Synthetic recovery tests do not qualify recovery of production databases, media or credentials without the original Windows profile. The island's moon/tide model remains illustrative.

Overall product completion remains approximately **39%**, a planning estimate rather than a measured percentage of passed acceptance criteria. Publishing source does not complete the consolidation release or the inherited unfinished Sunny/world requirements.
