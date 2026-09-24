# PARADIZE

PARADIZE is a private, local-first systems environment with a Unity island as its 3D interface and Sunny as its conversational companion. This public repository contains the developing application source and selected licensed art assets. It contains no personal knowledge records, credentials, recovery archives, or account sessions.

**Status: foundation under development, not a completed consolidation release.**

## Included

- A seeded limestone island, beaches, lagoon, district navigation, coastal textures, moving water, approximate moon phases and illustrative lunar/solar tides.
- A rigged, dressed Sunny character candidate with a breathing animation. Other characters remain procedural prototypes; photorealism and finished animation are not qualified.
- A loopback-only, owner-token-protected Sunny service using an installed local Ollama model. Paid providers and fallback calls are disabled.
- Staged owner/device identity and a private HTTPS browser companion with single-use pairing, session revocation and local Sunny chat. Live database, trusted-launcher and iPhone qualification remain open. See [identity and browser access](docs/integrations/identity-foundation.md).
- Explicit knowledge search, grounded answers, preserved-source verification and protected source-copy support. Personal documents must be imported separately.
- Consent-preserving Tech Help staging and CRM reconciliation proposals, bounded artifact/job records, encrypted synthetic recovery and [streamed multipart backup verification](docs/integrations/streaming-recovery.md) without another full local download.
- A Windows-encrypted account action register with case history, approval checks and an owner-protected review endpoint. Provider actions, scheduling and a Unity action-inbox panel remain separate integrations. See [account review](services/account-review/README.md).
- Synthetic tests, Windows launch/build helpers, and repository-scoped Codex/Graft instructions.

`sources.lock.json` records upstream revisions and license evidence. Upstream repositories and private source snapshots are **not bundled or automatically executed**. Selected MakeHuman graphical assets and Poly Haven coastal textures retain their CC0 notices and provenance. The no-ai-slop adaptation retains its MIT notice in source.

## Develop on Windows

1. Install Unity **6000.6.0f1** with Windows build support.
2. Provision the isolated Node runtime with `scripts/globe/setup-runtime.ps1`. It verifies the archive and executable hashes and does not replace global Node.
3. For local conversation, install Ollama and one of the supported local models (`qwen2.5:3b` or `qwen3.5:4b`). The daemon must confirm cloud access is disabled before conversation is admitted; see [local-only inference](docs/integrations/local-only-inference.md). Missing models are reported as unavailable; there is no cloud fallback.
4. Open `apps/paradize-unity` through **Open PARADIZE in Unity.cmd**. In the editor, choose **PARADIZE > Create island scene** before Play mode. Generated scene resources are deliberately excluded from Git; this command regenerates the baseline, so preserve custom scene work first.
5. To build the Windows player, run `scripts/Build-Paradize.ps1`. Its capacity check requires 14 GiB free for the measured working margin plus a 10 GiB operating reserve. After a successful build, **Start PARADIZE.cmd** launches the service and player.

Use right mouse + WASD to fly, Q/E for altitude, Shift for speed, and F1 for Sunny's panel. District controls move the viewpoint. The lunar slider is a preview; return to live UTC afterwards. The tide is illustrative, not a navigation or coastal safety prediction.

The local token is provisioned under the normal Windows account in excluded `.runtime/` storage. This native bridge is separate from the staged browser/iPhone gateway. Do not expose its port through a proxy or copy its token into an asset, installer, or Git. The gateway remains unbound until its database, bootstrap and production TLS boundaries are qualified.

## Verify

With Node 24 on PATH, run all synthetic Node checks from the repository root:

```powershell
$testFiles = Get-ChildItem services,modules,tests -Recurse -Filter '*.test.mjs' -File | ForEach-Object FullName
node --test --test-concurrency=2 @testFiles
./tests/unity/verify-source-copies.ps1
```

The browser TLS tests require PowerShell 7; set `PARADIZE_TEST_PWSH` to its absolute executable path if needed. They generate short-lived synthetic certificates in memory and do not alter the Windows certificate store. The second command requires the installed Unity editor and Windows .NET Framework tools. It checks protected source-copy storage under .NET and Unity Mono and compiles the runtime C# against Unity's .NET Standard 2.1 references. Neither command proves real-device access or a complete release journey.

## Codex navigation

See [Graft setup](docs/integrations/graft.md). Use `graft init --agents agents --no-global` for repository-scoped Codex instructions, then `graft build`. On this Windows setup, the optional Kotlin parser needs the documented compatibility repair. The generated graph is a local cache, not checked in.

See [release status](docs/release-status.md) for verified results and remaining integration work.
