"""Prepare a staged, rigged human candidate; never changes the live Unity scene."""
import bpy
import hashlib
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/assets/makehuman-core'
OUT = ROOT / '.build/characters'
manifest = json.loads((SOURCE / 'provenance.json').read_text(encoding='utf-8-sig'))
raw = (SOURCE / 'base.obj').read_bytes()
assert hashlib.sha256(raw).hexdigest() == manifest['files']['base.obj']['sha256']
vertices, uvs, groups = [], [], {}
group = None
for line in raw.decode().splitlines():
    parts = line.split()
    if not parts:
        continue
    if parts[0] == 'v':
        vertices.append(Vector(tuple(map(float, parts[1:4]))))
    elif parts[0] == 'vt':
        uvs.append(tuple(map(float, parts[1:3])))
    elif parts[0] == 'g':
        group = parts[1]
    elif parts[0] == 'f':
        groups.setdefault(group, []).append([tuple(int(x)-1 for x in c.split('/')[:2]) for c in parts[1:]])
body_faces = groups['body']
used = sorted({v for face in body_faces for v, _ in face})
bottom = min(vertices[i].y for i in used)
scale = 1.75 / (max(vertices[i].y for i in used)-bottom)
def position(v):
    return Vector((v.x*scale, -v.z*scale, (v.y-bottom)*scale))
def joint(name):
    ids = {v for face in groups['joint-'+name] for v, _ in face}
    return position(sum((vertices[i] for i in ids), Vector())/len(ids))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
remap = {old: new for new, old in enumerate(used)}
mesh = bpy.data.meshes.new('MakeHumanBody')
mesh.from_pydata([position(vertices[i]) for i in used], [], [[remap[v] for v, _ in f] for f in body_faces])
mesh.update()
body = bpy.data.objects.new('Human', mesh)
bpy.context.collection.objects.link(body)
uv = mesh.uv_layers.new(name='UVMap')
for polygon, face in zip(mesh.polygons, body_faces):
    polygon.use_smooth = True
    for loop, (_, t) in zip(polygon.loop_indices, face):
        uv.data[loop].uv = uvs[t]

