"""Run with Blender --background --factory-startup --python-exit-code 1 --python <this file>."""
import bpy
import math
import runpy
from pathlib import Path
from mathutils.bvhtree import BVHTree

root = Path(__file__).resolve().parents[2]
fit = runpy.run_path(str(root / 'scripts/characters/fit-human-assets.py'))['fit_trousers_over_shoes']
checks = 0

def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1

def tube(name, radius, shift=0):
    count = 16
    vertices = [(radius * math.cos(i * math.tau / count) + shift,
                 radius * math.sin(i * math.tau / count), height)
                for height in (.05, .15, .25) for i in range(count)]
    faces = [(ring * count + i, ring * count + (i + 1) % count,
              (ring + 1) * count + (i + 1) % count, (ring + 1) * count + i)
             for ring in range(2) for i in range(count)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    uv = mesh.uv_layers.new(name='TestUV')
    for index, loop in enumerate(uv.data):
        loop.uv = ((index % 4) / 4, (index % 3) / 3)
    for label, weight in [('Calf', .75), ('Foot', .25)]:
        group = obj.vertex_groups.new(name=label)
        group.add(list(range(len(vertices))), weight, 'REPLACE')
    return obj

def positions(obj):
    return tuple(tuple(vertex.co) for vertex in obj.data.vertices)

def bindings(obj):
    return (tuple(tuple(p.vertices) for p in obj.data.polygons),
            tuple(tuple(loop.uv) for layer in obj.data.uv_layers for loop in layer.data),
            tuple(tuple((item.group, item.weight) for item in vertex.groups) for vertex in obj.data.vertices),
            tuple(group.name for group in obj.vertex_groups),
            tuple((material.name, material.use_nodes,
                   tuple(material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value))
                  for material in obj.data.materials),
            tuple((modifier.type, modifier.object.name, modifier.use_vertex_groups)
                  for modifier in obj.modifiers), obj.parent.name if obj.parent else None)

def intersections(a, b, padding=0):
    def tree(obj, amount):
        obj.data.calc_loop_triangles()
        return BVHTree.FromPolygons([vertex.co + vertex.normal * amount for vertex in obj.data.vertices],
                                   [tuple(t.vertices) for t in obj.data.loop_triangles], all_triangles=True)
    return tree(a, 0).overlap(tree(b, padding))

def expect_unchanged_failure(outer, inner, **options):
    before = positions(outer), positions(inner), bindings(outer), bindings(inner)
    mesh_count = len(bpy.data.meshes)
    try:
        fit(outer, inner, **options)
    except ValueError:
        check(True, 'bounded fit rejected')
    else:
        raise AssertionError('Expected bounded fitting failure')
    check(before == (positions(outer), positions(inner), bindings(outer), bindings(inner)),
          'failed fit must preserve both meshes')
    check(len(bpy.data.meshes) == mesh_count, 'failed fitting retains no temporary mesh')

outer, inner = tube('Trousers', .0805), tube('Shoes', .08, .004)
rig = bpy.data.objects.new('BindingRig', bpy.data.armatures.new('BindingRig'))
bpy.context.collection.objects.link(rig)
outer.parent = rig
modifier = outer.modifiers.new('PreservedArmature', 'ARMATURE')
modifier.object = rig
material = bpy.data.materials.new('PreservedMaterial')
material.use_nodes = True
material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.1, .2, .3, 1)
outer.data.materials.append(material)
bpy.context.view_layer.update()
check(len(intersections(outer, inner)) > 0, 'fixture surfaces must actually intersect')
before, inner_before, bound_before = positions(outer), positions(inner), bindings(outer)
mesh_count = len(bpy.data.meshes)
receipt = fit(outer, inner)
check(len(bpy.data.meshes) == mesh_count, 'successful fitting removes its temporary mesh')
check(not intersections(outer, inner), 'all synthetic triangle intersections resolved')
check(not intersections(outer, inner, .001), 'explicit padded footwear triangles separated')
check(receipt['changedVertices'] > 0, 'intersecting fixture needs a real coordinate change')
check(receipt['largestDisplacementMetres'] <= .0200001, 'correction stays within the limit')
check(all(old[2] == vertex.co.z for old, vertex in zip(before, outer.data.vertices)), 'all heights preserved')
check(bindings(outer) == bound_before, 'topology, UVs and bindings preserved')
check(positions(inner) == inner_before, 'footwear coordinates preserved')
after = positions(outer)
again = fit(outer, inner)
check(again['changedVertices'] == 0 and positions(outer) == after, 'second fit is idempotent')

a, b = tube('FailOuter', .0805), tube('FailInner', .08, .004)
bpy.context.view_layer.update()
expect_unchanged_failure(a, b, maximum_steps=1)
expect_unchanged_failure(a, b, maximum_displacement=.0005)
for options in ({'step': float('nan')}, {'envelope': 0}, {'step': True},
                {'maximum_steps': True}, {'maximum_steps': 0}, {'maximum_steps': 101}):
    expect_unchanged_failure(a, b, **options)
b.location.x = .2
bpy.context.view_layer.update()
expect_unchanged_failure(a, b)
b.location.x = 0
bpy.context.view_layer.update()
expect_unchanged_failure(a, a)
print('FOOTWEAR_LAYERING_CHECKS_PASSED=' + str(checks))
