import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const fail = code => { throw new Error(code); };
const requireValue = (condition, code = 'CHARACTER_METADATA_INVALID') => { if (!condition) fail(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, minimum = 0, maximum = 10000000) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const safeName = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f/\\:]/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const vector = value => Array.isArray(value) && value.length === 3 && value.every(number => Number.isFinite(number) && Math.abs(number) <= 10000);
const requiredRoles = ['body', 'clothing', 'footwear', 'hair', 'eyes'];
const pendingFields = ['visualRealism', 'unityImport', 'humanoidRetargeting', 'locomotion', 'facialAnimation', 'secondaryMotion', 'vrmRoundtrip', 'lodPerformance'];

function shape(value, keys) {
  requireValue(record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}
function list(value, maximum, minimum = 0) { requireValue(Array.isArray(value) && value.length >= minimum && value.length <= maximum); }
function names(value, maximum, minimum = 0) {
  list(value, maximum, minimum); requireValue(value.every(safeName) && new Set(value).size === value.length);
}
function relative(value) {
  requireValue(typeof value === 'string' && value.length <= 512 && value.length > 0, 'CHARACTER_PATH_INVALID');
  const parts = value.split('/');
  requireValue(parts.every(part => /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}$/.test(part) &&
    !part.endsWith('.') && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)), 'CHARACTER_PATH_INVALID');
  return value;
}
function fileMetadata(value, extra = []) {
  shape(value, ['path', 'bytes', 'sha256', ...extra]); relative(value.path);
  requireValue(integer(value.bytes, 1, 1024 ** 3) && digest(value.sha256));
}

