import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectCharacterManifest, validateCharacterManifest } from '../../scripts/characters/inspect-character-manifest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const roles = ['body', 'clothing', 'footwear', 'hair', 'eyes'];
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paradize-character-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'output'); fs.mkdirSync(output);
  function write(base, name, content) {
    const bytes = Buffer.from(content); const file = path.join(base, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    return { path: name, bytes: bytes.length, sha256: digest(bytes) };
  }
  const scripts = ['build-human.py', 'fit-human-assets.py'].map(name => write(directory, `scripts/characters/${name}`,
    fs.readFileSync(path.join(root, 'scripts/characters', name))));
  const coreFiles = [write(directory, 'vendor/assets/makehuman-core/base.obj', 'synthetic mesh\n'),
    write(directory, 'vendor/assets/makehuman-core/LICENSE.ASSETS.md', 'synthetic CC0 evidence\n')];
  const core = { repository: 'https://github.com/makehumancommunity/makehuman', commit: 'a'.repeat(40), license: 'CC0-1.0 (graphical assets only)',
    files: Object.fromEntries(coreFiles.map(file => [path.basename(file.path), { bytes: file.bytes, sha256: file.sha256 }])) };
  const coreProvenance = write(directory, 'vendor/assets/makehuman-core/provenance.json', JSON.stringify(core));
  const texture = write(directory, 'vendor/assets/makehuman-system-selected/texture.png', 'synthetic texture bytes');
  const selected = { licenseEvidence: 'https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html',
    archiveSha256: 'b'.repeat(64), license: 'CC0', files: [{ ...texture, path: 'texture.png' }] };
  const selectedProvenance = write(directory, 'vendor/assets/makehuman-system-selected/provenance.json', JSON.stringify(selected));
  const files = [['editable-source', 'human-candidate.blend'], ['unity-candidate', 'human-candidate.fbx']].map(([role, name]) =>
    ({ role, ...write(output, name, `synthetic ${name} bytes`) }));
  const manifest = {
    schemaVersion: 1, characterId: 'sunny', profile: 'makehuman-dressed-candidate-v1', generatedAt: '2026-09-24T12:00:00Z',
    generator: { blenderVersion: '5.2.1', scripts },
    coordinates: { space: 'blender-world', unitSystem: 'NONE', unitScale: 1, upAxis: 'Z', fbxForwardAxis: '-Z', fbxUpAxis: 'Y' },
    artifacts: files,
    sources: [
      { id: 'makehuman-core', origin: core.repository, license: 'CC0-1.0', licenseScope: 'graphical-assets-only', revision: { kind: 'git-commit', value: core.commit },
        scope: 'preserved-bundle', files: [...coreFiles, coreProvenance] },
      { id: 'makehuman-system-selected', origin: selected.licenseEvidence, license: 'CC0-1.0', licenseScope: 'graphical-assets-only', revision: { kind: 'archive-sha256', value: selected.archiveSha256 },
        scope: 'preserved-bundle', files: [texture, selectedProvenance] },
    ],
    skeleton: { objectName: 'SharedRig', bones: [{ name: 'Hips', parent: null, headLocal: [0, 0, 0], tailLocal: [0, 0, 1], deform: true }] },
    components: roles.map(role => ({ id: role, role, objectName: role, meshName: role,
      vertices: 3, polygons: 1, triangles: 1, uvLayers: ['UVMap'], boundsWorld: { min: [0, 0, 0], max: [1, 1, 1] },
      armatures: ['SharedRig'], weights: { maximumInfluences: 1, unweightedVertices: 0, unnormalizedVertices: 0 }, shapeKeys: [],
      materials: [{ name: 'Material', usesNodes: true, nodeTypes: ['ShaderNodeBsdfPrincipled', 'ShaderNodeTexImage'],
        images: [{ ...texture, width: 2, height: 2, packed: true }] }] })),
    animation: { actionNames: ['Breathing'], frameStart: 1, frameEnd: 120, fps: 24 },
    policy: { appearance: 'realistic-pbr', paidGenerationAllowed: false, runtimePermissionGranted: false },
    qualification: { evidence: 'blender-datablocks-and-file-hashes', activated: false,
      ...Object.fromEntries(['visualRealism', 'unityImport', 'humanoidRetargeting', 'locomotion', 'facialAnimation', 'secondaryMotion', 'vrmRoundtrip', 'lodPerformance'].map(key => [key, 'pending'])) },
  };
  const manifestPath = path.join(output, 'human-candidate.modular.json');
  const save = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest)); save();
  return { directory, output, manifest, manifestPath, save, texture, inspect: () => inspectCharacterManifest({ manifestPath, projectRoot: directory }) };
}

