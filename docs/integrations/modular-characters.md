# Modular character inventory

The character pipeline now emits a verifiable inventory alongside future Blender exports. This change does not regenerate or replace the existing candidate, alter the Unity importer, install Tripo/UniVRM, or qualify realistic appearance.

## Current character and appearance contract

The current candidate uses preserved MakeHuman graphical assets. Its existing parts are body, clothing, footwear, hair and eyes; the head remains integrated into the body. `scripts/characters/build-human.py` authors a common 19-bone body rig and a breathing preview. It does not presently author a facial rig, finger animation, locomotion, secondary-motion chains, or a qualified VRM avatar.

`HumanCandidateValidation` still imports the FBX as Generic. It checks import mechanics; this manifest does not change that behavior. The realistic appearance target and zero-paid default remain in place. Realism review, Humanoid retargeting, facial animation, VRM roundtrip, secondary motion and resource measurements remain separate requirements.

## Future export output

After successful export, `scripts/characters/build-human.py` writes `human-candidate.modular.json` beside `human-candidate.blend` and `human-candidate.fbx`. The older `human-candidate.json` report is retained for compatibility.

The new version-1 profile is `makehuman-dressed-candidate-v1`, with `characterId: sunny`. It requires the five logical roles above, while permitting more than one mesh for a role. Additional roles or source providers require a reviewed profile change rather than silently accepting arbitrary metadata.

Each component ID combines its role with the full SHA-256 of its Blender object name. This distinguishes objects sharing a role and remains stable across repeated exports and changes in enumeration order. Renaming an object changes its ID; duplicate object names or ID collisions are refused.

The inventory records:

- Component role, Blender object/data names, vertex/polygon/triangle counts, UV layer names, bounds in Blender world coordinates, armature references and shape-key names.
- Actual deform-bone weight coverage, maximum influences and unnormalized vertex counts. These are observations, including any nonzero problems; an inventory pass is not a skinning-quality pass.
- Material names, node types, referenced image hashes and dimensions, and whether each image is packed. This inventories data blocks; it does not evaluate shader appearance or prove that every recorded node affects the rendered result.
- The common bone hierarchy and local rest endpoints, authored action names, frame range and scene frame rate. The coordinate record preserves the scene unit setting and export axes without declaring a validated T-pose or Humanoid mapping.
- Blender version, authoring-script hashes, exported-file hashes, and the preserved upstream source bundles with commit/archive identifiers and source manifests. Bundle inventory is broader than the exact set of inputs consumed by every operation.
- Explicit pending qualification fields, `activated: false`, `paidGenerationAllowed: false`, and `runtimePermissionGranted: false`.

Asset/image and script references are repository-relative; export references are relative to the manifest directory. No machine-specific absolute paths or private reference-image uploads belong in this profile. License labels apply to graphical assets, not MakeHuman application code. Emission refuses changed source-file hashes or unexpected license evidence.

## Preservation-safe qualification output

The default output remains `.build/characters` for compatibility with existing scripts. An explicitly requested qualification export can use a fresh directory without overwriting those assets:

```text
blender --background --python-exit-code 1 --python scripts/characters/build-human.py -- --output-directory .runtime/qualification/human-inventory-<unique-run>
```

The override accepts only a new directory under this workspace's `.runtime/qualification/`. Existing destinations, path traversal, Windows reserved names, streams, and reparse parents are refused. Interrupted outputs remain in that unique directory for inspection; a retry must choose another fresh name.

Before a real export, qualify available storage/RAM and preserve the existing model. A successful synthetic emitter test cannot establish that Blender successfully exported a real model.

## Derived body weight correction

A read-only qualification of the earlier candidate found the same stored body-weight deficit in its Blender mesh and decoded FBX: 4,552 of 8,468 vertices summed below 0.99, with a minimum sum of approximately 0.945808. Seventy-six vertices had five positive influences. Reducing these to four would discard up to 7.0013% of normalized influence mass; that projection does not measure visual deformation error.

Future builds run `normalize_deform_weights` only on the derived body after accessory fitting and body occlusion finish, before animation, save or export. Each positive deform weight is divided by that vertex's deform-weight total. Every positive influence is retained; zero entries, nondeforming bone groups and unrelated groups remain unchanged. Fitting still receives the original body distributions. Original source assets and previous candidate files are not edited by this source change.

The helper validates every vertex before applying updates. Invalid weights (including nondeforming groups), missing or ambiguous group references, zero deform totals, locked groups requiring changes and values that would lose a positive influence in float32 storage are rejected. After updates it checks actual stored sums within `1e-7` and unchanged influence counts. The existing candidate report gains `bodyWeightNormalization`, recording before/after sums, changed vertex count and zero pruned influences; the modular inventory schema remains unchanged.