export function validateCharacterManifest(value) {
  shape(value, ['schemaVersion', 'characterId', 'profile', 'generatedAt', 'generator', 'coordinates', 'artifacts', 'sources', 'components', 'skeleton', 'animation', 'policy', 'qualification']);
  requireValue(value.schemaVersion === 1 && value.profile === 'makehuman-dressed-candidate-v1' &&
    typeof value.characterId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.characterId), 'CHARACTER_SCHEMA_UNSUPPORTED');
  requireValue(typeof value.generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.generatedAt) && Number.isFinite(Date.parse(value.generatedAt)));
  shape(value.generator, ['blenderVersion', 'scripts']);
  requireValue(typeof value.generator.blenderVersion === 'string' && /^\d+\.\d+\.\d+(?: [A-Za-z0-9 .-]+)?$/.test(value.generator.blenderVersion));
  list(value.generator.scripts, 2, 2);
  const scriptPaths = new Set();
  for (const file of value.generator.scripts) { fileMetadata(file); scriptPaths.add(file.path); }
  requireValue(scriptPaths.size === 2 && scriptPaths.has('scripts/characters/build-human.py') && scriptPaths.has('scripts/characters/fit-human-assets.py'));
  shape(value.coordinates, ['space', 'unitSystem', 'unitScale', 'upAxis', 'fbxForwardAxis', 'fbxUpAxis']);
  requireValue(value.coordinates.space === 'blender-world' && ['NONE', 'METRIC', 'IMPERIAL'].includes(value.coordinates.unitSystem) &&
    Number.isFinite(value.coordinates.unitScale) && value.coordinates.unitScale > 0 && value.coordinates.unitScale <= 1000 &&
    value.coordinates.upAxis === 'Z' && value.coordinates.fbxForwardAxis === '-Z' && value.coordinates.fbxUpAxis === 'Y');
  list(value.artifacts, 2, 2);
  const artifactRoles = new Set(), artifactPaths = new Set();
  for (const file of value.artifacts) {
    fileMetadata(file, ['role']);
    requireValue(['editable-source', 'unity-candidate'].includes(file.role) && !artifactRoles.has(file.role) && !artifactPaths.has(file.path.toLowerCase()));
    requireValue(file.path.endsWith(file.role === 'editable-source' ? '.blend' : '.fbx'));
    artifactRoles.add(file.role); artifactPaths.add(file.path.toLowerCase());
  }
  list(value.sources, 2, 2);
  const sourceIds = new Set(), sourceFiles = new Map();
  for (const source of value.sources) {
    shape(source, ['id', 'origin', 'license', 'licenseScope', 'revision', 'scope', 'files']);
    requireValue(['makehuman-core', 'makehuman-system-selected'].includes(source.id) && !sourceIds.has(source.id)); sourceIds.add(source.id);
    const core = source.id === 'makehuman-core';
    requireValue(source.origin === (core ? 'https://github.com/makehumancommunity/makehuman' :
      'https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html') &&
      source.license === 'CC0-1.0' && source.licenseScope === 'graphical-assets-only' && source.scope === 'preserved-bundle');
    shape(source.revision, ['kind', 'value']);
    requireValue(source.revision.kind === (core ? 'git-commit' : 'archive-sha256') &&
      typeof source.revision.value === 'string' && (core ? /^[a-f0-9]{40}$/.test(source.revision.value) : digest(source.revision.value)));
    list(source.files, 128, 1);
    for (const file of source.files) {
      fileMetadata(file); requireValue(file.path.startsWith(`vendor/assets/${source.id}/`) && !sourceFiles.has(file.path.toLowerCase()));
      sourceFiles.set(file.path.toLowerCase(), file);
    }
    requireValue(sourceFiles.has(`vendor/assets/${source.id}/provenance.json`));
  }
  shape(value.skeleton, ['objectName', 'bones']); requireValue(safeName(value.skeleton.objectName));
  list(value.skeleton.bones, 512, 1);
  const bones = new Map();
  for (const bone of value.skeleton.bones) {
    shape(bone, ['name', 'parent', 'headLocal', 'tailLocal', 'deform']);
    requireValue(safeName(bone.name) && !bones.has(bone.name) && (bone.parent === null || safeName(bone.parent)) &&
      vector(bone.headLocal) && vector(bone.tailLocal) && typeof bone.deform === 'boolean');
    bones.set(bone.name, bone);
  }
  for (const bone of bones.values()) {
    const visited = new Set([bone.name]); let parent = bone.parent;
    while (parent !== null) {
      requireValue(bones.has(parent) && !visited.has(parent)); visited.add(parent); parent = bones.get(parent).parent;
    }
  }
  list(value.components, 64, requiredRoles.length);
  const componentIds = new Set(), objectNames = new Set(), roles = new Set();
  for (const component of value.components) {
    shape(component, ['id', 'role', 'objectName', 'meshName', 'vertices', 'polygons', 'triangles', 'uvLayers', 'boundsWorld', 'armatures', 'weights', 'shapeKeys', 'materials']);
    requireValue(safeName(component.id) && !componentIds.has(component.id) && requiredRoles.includes(component.role) &&
      safeName(component.objectName) && !objectNames.has(component.objectName) && safeName(component.meshName));
    componentIds.add(component.id); objectNames.add(component.objectName); roles.add(component.role);
    requireValue(integer(component.vertices, 1) && integer(component.polygons, 1) && integer(component.triangles, component.polygons));
    names(component.uvLayers, 16, 1); names(component.armatures, 1, 1); names(component.shapeKeys, 256);
    requireValue(component.armatures[0] === value.skeleton.objectName);
    shape(component.boundsWorld, ['min', 'max']);
    requireValue(vector(component.boundsWorld.min) && vector(component.boundsWorld.max) && component.boundsWorld.min.every((number, i) => number <= component.boundsWorld.max[i]));
    shape(component.weights, ['maximumInfluences', 'unweightedVertices', 'unnormalizedVertices']);
    requireValue(integer(component.weights.maximumInfluences, 0, bones.size) &&
      integer(component.weights.unweightedVertices, 0, component.vertices) && integer(component.weights.unnormalizedVertices, 0, component.vertices));
    list(component.materials, 32, 1);
    for (const material of component.materials) {
      shape(material, ['name', 'usesNodes', 'nodeTypes', 'images']);
      requireValue(safeName(material.name) && typeof material.usesNodes === 'boolean'); names(material.nodeTypes, 64);
      list(material.images, 32);
      for (const image of material.images) {
        fileMetadata(image, ['width', 'height', 'packed']);
        const original = sourceFiles.get(image.path.toLowerCase());
        requireValue(original && original.path === image.path && original.sha256 === image.sha256 && original.bytes === image.bytes &&
          integer(image.width, 1, 32768) && integer(image.height, 1, 32768) && typeof image.packed === 'boolean');
      }
    }
  }
  requireValue(requiredRoles.every(role => roles.has(role)), 'CHARACTER_COMPONENT_MISSING');
  shape(value.animation, ['actionNames', 'frameStart', 'frameEnd', 'fps']); names(value.animation.actionNames, 64);
  requireValue(integer(value.animation.frameStart, -1000000, 1000000) && integer(value.animation.frameEnd, value.animation.frameStart, 1000000) &&
    Number.isFinite(value.animation.fps) && value.animation.fps > 0 && value.animation.fps <= 1000);
  shape(value.policy, ['appearance', 'paidGenerationAllowed', 'runtimePermissionGranted']);
  requireValue(value.policy.appearance === 'realistic-pbr' && value.policy.paidGenerationAllowed === false && value.policy.runtimePermissionGranted === false);
  shape(value.qualification, ['evidence', 'activated', ...pendingFields]);
  requireValue(value.qualification.evidence === 'blender-datablocks-and-file-hashes' && value.qualification.activated === false &&
    pendingFields.every(key => value.qualification[key] === 'pending'), 'CHARACTER_QUALIFICATION_UNSUPPORTED');
  return value;
}