test('hash inspection confirms inventory while explicitly withholding geometry/runtime qualification', t => {
  const data = fixture(t), result = data.inspect();
  assert.equal(result.status, 'inventory-verified'); assert.equal(result.verifiedFiles, 9);
  assert.equal(result.components.length, 5); assert.equal(result.geometryIndependentlyDecoded, false);
  assert.equal(result.runtimeQualified, false); assert.equal(result.qualification.activated, false);
  assert.equal(result.qualification.vrmRoundtrip, 'pending');
  assert.equal(JSON.stringify(result).includes(data.directory), false);
});

test('changed artifact bytes, source textures and authoring scripts fail integrity checks', t => {
  for (const target of ['output/human-candidate.fbx', 'vendor/assets/makehuman-system-selected/texture.png', 'scripts/characters/fit-human-assets.py']) {
    const data = fixture(t), file = path.join(data.directory, target), bytes = fs.readFileSync(file);
    bytes[0] ^= 1; fs.writeFileSync(file, bytes);
    assert.throws(data.inspect, /CHARACTER_HASH_MISMATCH/);
  }
});

test('missing component roles and ambiguous or absent skeleton bindings fail metadata inspection', t => {
  const data = fixture(t);
  data.manifest.components[4].role = 'body';
  assert.throws(() => validateCharacterManifest(data.manifest), /CHARACTER_COMPONENT_MISSING/);
  data.manifest.components[4].role = 'eyes'; data.manifest.components[0].armatures = ['OtherRig'];
  assert.throws(() => validateCharacterManifest(data.manifest), /CHARACTER_METADATA_INVALID/);
  data.manifest.components[0].armatures = ['SharedRig']; data.manifest.skeleton.bones[0].parent = 'Hips';
  assert.throws(() => validateCharacterManifest(data.manifest), /CHARACTER_METADATA_INVALID/);
});

test('unknown metadata and premature qualification or paid permissions are rejected', t => {
  const { manifest } = fixture(t);
  for (const alter of [copy => { copy.schemaVersion = 2; }, copy => { copy.secretPath = 'private'; },
    copy => { copy.qualification.vrmRoundtrip = 'passed'; }, copy => { copy.qualification.activated = true; },
    copy => { copy.policy.paidGenerationAllowed = true; }, copy => { copy.sources[0].licenseScope = 'all-code'; },
    copy => { copy.components[0].materials[0].images[0].sha256 = 'c'.repeat(64); }]) {
    const copy = structuredClone(manifest); alter(copy); assert.throws(() => validateCharacterManifest(copy), /^Error: CHARACTER_/);
  }
});

test('asset paths cannot traverse, use Windows streams or escape the intended bundles', t => {
  const { manifest } = fixture(t);
  for (const invalid of ['../outside.fbx', '/tmp/model.fbx', 'C:/private/model.fbx', '\\server\share\model.fbx',
    'safe/../../outside.fbx', 'human-candidate.fbx:secret', 'nul.fbx', 'bad./model.fbx', 'a//model.fbx']) {
    const copy = structuredClone(manifest); copy.artifacts[1].path = invalid;
    assert.throws(() => validateCharacterManifest(copy), /CHARACTER_PATH_INVALID/);
  }
  const copy = structuredClone(manifest); copy.sources[0].files[0].path = 'private/documents/record.txt';
  assert.throws(() => validateCharacterManifest(copy), /CHARACTER_METADATA_INVALID/);
});

test('directory junctions or symlinks in asset paths are rejected before reading their target', t => {
  const data = fixture(t), alias = path.join(data.output, 'alias');
  fs.symlinkSync(data.output, alias, process.platform === 'win32' ? 'junction' : 'dir');
  data.manifest.artifacts[1].path = 'alias/human-candidate.fbx'; data.save();
  assert.throws(data.inspect, /CHARACTER_PATH_INVALID/);
});

test('multiple meshes may share a role without weakening the required role inventory', t => {
  const { manifest } = fixture(t), extra = structuredClone(manifest.components[1]);
  extra.id = 'jacket'; extra.objectName = 'Jacket'; manifest.components.push(extra);
  assert.doesNotThrow(() => validateCharacterManifest(manifest));
});