This corrects authoring/export weight storage. Five influences remain possible, and Unity import settings, retained runtime influence count, deformation quality and visual realism still require separate qualification. A passing helper test is not a successful fresh Blender export, decoded-FBX check or Unity visual review.

## Executed qualification — 2026-09-24

The final authoring revision passed 13 focused tests on Node 24.5.0 with Python 3.13.5, including real helper execution with synthetic Blender-like objects, path and integrity failures, multi-mesh identities and proportional normalization. An independent source review found no actionable defects in these changes.

A fresh Blender 5.2.1 LTS export then exited 0 in 13.26 seconds. The inspector verified 37 files totaling 41,939,494 bytes. The candidate contains five meshes, 17,686 vertices, 33,050 triangles and 19 bones. Its body normalization changed 8,410 of 8,468 stored vertex weight sets without pruning influences.

Independent reading of the saved Blender file and FBX cluster arrays confirmed a maximum weight-sum error of `8.940696716e-8`, within `1e-7`. All positive bone identities and all 76 five-influence vertices were retained. Maximum pairwise weight-ratio error was `1.068250760e-7`, within the comparison's `3e-7` float32 tolerance. Stored FBX weights matched the new Blender file.

The comparison found unchanged geometry, UVs, material nodes, packed textures, skeleton and all four accessory weight distributions. All 50 watched earlier candidate files and the three frozen source scripts retained their hashes. New artifacts and detailed receipts remain in excluded local qualification storage; the installed character and public FBX were not replaced.

An optional preview render was skipped when available RAM fell below the 2 GiB qualification floor. This run qualifies inventory and normalized export storage, not realistic appearance, pose deformation, Unity runtime or VRM. The generic inspector continues to report `geometryIndependentlyDecoded: false`; the separate comparison receipt records the additional decoding evidence for this exact candidate.

## Offline inspection

Run from the repository root after an export:

```text
node scripts/characters/inspect-character-manifest.mjs .runtime/qualification/human-inventory-<unique-run>/human-candidate.modular.json --project-root .
```

The inspector has no network calls or external dependencies. It checks the supported schema/profile, required roles, unique object identities, common skeleton references, hierarchy consistency, material-source references, relative paths, and file sizes/SHA-256 hashes. It rejects symlinks/junctions inside the supplied roots, bounds each file and the total workload, and checks files for changes during reading. Fixed error codes do not print caller paths or raw metadata.

Its successful result is `inventory-verified`, with `geometryIndependentlyDecoded: false` and `runtimeQualified: false`. It does not decode `.blend`/FBX geometry, authenticate an unsigned manifest's author, prove license rights, or upgrade pending qualification. Review the source manifests and generation receipt separately; an attacker who can replace both data and all recorded hashes can create a different internally consistent inventory.

There is no migration of old exports implied by this change. Existing exports do not gain inventories or new qualification merely because these scripts exist.

## Tripo and VRM assessment — checked 2026-09-24

Tripo's P2 announcement describes automatically separated body/clothing/accessories, native quads, 500–50,000 triangle faces or 500–25,000 quad faces, and up to four reference views. It states that two single-image generations are free; continued access and multiview require a subscription. These are provider descriptions, not PARADIZE performance or deformation evidence. [Tripo P2](https://www.tripo3d.ai/blog/tripo-p2-0-preview)

Tripo pricing labels its free tier public/non-commercial and paid tiers private/commercial. Its terms reserve extensive rights over free users' inputs and outputs. Therefore P2 remains an optional provider whose actual account terms, privacy settings, export rights and budget must be qualified before use; no automatic private-reference upload or paid request is introduced. [Pricing](https://www.tripo3d.ai/pricing), [terms section 5.2](https://www.tripo3d.ai/terms)

