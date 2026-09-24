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