function regularPath(root, relativePath) {
  relative(relativePath);
  const base = fs.realpathSync(root); requireValue(fs.statSync(base).isDirectory(), 'CHARACTER_PATH_INVALID');
  let current = base;
  for (const [index, part] of relativePath.split('/').entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    requireValue(!stat.isSymbolicLink() && (index === relativePath.split('/').length - 1 ? stat.isFile() : stat.isDirectory()), 'CHARACTER_PATH_INVALID');
  }
  const resolved = fs.realpathSync(current);
  requireValue(resolved === current, 'CHARACTER_PATH_INVALID');
  return current;
}

function checkedBytes(file, maximum, expected) {
  const before = fs.lstatSync(file, { bigint: true });
  requireValue(before.isFile() && !before.isSymbolicLink() && before.size > 0n && before.size <= BigInt(maximum), 'CHARACTER_FILE_INVALID');
  const handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const start = fs.fstatSync(handle, { bigint: true });
    requireValue(start.dev === before.dev && start.ino === before.ino && start.size === before.size, 'CHARACTER_FILE_CHANGED');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536), chunks = []; let bytes = 0;
    for (;;) {
      const length = fs.readSync(handle, buffer, 0, buffer.length, null); if (!length) break;
      bytes += length; requireValue(bytes <= maximum, 'CHARACTER_FILE_INVALID'); hash.update(buffer.subarray(0, length));
      if (!expected) chunks.push(Buffer.from(buffer.subarray(0, length)));
    }
    const after = fs.fstatSync(handle, { bigint: true }), pathname = fs.lstatSync(file, { bigint: true });
    requireValue(start.dev === pathname.dev && start.ino === pathname.ino && !pathname.isSymbolicLink() &&
      start.size === after.size && start.mtimeNs === after.mtimeNs && start.ctimeNs === after.ctimeNs && BigInt(bytes) === start.size, 'CHARACTER_FILE_CHANGED');
    const sha256 = hash.digest('hex');
    if (expected) requireValue(expected.bytes === bytes && expected.sha256 === sha256, 'CHARACTER_HASH_MISMATCH');
    return expected ? { bytes, sha256 } : Buffer.concat(chunks);
  } finally { fs.closeSync(handle); }
}

export function inspectCharacterManifest({ manifestPath, projectRoot = process.cwd() } = {}) {
  try {
    requireValue(typeof manifestPath === 'string' && typeof projectRoot === 'string', 'CHARACTER_PATH_INVALID');
    const absolute = path.resolve(manifestPath), directory = path.dirname(absolute);
    const bytes = checkedBytes(regularPath(directory, path.basename(absolute)), 1024 * 1024);
    let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('CHARACTER_JSON_INVALID'); }
    validateCharacterManifest(value);
    let count = 0, verifiedBytes = 0;
    for (const [root, files] of [[directory, value.artifacts], [projectRoot, [...value.generator.scripts, ...value.sources.flatMap(source => source.files)]]]) {
      for (const file of files) {
        verifiedBytes += file.bytes; requireValue(verifiedBytes <= 2 * 1024 ** 3, 'CHARACTER_SIZE_LIMIT');
        checkedBytes(regularPath(root, file.path), file.bytes, file); count++;
      }
    }
    return { status: 'inventory-verified', characterId: value.characterId, verifiedFiles: count, verifiedBytes,
      components: value.components.map(({ id, role, vertices, triangles }) => ({ id, role, vertices, triangles })),
      geometryIndependentlyDecoded: false, runtimeQualified: false, qualification: value.qualification };
  } catch (error) {
    if (/^CHARACTER_[A-Z_]+$/.test(error?.message ?? '')) throw error;
    fail('CHARACTER_INSPECTION_FAILED');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.length === 1 || (args.length === 3 && args[1] === '--project-root'), 'CHARACTER_USAGE_INVALID');
    console.log(JSON.stringify(inspectCharacterManifest({ manifestPath: args[0], projectRoot: args[2] ?? process.cwd() })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