Tripo documents FBX/GLB exports containing skeletons. This does not prove compliant VRM expressions, matching neck seams, usable facial/finger weights or deformation quality. Exact P2 API parameters were not verified from the accessible API documentation. [Auto-rigging](https://www.tripo3d.ai/features/ai-auto-rigging)

VRM supports PBR, Unlit and MToon materials, along with humanoid motion, expressions and gaze. PBR allows the realistic appearance target to remain intact; toon styling is an optional appearance choice. Spring bones provide secondary motion such as hair/clothing movement; this does not require cutting the body into separate moving skin sections. [VRM features](https://vrm.dev/en/vrm/vrm_features/), [spring-bone specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_springBone-1.0/README.md)

UniVRM is MIT-licensed and documents Unity 2022.3+ support, VRM 1.0 import/export, and PBR conversion to Built-in Standard materials. The current PARADIZE project is Unity 6000.6.0f1 with Built-in rendering and no UniVRM dependency; that makes UniVRM a candidate to qualify, not an already demonstrated integration. [UniVRM](https://github.com/vrm-c/UniVRM)

The Blender VRM add-on provides import/export and a Python automation interface. Neither it nor UniVRM changes an individual avatar's asset permissions. Preserve model license metadata independently of tooling licenses and PARADIZE account permissions. [Blender add-on](https://github.com/saturday06/VRM-Addon-for-Blender), [VRM metadata](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/meta.md)

## Next qualification work

1. Qualify the corrected candidate in Unity, including its 76 five-influence vertices and actual retained runtime weights; render and review it after resource gates pass.
2. Add Humanoid mapping, joint-bend/locomotion tests, facial/gaze work and realistic material previews without discarding the original candidate.
3. Qualify a pinned VRM adapter and roundtrip on this Unity version. Preserve existing following and STOP behavior.
4. Measure LOD, texture, draw-call and animation costs on this PC before expanding to every agent character.

The test suite exercises the real Python inventory function using synthetic Blender-like objects, plus manifest tampering, missing roles, hierarchy problems, path attacks, reparse paths and fresh-output selection. It does not import Blender, render characters, or assert device performance.

## Explicit cuff separation qualification — 2026-10-06

The derived character fitter now checks Blender's explicit loop triangles, including
recalculated garment triangulation after each bounded horizontal move. Its temporary
mesh is removed on success and failure; only garment coordinates are published after
all checks pass. Original footwear, topology, UVs, materials, weights and rig bindings
are preserved. The maximum displacement remains 20 mm, with a 1 mm shoe vertex-normal
envelope; this does not establish uniform physical clearance or containment.

A previous qualification failed because implicit polygon tessellation missed eight
padded-envelope triangle intersections. The failed evidence is retained. Separate
metadata diagnostics confirmed equivalent edge connectivity and loop vertex order;
material differences were transient Blender session identifiers. The corrected
comparison retains edge flags, loop connectivity, actual material settings and image
hashes while excluding transient session IDs.

Fresh checks passed: 40 actual-Blender fixture checks, 13 Node inventory/authoring tests,
and a 37-file inventory. Independent saved Blender and FBX decoding found zero direct
or padded-envelope rest-pose intersections. Only 128 garment vertices moved, by at most
14.001 mm horizontally; heights, other meshes, skin weights, skeleton, material nodes,
packed textures, UVs and polygon topology match the preserved baseline.

The three sampled breathing frames passed both intersection checks. One synthetic
right-ankle local-axis rotation still produced 15 padded-envelope triangle intersections;
this is an open movement finding. These diagnostic rotations are not anatomically
calibrated locomotion. The result is static-passed-with-pose-findings, not character
activation or full movement qualification. Unity import, runtime influence retention,
Humanoid/VRM, facial animation, realistic appearance and performance remain pending.

## Native weight preservation prototype — 2026-10-06

An isolated Unity 6000.6.0f1 headless project reproduced loss of the fifth influence
under the default importer. Custom import with eight allowed influences retained
the fifth influence, but discarded some positive weights below 0.001 even with
minimum weight set to zero or 1e-8. Neither setting alone qualifies preservation.

A source-aware native mesh prototype restores named weights from a separately
decoded Blender reference. It rejects ambiguous position matches with different
weight identities. Native mesh serialization can quantize the smallest weights
away; the prototype raises those positive weights to 1/65535 and subtracts the
increase from the largest influence, bounded to 0.0001 per vertex. Original source
files and weights remain unchanged. This is approximate runtime preservation,
not bit-exact weight preservation or a production adapter.

Fresh-process reload comparisons passed for all five meshes and all 17,686 source
vertex positions, including their positive named influence sets. Maximum absolute
weight error was 0.00002534; maximum position error was 0.000000358 metres. A separate
Unity check found matching exposed imported vertices, normals, tangents, byte colors,
UV channel values, effective submesh indices/topology, shared material references,
bind poses and bone order between the imported model and saved native prefab. Active
transform hierarchy comparisons also passed using Unity's approximate transform
operators. This does not compare inactive components, all renderer settings, material
internals, UV buffer formats or every submesh descriptor. A deliberately modified
in-memory vertex failed that check. Coincident source vertices are matched by position
and weights; this comparison alone does not prove source-to-FBX surface topology.

With the test's global skin-weight setting temporarily set to Unlimited, one synthetic
Chest local-X rotation of 15 degrees matched an independent linear-blend calculation
within 0.000000468 metres in Unity's CPU baking path. Scale compensation was explicitly
enabled. An earlier probe with the incorrect scale setting failed and remains retained.
The calculation uses the saved runtime weights; it does not establish equivalence to
Blender's posed geometry, GPU skinning, locomotion or all animations.

Production remains unchanged. Its current selected quality setting is TwoBones;
therefore a production adapter needs both source-bound preservation and an explicit
qualified renderer/global quality policy. Next steps are integrity-bound reference
export, bounded adapter implementation, all-influence validation, rendered player
and joint-pose checks, and the unresolved padded ankle clearance. Full-project graphics
qualification was stopped at its memory floor; serialized headless runs passed with
roughly 0.5–0.7 GiB main-process memory. These measurements do not establish final player
performance, realistic appearance, activation or release acceptance.

## Source-bound weight reference export

Future `build-human.py` exports also produce `human-candidate.weights.json` through
`scripts/characters/weight-reference.py`. Schema version 1 uses the
`makehuman-dressed-weight-reference-v1` profile and records Blender world-Z-up
positions, all positive named deform influences, five component roles, deform bone
names, and the sizes/SHA-256 hashes of the saved Blender and FBX artifacts. It also
records the helper's source hash. No private absolute paths are emitted.

The helper preserves the candidate's current weights without adjustment. The builder's
earlier body normalization still applies; `sourceWeightsAdjusted: false` describes
this helper only. Non-deform groups are omitted. Reference positions are raw mesh
vertices transformed into Blender world space, not evaluated poses or a topology,
UV, bind-pose or complete rig-hierarchy reference. Artifact hashes provide integrity
binding, not author authentication or independent geometry decoding.

The trusted builder requires five distinct roles and object names, the same armature,
finite positions/weights, one to eight positive deform influences per vertex, and
weight sums within 0.0001 of one. Vertex, bone, artifact and output sizes are bounded.
Both artifact fingerprints are checked again before exclusive sidecar creation.
Interrupted writes may leave an incomplete sidecar, which must not be treated as
qualified. Reusing an existing default export directory is now rejected before
authoring; use the documented fresh qualification output override.

Ten focused Python checks and thirteen existing Node checks passed. A fresh complete
Blender export passed the existing 37-file inventory check; a separate fresh Blender
process independently reopened its saved source and matched every reference position
and positive named deform weight for five meshes and 17,686 vertices. The sidecar is
not included in the older modular inventory's verified-file count. No Unity consumer
of this new schema is implemented yet; production native restoration, runtime quality
policy, GPU/player tests and release acceptance remain pending.

### Unity artifact identity gate

`CharacterArtifactIntegrity.Verify` checks an externally supplied reviewed lowercase
SHA-256 and exact artifact size before accepting a file. It bounds accepted artifacts
to 512 MiB, streams hashing in 64 KiB buffers, rejects observed file/ancestor reparse
paths and holds a read-only sharing handle during hashing. Eleven durable cases passed
both Windows C# compilation/execution and an isolated Unity 6000.6.0f1 headless run.
A separate actual Windows directory-junction case was rejected.

This is a file identity primitive, not yet an importer integration or a reference
schema validator. Expected hashes must come from reviewed provenance, not the same
untrusted file. The path checks do not provide race-free containment against a hostile
same-user process changing ancestors between inspection and opening. Nor does hashing
ensure that a later reader sees identical bytes after the handle closes. The consumer
must preserve the validated snapshot through parsing/restoration. No character or
installed runtime is activated by these checks.

### Verified reference loading

`CharacterWeightReferenceLoader.Load` reads an owned snapshot using a reviewed
reference size/hash, validates strict UTF-8 JSON syntax and closed schema fields,
decodes the same text with Unity's JSON decoder, then applies semantic validation.
It does not reopen the reference file. Duplicate decoded keys, unknown/missing
fields, wrong types, fractional integer fields and integer overflow are rejected.
Pre-decoding bounds include 32 nesting levels, 256 members per object, 200,000
vertices per mesh, 500,000 total vertices and eight influences per vertex.

Thirty-three Windows syntax/shape checks passed, including duplicate escaped keys,
invalid UTF-8, missing flags, overflow and the object-member cap. The actual saved
candidate passed closed-schema validation. Source compilation against installed
Unity 6000.6 assemblies and .NET Standard 2.1 references passed. Initial compilation
without the required .NET Standard reference failed; that is a compilation setup
failure, not an Editor execution result. Actual Editor decoding/loading of this
revision remains pending because the disk admission reserve is unavailable.

The 128 MiB snapshot limit caps input size, not peak memory: the snapshot, decoded
text and DTO graph can coexist. Returned DTOs are mutable. Referenced Blender/FBX
identities still need verification against the reviewed reference before restoration;
the loader's validated hash strings do not perform that verification. Importer
wiring, native restoration, GPU/player checks and release activation remain pending.

### Reference-bound artifact bundle

`LoadBundle` also captures the Blender and FBX files using the hashes and sizes in
the reviewed reference. The bundle reader copies expected identities before I/O,
requires exactly the two fixed distinct filenames, and returns owned byte snapshots
only after both files pass verification. This snapshot path supports up to 128 MiB
per artifact; larger files remain preserved but require a future streaming consumer.
Arrays and DTOs remain mutable; consumers must not change the validated data.

Nine Windows bundle checks passed, including entry ordering, duplicate/path attacks,
size limits, tampering and independence after source replacement. The actual candidate's
14,587,938-byte Blender file and 1,264,860-byte FBX passed bound snapshot verification.
Combined source compilation against installed Unity and .NET Standard 2.1 passed.
Actual Editor loading, private snapshot staging into Unity's importer and native
weight restoration remain pending. No existing assets or installed runtime changed.

### Bounded runtime weight preparation

`CharacterWeightPrecision.Prepare` copies one source vertex's positive named deform
weights, sorts them deterministically and applies the prototype's 1/65535 precision
floor to small non-largest influences. The largest influence absorbs the increase;
an adjustment above 0.0001 is rejected. Source arrays and weight objects are not changed.
The method rejects invalid, duplicate, unnormalized or excess influences and retains
every supported positive name. It creates a derived runtime approximation, not an
exact copy of original numeric weights or proof of native serialization.

Eleven Windows checks passed, including tiny influence retention, normalization, repeated
preparation stability and rejection of excessive adjustment. All 17,686 actual candidate
vertices prepared without influence-count loss and with stable repeated preparation.
Independent review reproduced a floor-created tie-order change; a failing regression
confirmed it, and sorting again after adjustment fixed it. Final source review passed.
Adapter integration remains separate. Imported-vertex matching, native mesh assignment,
saved reload checks and actual player/pose qualification are still required.

### Source-position weight matching

`CharacterSourceWeightMatcher` copies source positions and weights into a grid index
with entry and cell limits. It searches adjacent cells and accepts positions within 0.000002 metres
on each axis. All matching source records must agree on named weights; conflicting
coincident or nearby records fail rather than selecting an arbitrary record. Equivalent
exact duplicates are coalesced. Each cell allows at most 64 distinct records; denser
inputs fail explicitly. Use semantically validated, reviewed references; dictionary
collision behavior does not provide worst-case constant lookup for hostile inputs.
This matching represents position/weight equivalence, not
source topology correspondence or physical distance clearance.

Eight Windows checks passed, covering cell boundaries, mutation isolation, equivalent
duplicates, ambiguity, missing positions and non-finite input. All 17,686 source
vertices matched. The production matcher also matched all 18,721 vertices in the
earlier isolated Unity reload receipt with complete positive named influence sets;
maximum weight difference was 0.00002534. That replay uses historical imported data,
not a new importer execution of the latest adapter. Actual mesh restoration and
rendered runtime validation remain pending.

### Derived native mesh adapter

`CharacterNativeWeightAdapter.BuildDerivedMesh` plans source-matched weights,
creates a clone of the imported mesh, assigns all influences through Unity's native
weight API, and validates retained positive bone-index sets within 0.0001 tolerance.
Validation allows native tie reordering. A failed clone is destroyed; success returns
an owned mesh for the caller to dispose. No renderer assignment or asset write occurs.
The caller must supply a validated reference and a neutral instance imported from
the verified FBX snapshot. This API cannot establish those prerequisites itself.

Adapter and fixture compilation against installed Unity/.NET Standard 2.1 passed.
Source review found no blocking issue and prompted a five-influence fixture upgrade.
The initial headless run was stopped at its resource limit before producing a result;
the log is retained. The updated five-influence fixture has not executed. No native
runtime pass, saved reload, source-coverage or activation claim follows.

The isolated warmed project measured about 120 MB of Library data, 23 KB of incremental
source and a 1.3 MB new FBX. Its headless incremental admission reserves 10 GiB of
operational space plus 1 GiB of allowance; heavy build/render requirements remain
unchanged. The failed run still retained its RAM/disk/time limits. A subsequent check
found available RAM below the 2 GiB admission threshold, so no retry was launched.