const emitterProgram = String.raw`
import ast, hashlib, json, sys
from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace as S
root=Path(sys.argv[1]); out=root/'output'
source=(root/'scripts/characters/build-human.py').read_text(encoding='utf-8')
tree=ast.parse(source)
function=next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name=='build_modular_manifest')
exec(compile(ast.Module(body=[function],type_ignores=[]),'<emitter-only>','exec'))
bone=S(name='Hips',parent=None,head_local=(0,0,0),tail_local=(0,0,1),use_deform=True)
rig=S(name='SharedRig',data=S(bones=[bone]),animation_data=S(action=S(name='Measured breathing')))
class Matrix:
    def __matmul__(self, value): return value
image=S(filepath=str(root/'vendor/assets/makehuman-system-selected/texture.png'),size=(2,2),packed_file=True)
nodes=[S(type='BSDF_PRINCIPLED',bl_idname='ShaderNodeBsdfPrincipled'),S(type='TEX_IMAGE',bl_idname='ShaderNodeTexImage',image=image)]
material=S(name='Observed material',use_nodes=True,node_tree=S(nodes=nodes))
components=[]
for role in ['body','clothing','footwear','hair','eyes']:
    vertices=[S(co=point,groups=[S(group=0,weight=1)]) for point in [(0,0,0),(1,0,0),(0,1,1)]]
    mesh=S(name=role+' geometry',vertices=vertices,polygons=[None],loop_triangles=[None],calc_loop_triangles=lambda:None,
           uv_layers=[S(name='ObservedUV')],shape_keys=None,materials=[material])
    components.append((role,S(name=role,data=mesh,matrix_world=Matrix(),vertex_groups=[S(name='Hips')],modifiers=[S(type='ARMATURE',object=rig)])))
blender=S(path=S(abspath=lambda value:value),app=S(version_string='5.2.1'),
    context=S(scene=S(unit_settings=S(system='NONE',scale_length=1),frame_start=3,frame_end=90,render=S(fps=30,fps_base=1))))
core=json.loads((root/'vendor/assets/makehuman-core/provenance.json').read_text())
selected=json.loads((root/'vendor/assets/makehuman-system-selected/provenance.json').read_text())
if len(sys.argv)>2 and sys.argv[2]=='multiple':
    second=S(**vars(components[0][1])); second.name='body.001'
    components.append(('body',second))
manifest=build_modular_manifest(root,out,components,rig,blender,core,selected)
(out/'human-candidate.modular.json').write_text(json.dumps(manifest,allow_nan=False),encoding='utf-8')
if len(sys.argv)>2 and sys.argv[2]=='multiple':
    reordered=build_modular_manifest(root,out,list(reversed(components)),rig,blender,core,selected)
    assert {item['objectName']:item['id'] for item in manifest['components']}=={item['objectName']:item['id'] for item in reordered['components']}
    try:
        build_modular_manifest(root,out,components+[components[0]],rig,blender,core,selected)
    except ValueError as error:
        assert str(error)=='Duplicate character component identity'
    else:
        raise AssertionError('Repeated object identity was accepted')
`;

test('actual Python emitter maps synthetic Blender facts into an inspectable manifest without running Blender', t => {
  const data = fixture(t);
  const before = fs.readFileSync(path.join(data.output, 'human-candidate.fbx'));
  execFileSync(process.env.PARADIZE_PYTHON || 'python', ['-c', emitterProgram, data.directory], { timeout: 10000, windowsHide: true });
  const emitted = JSON.parse(fs.readFileSync(data.manifestPath, 'utf8'));
  assert.equal(emitted.animation.frameStart, 3); assert.equal(emitted.animation.fps, 30);
  assert.deepEqual(emitted.animation.actionNames, ['Measured breathing']);
  assert.equal(emitted.components[0].meshName, 'body geometry');
  assert.deepEqual(emitted.components[0].uvLayers, ['ObservedUV']);
  assert.equal(emitted.components[0].materials[0].name, 'Observed material');
  assert.equal(emitted.skeleton.bones.length, 1); assert.equal(emitted.components[0].weights.unweightedVertices, 0);
  assert.equal(JSON.stringify(emitted).includes(data.directory.replaceAll('\\', '\\\\')), false);
  assert.equal(data.inspect().status, 'inventory-verified');
  assert.deepEqual(fs.readFileSync(path.join(data.output, 'human-candidate.fbx')), before);
});