def material(name, color, roughness):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    return m
skin = material('Skin candidate - untextured', (.48,.29,.18), .48)
selected_assets = ROOT / 'vendor/assets/makehuman-system-selected'
selected_manifest = json.loads((selected_assets / 'provenance.json').read_text(encoding='utf-8-sig'))
skin_relative = 'skins/young_caucasian_female/young_lightskinned_female_diffuse.png'
skin_path = selected_assets / skin_relative
skin_entry = next(item for item in selected_manifest['files'] if item['path'] == skin_relative)
assert hashlib.sha256(skin_path.read_bytes()).hexdigest() == skin_entry['sha256']
skin.name = 'MakeHuman CC0 skin candidate'
skin_image = bpy.data.images.load(str(skin_path))
skin_image.pack()
texture = skin.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = skin_image
skin.node_tree.nodes.active = texture
skin.node_tree.links.new(texture.outputs['Color'], skin.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
fabric = material('PARADIZE fitted uniform candidate', (.035,.10,.13), .8)
body.data.materials.append(skin)

# A separate fitted garment shell, not a painted body material. Final tailoring
# and asset realism still require review; this is not a production clothing claim.
neck_height = joint('neck').z - .04
wrist_x = abs(joint('l-hand').x) - .025
garment_faces = []
for polygon in mesh.polygons:
    points = [mesh.vertices[i].co for i in polygon.vertices]
    if all(.10 < p.z < neck_height and abs(p.x) < wrist_x for p in points):
        garment_faces.append(tuple(polygon.vertices))
# Keep the connected garment, excluding small disconnected scraps near hands.
adjacency = {}
for face in garment_faces:
    for i in face:
        adjacency.setdefault(i,set()).update(face)
remaining = set(adjacency)
components = []
while remaining:
    pending = [remaining.pop()]
    component = set(pending)
    while pending:
        neighbors = adjacency[pending.pop()] & remaining
        remaining.difference_update(neighbors)
        component.update(neighbors)
        pending.extend(neighbors)
    components.append(component)
largest = max(components,key=len)
garment_faces = [f for f in garment_faces if f[0] in largest]
cloth_ids = sorted({i for face in garment_faces for i in face})
cloth_map = {old:i for i,old in enumerate(cloth_ids)}
cloth_mesh = bpy.data.meshes.new('UniformShell')
cloth_mesh.from_pydata([mesh.vertices[i].co + mesh.vertices[i].normal*.008 for i in cloth_ids], [], [[cloth_map[i] for i in f] for f in garment_faces])
cloth_mesh.update()
cloth = bpy.data.objects.new('Uniform candidate', cloth_mesh)
bpy.context.collection.objects.link(cloth)
cloth.data.materials.append(fabric)
for p in cloth_mesh.polygons:
    p.use_smooth = True
smooth = cloth.modifiers.new('Tailoring boundary smoothing','SMOOTH')
smooth.factor=.8
smooth.iterations=8
wrap = cloth.modifiers.new('Keep fabric above body','SHRINKWRAP')
wrap.target=body
wrap.wrap_method='NEAREST_SURFACEPOINT'
wrap.wrap_mode='ABOVE_SURFACE'
wrap.offset=.012
bpy.context.view_layer.objects.active=cloth
for modifier in list(cloth.modifiers):
    bpy.ops.object.modifier_apply(modifier=modifier.name)
cloth_mesh=cloth.data

rig_data = bpy.data.armatures.new('PARADIZE_HumanRig')
rig = bpy.data.objects.new('PARADIZE_HumanRig',rig_data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bones = {}
def bone(name, head, tail, parent=None):
    b = rig_data.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = rig_data.edit_bones[parent]
    bones[name] = (head.copy(),tail.copy())
bone('Hips',joint('pelvis'),joint('spine-4'))
bone('Spine',joint('spine-4'),joint('spine-2'),'Hips')
bone('Chest',joint('spine-2'),joint('neck'),'Spine')
bone('Neck',joint('neck'),joint('head'),'Chest')
bone('Head',joint('head'),joint('head-2'),'Neck')
for prefix, side in [('Left','l-'),('Right','r-')]:
    bone(prefix+'Shoulder',joint(side+'clavicle'),joint(side+'shoulder'),'Chest')
    bone(prefix+'UpperArm',joint(side+'shoulder'),joint(side+'elbow'),prefix+'Shoulder')
    bone(prefix+'LowerArm',joint(side+'elbow'),joint(side+'hand'),prefix+'UpperArm')
    bone(prefix+'Hand',joint(side+'hand'),joint(side+'hand-3'),prefix+'LowerArm')
    bone(prefix+'UpperLeg',joint(side+'upper-leg'),joint(side+'knee'),'Hips')
    bone(prefix+'LowerLeg',joint(side+'knee'),joint(side+'ankle'),prefix+'UpperLeg')
    bone(prefix+'Foot',joint(side+'ankle'),joint(side+'foot-1'),prefix+'LowerLeg')
bpy.ops.object.mode_set(mode='OBJECT')

# Blender's bone-heat weighting is checked for uncovered vertices. A failed rig
# is retained only as a diagnostic, never exported as a qualified character.
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
unweighted = [v.index for v in mesh.vertices if sum(g.weight for g in v.groups) < .001]
assert not unweighted, f'Unweighted body vertices: {len(unweighted)}'
for vg in body.vertex_groups:
    cloth.vertex_groups.new(name=vg.name)
for new, old in enumerate(cloth_ids):
    for g in mesh.vertices[old].groups:
        cloth.vertex_groups[g.group].add([new],g.weight,'REPLACE')
cloth.parent=rig
modifier=cloth.modifiers.new('Rig','ARMATURE')
modifier.object=rig

import runpy
fit_asset=runpy.run_path(str(Path(__file__).with_name('fit-human-assets.py')))['fit_asset']
eyes=fit_asset(selected_assets,selected_manifest,'eyes/low-poly/low-poly',
    'eyes/materials/brown_eye.png',vertices,position,rig,material)
hair=fit_asset(selected_assets,selected_manifest,'hair/bob01/bob01',
    'hair/bob01/bob01_diffuse.png',vertices,position,rig,material)
bpy.data.objects.remove(cloth,do_unlink=True)
cloth=fit_asset(selected_assets,selected_manifest,'clothes/female_casualsuit01/female_casualsuit01',
    'clothes/female_casualsuit01/female_casualsuit01_diffuse.png',vertices,position,rig,material,body)
shoes=fit_asset(selected_assets,selected_manifest,'clothes/shoes01/shoes01',
    'clothes/shoes01/shoes01_diffuse.png',vertices,position,rig,material,body)
cloth_mesh=cloth.data

# Honor the garment's authored body-occlusion mask on this derived mesh only.
import re
import bmesh
hidden=set()
for stem in ('clothes/female_casualsuit01/female_casualsuit01','clothes/shoes01/shoes01'):
    mask_text=(selected_assets/(stem+'.mhclo')).read_text()
    if 'delete_verts' in mask_text:
        section=mask_text.split('delete_verts',1)[1]
        for line in section.splitlines():
            if line.strip() and not line.strip()[0].isdigit():
                break
            for match in re.finditer(r'(\d+)(?:\s*-\s*(\d+))?',line):
                first=int(match[1]); last=int(match[2] or first)
                assert 0 <= first <= last < len(vertices)
                hidden.update(range(first,last+1))
derived=bmesh.new()
derived.from_mesh(mesh)
derived.verts.ensure_lookup_table()
bmesh.ops.delete(derived,geom=[derived.verts[remap[i]] for i in hidden if i in remap],context='VERTS')
derived.to_mesh(mesh)
derived.free()
mesh.update()

# A restrained breathing preview proves the deformation path, not production
# locomotion or facial animation. Bone endpoints come from upstream joint helpers.
scene=bpy.context.scene
scene.frame_start,scene.frame_end=1,120
chest=rig.pose.bones['Chest']
for frame,value in [(1,1),(60,1.006),(120,1)]:
    chest.scale=(1,value,1)
    chest.keyframe_insert(data_path='scale',frame=frame)
scene.frame_set(1)
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'human-candidate.blend'))
bpy.ops.object.select_all(action='DESELECT')
for obj in (body,cloth,shoes,eyes,hair,rig):
    obj.select_set(True)
bpy.ops.export_scene.fbx(filepath=str(OUT/'human-candidate.fbx'), use_selection=True,
    object_types={'ARMATURE','MESH'}, add_leaf_bones=False, bake_anim=True,
    axis_forward='-Z',axis_up='Y',path_mode='AUTO')
report={'sourceCommit':manifest['commit'],'heightMetres':1.75,'bodyVertices':len(mesh.vertices),
    'uniformVertices':len(cloth_mesh.vertices),'bones':len(rig_data.bones),'unweightedVertices':len(unweighted),
    'fbxSha256':hashlib.sha256((OUT/'human-candidate.fbx').read_bytes()).hexdigest(),
    'skinSourceSha256':skin_entry['sha256'],
    'eyeVertices':len(eyes.data.vertices),'hairVertices':len(hair.data.vertices),
    'shoeVertices':len(shoes.data.vertices),
    'activated':False,'qualification':'Dressed character candidate; intersections, visual review and Unity validation pending'}
(OUT/'human-candidate.json').write_text(json.dumps(report,indent=2)+'\n')
print('PARADIZE_HUMAN_CANDIDATE '+json.dumps(report))
