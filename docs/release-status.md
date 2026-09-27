# Source update status — 2026-09-27

PARADIZE remains a developing private Unity environment with Sunny as its conversational interface. This public repository contains reviewed source and licensed assets. Updating it does not activate account connections, scheduled work, generated-code execution or a new installed player.

## Current source update

- Added the island agent directory with all ten established identities and district mappings. Selecting characters and navigating districts now preserve Sunny's current answer. Unconnected workers remain visibly unavailable and gain no capabilities. See [agent directory](integrations/agent-directory.md).
- The exact publication copy passed 95 focused checks, 51 bridge checks and 12 source-copy checks on both .NET Framework and Unity Mono, plus 25 health-contract checks and full runtime C# compilation against Unity's .NET Standard 2.1 references. The baseline navigation failure was reproduced before the fix.
- Graft now contains 96 public source maps, 817 nodes and 1827 edges. Live player layout, input, selection, STOP/resume, asset loading and performance remain unqualified. No installed player or worker was activated.

## September 27 native Sunny sessions

- Added explicit native-session identity to Sunny, with per-request revocation/expiry leases, cancellation, and authorization checks before inference, private JSON/original-file output and STOP/resume changes. Invalid or unavailable identity cannot fall back to the legacy credential. See [native session binding](integrations/native-session-binding.md).
- Independent review reproduced and closed a race between awaited authorization and protected output/control changes. Early denial of an incomplete upload also now closes the connection promptly. All **21 focused identity tests and 77 Sunny tests passed** on Node 24.5.0, with no failures or skips.
- The identity tests exercise real authority and HTTP behavior with synthetic memory storage and model responses. PostgreSQL 17, native-session issuance/delivery, production Node 22, installed launcher, real-device and profile-independent recovery qualification remain open. The current launcher credential and protocol version 2 remain in use.
- The complete publication suite passed **317 tests with zero failures or skips** on bundled Node 24.14.0. Independent source review passed after reproducing the corrected races. Graft rebuilt 94 public source maps, 771 nodes and 1800 edges; generated graph files remain excluded.

This update changes staged source; it does not create live identities, pair a device, activate accounts or replace the installed player.

## September 27 protected owner bootstrap

- Added explicit creation and read-only loading of stable owner, installation and native-device IDs protected by Windows CurrentUser encryption and owner/SYSTEM permissions. Corrupt records, unexpected permissions, links and interrupted setup fail without replacing the owner.
- Added a bounded inherited-pipe owner-initialization protocol using the existing PostgreSQL adapter. It creates no sessions, opens no listener and returns sanitized failure codes. Commit uncertainty is not automatically retried. See [Windows bootstrap](../services/identity/README.md).
- All 20 focused configuration/bootstrap tests passed on Windows with Node 24.5.0. They exercise real encryption, filesystem permissions and child pipes; database behavior uses a scripted driver. Production Node 22, PostgreSQL, launcher lifecycle and native-session binding remain unqualified.
- Added the approved continuation rules to AGENTS.md: targeted graph context, bounded milestones, distinct delegation, proportionate verification, durable checkpoints and compact reporting while preserving release requirements.
- The complete publication suite passed **296 tests with zero failures or skips** on bundled Node 24.14.0. Graft rebuilt 93 public source maps, 734 nodes and 1721 edges; the generated cache remains excluded from Git.

This source does not activate the bootstrap in the installed product or migrate a live owner, session or account. CurrentUser encryption alone does not qualify restoration under another Windows profile.

## September 24 character source update

- Added a modular Blender export inventory with stable component identities, source/artifact hashes, an offline inspector and fresh qualification output paths. See [modular character authoring](integrations/modular-characters.md).
- Corrected derived body weights after accessory fitting and occlusion. Normalization retains every positive influence and preserves its relative proportion; five-influence vertices remain visible for Unity qualification.
- All 13 affected tests passed on Node 24.5.0/Python 3.13.5. A fresh Blender 5.2.1 LTS export and independent saved-Blender/FBX comparison passed: weight sums are within `1e-7`, all 76 five-influence vertices remain, and geometry/materials/skeleton/accessory weights are unchanged.
- The 50 watched earlier candidate files remained unchanged. Generated qualification artifacts stay private and the installed/public character was not replaced. Visual realism, Unity deformation, Humanoid retargeting and VRM remain unqualified.
- Graft now indexes 87 public source files, with 700 nodes and 1629 edges. Its generated cache remains excluded from Git.

