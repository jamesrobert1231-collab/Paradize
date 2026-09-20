# Source update status — 2026-09-20

This update preserves the existing repository history and publishes a reviewed source subset of the private consolidation workspace. It does not activate connections, schedules, generated-code execution, deployments, or account access.

## Fresh checks

Latest follow-up: the updated source passed **100 Node tests**, including eight credential-revocation cases. The running service rejects rotated credentials, cancels inference/uploads, and exits so a trusted relaunch can bind the port. A synthetic reproduction against the earlier source confirmed that it previously accepted the old token after rotation. Final per-device identity remains incomplete; no live credential or running installation was changed. See [credential revocation](integrations/credential-revocation.md).

- 92 synthetic Node tests passed from the publication checkout with Node 24.5.0, including Sunny authorization/STOP/knowledge boundaries, Tech Help consent preservation, CRM reconciliation, artifact lifecycle and recovery validation.
- 12 source-copy tests passed under .NET Framework and the same 12 passed under Unity Mono. Runtime C# compilation against Unity's .NET Standard 2.1 references passed. The test runner now uses a unique temporary output directory so a deeply nested checkout does not overflow legacy Windows path limits.
- The public FBX was reserialized through Blender's installed FBX reader/writer to remove 28 absolute build/texture path properties. All 8,889 decoded properties were compared: only the approved path strings changed; geometry, material data, bone weights and animation remained identical. Original local model bytes were preserved. The model's `.meta` and material/texture references are included.
- The private working checkout's Graft 0.18.0 build produced 52 map cards plus INDEX.md, with 353 nodes and 680 edges. A public checkout intentionally omits the owner-data-only verification script; its fresh build produced 51 cards plus INDEX.md, 351 nodes and 671 edges.

The path-normalized FBX has not completed a fresh Unity import/render journey. A new player containing recent source-copy and grounding work has not been released. Full Unity build admission remains blocked on local capacity; do not reinterpret compile checks as player qualification.

## Continuing requirements

The intended product remains one private Unity environment with Sunny always available and all selected systems consolidated behind protected services. Major remaining work includes persistent owner identity, pairing/revocation, real iPhone/browser access, stronger Sunny capability reconciliation, knowledge/finance and CRM data cutovers, combined video workflows, qualified WSL/container execution, production encrypted Drive recovery, installer/upgrade/rollback journeys, performance and realistic visual acceptance.

The current encrypted recovery format is a bounded synthetic qualification tool, not production database/media/credential recovery. Job records and output checks are not a working sandbox. Upstream source inventory is not runtime integration. Real account connectivity must be configured and qualified separately.

The island's moon/tide model is illustrative. Finishing the consolidation release also does not complete every inherited Sunny/world ambition; those remain future roadmap requirements.

Overall product completion remains an approximate **39% planning estimate**, not a measured acceptance-test percentage.