test('actual emitter gives multiple same-role objects distinct stable IDs independent of enumeration order', t => {
  const data = fixture(t), original = fs.readFileSync(path.join(data.output, 'human-candidate.fbx'));
  execFileSync(process.env.PARADIZE_PYTHON || 'python', ['-c', emitterProgram, data.directory, 'multiple'], { timeout: 10000, windowsHide: true });
  const first = JSON.parse(fs.readFileSync(data.manifestPath, 'utf8'));
  const bodies = first.components.filter(component => component.role === 'body');
  assert.equal(bodies.length, 2); assert.notEqual(bodies[0].objectName, bodies[1].objectName);
  assert.notEqual(bodies[0].id, bodies[1].id);
  assert.equal(data.inspect().status, 'inventory-verified');
  execFileSync(process.env.PARADIZE_PYTHON || 'python', ['-c', emitterProgram, data.directory, 'multiple'], { timeout: 10000, windowsHide: true });
  const second = JSON.parse(fs.readFileSync(data.manifestPath, 'utf8'));
  assert.deepEqual(second.components.map(component => component.id), first.components.map(component => component.id));
  assert.deepEqual(fs.readFileSync(path.join(data.output, 'human-candidate.fbx')), original);
});

const normalizationProgram = String.raw`
import ast, math, struct, sys
from pathlib import Path
from types import SimpleNamespace as S
source=(Path(sys.argv[1])/'scripts/characters/build-human.py').read_text(encoding='utf-8')
tree=ast.parse(source)
function=next((node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='normalize_deform_weights'),None)
assert function is not None, 'Body weight normalization is absent'
exec(compile(ast.Module(body=[function],type_ignores=[]),'<normalizer-only>','exec'))
class Group:
    def __init__(self,index,name,owner): self.index=index; self.name=name; self.owner=owner; self.lock_weight=False
    def add(self,indices,weight,mode):
        assert mode=='REPLACE'
        stored=struct.unpack('<f',struct.pack('<f',weight))[0]
        self.owner.writes.append((self.index,tuple(indices),stored))
        for index in indices:
            member=next(group for group in self.owner.data.vertices[index].groups if group.group==self.index)
            member.weight=stored
def model(rows):
    obj=S(data=S(vertices=[]),writes=[])
    obj.vertex_groups=[Group(index,name,obj) for index,name in enumerate(['Bone0','Bone1','Bone2','Bone3','Bone4','Control','Selection'])]
    for index,weights in enumerate(rows):
        obj.data.vertices.append(S(index=index,groups=[S(group=group,weight=value) for group,value in enumerate(weights) if value is not None]))
    rig=S(data=S(bones=[S(name='Bone'+str(index),use_deform=True) for index in range(5)]+[S(name='Control',use_deform=False)]))
    return obj,rig
def snapshot(obj):
    return [[(group.group,float(group.weight).hex()) for group in vertex.groups] for vertex in obj.data.vertices]
case=sys.argv[2]
if case=='ratios':
    original=[.37,.24,.15,.12,.065]
    obj,rig=model([original+[.6,.4],[.2,.3,0,None,None,.7,.1]])
    summary=normalize_deform_weights(obj,rig)
    weights=[group.weight for group in obj.data.vertices[0].groups[:5]]
    assert len(weights)==5 and all(weight>0 for weight in weights)
    assert math.isclose(math.fsum(weights),1,rel_tol=0,abs_tol=1e-7)
    for before,after in zip(original,weights):
        assert math.isclose(after,before/math.fsum(original),rel_tol=1e-7,abs_tol=0)
    assert summary['vertices']==2 and summary['normalizedVertices']==2 and summary['maximumInfluences']==5
    assert summary['influencesPruned']==0
    assert [group.weight for group in obj.data.vertices[0].groups[5:]]==[.6,.4]
    assert [group.weight for group in obj.data.vertices[1].groups[2:]]==[0,.7,.1]
    assert all(group<5 for group,_,_ in obj.writes)
    first=snapshot(obj); writes=list(obj.writes)
    repeated=normalize_deform_weights(obj,rig)
    assert repeated['normalizedVertices']==0 and snapshot(obj)==first and obj.writes==writes
elif case=='invalid':
    rows=[[-.1,.4],[float('nan'),.4],[float('inf'),.4],[0,0],[],
          [0,0,0,0,0,.8,.2],[.2,.3,None,None,None,-.1],
          [.2,.3,None,None,None,float('nan')],[.2,.3,None,None,None,None,float('inf')],
          [1e308,1e308],[1e-300,1.0]]
    for row in rows:
        obj,rig=model([[.2,.3],row]); before=snapshot(obj)
        try: normalize_deform_weights(obj,rig)
        except ValueError: pass
        else: raise AssertionError('Invalid or unweighted vertex accepted: '+repr(row))
        assert snapshot(obj)==before and obj.writes==[], 'Validation partially changed an earlier vertex'
    for invalid_kind in ['duplicate','missing-group','locked']:
        obj,rig=model([[.2,.3],[.4,.2]])
        if invalid_kind=='duplicate': obj.data.vertices[1].groups.append(S(group=0,weight=.1))
        elif invalid_kind=='missing-group': obj.data.vertices[1].groups.append(S(group=99,weight=.1))
        else: obj.vertex_groups[0].lock_weight=True
        before=snapshot(obj)
        try: normalize_deform_weights(obj,rig)
        except ValueError: pass
        else: raise AssertionError('Invalid group state accepted: '+invalid_kind)
        assert snapshot(obj)==before and obj.writes==[]
elif case=='placement':
    calls=[node for node in ast.walk(tree) if isinstance(node,ast.Call)]
    normalizers=[node for node in calls if isinstance(node.func,ast.Name) and node.func.id=='normalize_deform_weights']
    assert len(normalizers)==1
    call=normalizers[0]
    assert [arg.id for arg in call.args]==['body','rig']
    fitted=[node.lineno for node in calls if isinstance(node.func,ast.Name) and node.func.id=='fit_asset']
    occluded=[node.lineno for node in calls if isinstance(node.func,ast.Attribute) and node.func.attr=='to_mesh']
    later=[node.lineno for node in calls if isinstance(node.func,ast.Attribute) and node.func.attr in ('keyframe_insert','save_as_mainfile','fbx')]
    assert fitted and occluded and later
    assert max(fitted+occluded)<call.lineno<min(later)
else: raise AssertionError('Unknown test case')
`;