An optional character preview was skipped when available RAM fell below the 2 GiB qualification floor. This update changes authoring source and evidence; it does not release a new player or enable a paid generation service.

## September 24 identity and browser source update

- Added staged persistent-owner authority, typed device sessions, atomic pairing, revocation history and a PostgreSQL 17 storage adapter/migration. Trusted-local administration stays separate from remote capabilities. See [identity foundation](integrations/identity-foundation.md).
- Added a direct-HTTPS browser gateway and accessible pairing/Sunny pages. Protected cookies, exact-origin checks and a session-bound request nonce guard browser mutations. Access is rechecked before inference and protected output; cancellation affects only the requesting device. No native/global STOP or account permissions are exposed.
- Added a bounded local Sunny adapter with protocol validation and no paid fallback. Real HTTPS-to-native-Sunny tests use synthetic identity storage and model output. Independent review reproduced and closed a revocation-during-upload admission defect.
- Rebuilt Codex's Graft navigation cache: 85 source map files plus INDEX.md, 672 nodes and 1542 edges. Generated graph files remain local and can be rebuilt from source.

That update's validation in the publication checkout on Windows with Node 24.5.0: **263 tests passed, zero failures or skips**. The 95 identity/gateway checks also passed on bundled Node 24.14.0. These include 20 authority tests, 23 database-driver protocol tests and 52 transport/adapter/UI checks; nine UI checks use a synthetic DOM. Production Node 22 qualification remains separate.

This update does not prove actual PostgreSQL syntax/locking/durability, protected Windows bootstrap, production TLS, browser rendering/cookie enforcement or iPhone behavior. The gateway is not activated and no live account/credential is migrated. Private source inventories, records, sessions, backup identifiers and keys are excluded from publication.

## Earlier integrated source

- The streamed multipart backup verifier checks cloud-part and complete-file hashes without another full local download. The September 23 live 28-part, 231,465,552-byte backup passed hash/terminal checks. That establishes byte integrity, not a reconstructed-file or full installation restore; production/profile-independent recovery remains open. See [streaming recovery](integrations/streaming-recovery.md).
- The Windows account-review register preserves encrypted case history, checkpoints, approval evidence and notification state. Maximum-length notification identifiers are covered by regression tests. Its protected Sunny route does not enable provider actions, scheduling or a Unity action-inbox panel; Windows-profile encryption is not portable recovery. See [account review](../services/account-review/README.md).
- The Knowledge district can request owner-protected index counts independently of model availability. It distinguishes an unavailable store from a valid empty index; original documents are checked when accessed. See [knowledge inventory](integrations/knowledge-inventory.md).
- Text imports preserve UTF-8 originals and provenance; CRM reconciliation retains historical identifiers and opt-out restrictions. See [import history](integrations/import-history.md).
- Sunny requires the local inference daemon to confirm cloud access is disabled before conversation data is sent. Credential rotation invalidates the running bridge. See [local-only inference](integrations/local-only-inference.md) and [credential revocation](integrations/credential-revocation.md).
- The human FBX in this public repository has normalized source paths and retained asset attribution. The private original is preserved. Fresh Unity import/render qualification of the public copy remains required.

Earlier source checks passed 51 bridge-contract assertions and 12 source-copy assertions on both .NET Framework and Unity Mono; runtime C# compiled against Unity's .NET Standard 2.1 references. Those historical checks predate the directory changes; fresh source checks for this update are reported above. They do not establish player or visual acceptance.

## Remaining release requirements

Persistent owner identity and device pairing, real iPhone/browser access, reconciliation of the stronger Sunny capabilities, staged knowledge/finance and CRM cutovers, combined video workflows, qualified WSL/container execution, production encrypted Drive recovery, installer/upgrade/rollback journeys, performance and realistic visual acceptance remain incomplete.

The Windows build helper requires 14 GiB free, including the 10 GiB operating reserve. Job records and output checks alone do not qualify a sandbox. Upstream inventories do not establish runtime integration. Synthetic recovery tests do not qualify recovery of production databases, media or credentials without the original Windows profile. The island's moon/tide model remains illustrative.

Overall product completion remains approximately **39%**, a planning estimate rather than a measured percentage of passed acceptance criteria. Publishing source does not complete the consolidation release or the inherited unfinished Sunny/world requirements.