test('actual body normalizer preserves all five influence ratios, other groups and repeated-call stability', () => {
  execFileSync(process.env.PARADIZE_PYTHON || 'python', ['-c', normalizationProgram, root, 'ratios'], { timeout: 10000, windowsHide: true });
});

test('actual body normalizer rejects invalid or unweighted vertices before any mutation', () => {
  execFileSync(process.env.PARADIZE_PYTHON || 'python', ['-c', normalizationProgram, root, 'invalid'], { timeout: 10000, windowsHide: true });
});

test('body normalization is invoked only after fitting and occlusion, before animation or export', () => {
  execFileSync(process.env.PARADIZE_PYTHON || 'python', ['-c', normalizationProgram, root, 'placement'], { timeout: 10000, windowsHide: true });
});

test('qualification output override is fresh and rejects existing, escaping and reparse paths', t => {
  const data = fixture(t), alias = path.join(data.directory, '.runtime', 'qualification', 'alias');
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  fs.symlinkSync(data.output, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const program = String.raw`
import ast, re, sys
from pathlib import Path
root=Path(sys.argv[1]); source=(root/'scripts/characters/build-human.py').read_text(encoding='utf-8')
function=next(node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name=='character_output_directory')
exec(compile(ast.Module(body=[function],type_ignores=[]),'<output-selector-only>','exec'))
assert character_output_directory(root,[])==root/'.build/characters'
fresh=character_output_directory(root,['--output-directory','.runtime/qualification/fresh-character'])
assert fresh.is_dir() and list(fresh.iterdir())==[]
for name in ['.runtime/qualification/fresh-character','.runtime/qualification/alias/new',
             '.runtime/qualification/../escape','.runtime/qualification/nul','.runtime/qualification/trailing.',
             '/tmp/unsafe','C:/unsafe','vendor/new','.runtime/qualification/double//child']:
    try:
        character_output_directory(root,['--output-directory',name])
    except ValueError:
        pass
    else:
        raise AssertionError('Unsafe path accepted')
`;
  execFileSync(process.env.PARADIZE_PYTHON || 'python', ['-c', program, data.directory], { timeout: 10000, windowsHide: true });
  assert.equal(fs.existsSync(path.join(data.output, 'new')), false);
});
