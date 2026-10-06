"""Fit selected CC0 mesh data. No upstream executable code is loaded."""
import bpy
import hashlib
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

def fit_trousers_over_shoes(trousers, shoes, *, step=.0005, envelope=.001,
                           maximum_displacement=.02, maximum_steps=40):
    """Resolve this authoring profile's intersecting cuffs, without changing bindings.

    Work in the generated, identity-transform metre space. The padded shoe mesh is
    a vertex-normal envelope, not a proof of uniform minimum distance. Open meshes
    are tested for triangle intersections; no global inside/outside test is used.
    This static correction does not qualify movement or arbitrary clothing pairs.
    """
    for value in (step, envelope, maximum_displacement):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError('Invalid cuff fitting distance')
    if step > maximum_displacement or type(maximum_steps) is not int or not 1 <= maximum_steps <= 100:
        raise ValueError('Invalid cuff fitting limit')
    if trousers == shoes or trousers.type != 'MESH' or shoes.type != 'MESH' or trousers.data == shoes.data:
        raise ValueError('Separate derived meshes are required')
    for obj in (trousers, shoes):
        if obj.data.shape_keys is not None:
            raise ValueError('Cuff fitting must precede shape keys')
        for row in range(4):
            for column in range(4):
                value = obj.matrix_world[row][column]
                if not math.isfinite(value) or abs(value - (1 if row == column else 0)) > 1e-7:
                    raise ValueError('Cuff fitting requires identity transforms')
        if not obj.data.vertices or not obj.data.polygons:
            raise ValueError('Cuff fitting requires populated meshes')
        for vertex in obj.data.vertices:
            if not all(math.isfinite(value) for value in (*vertex.co, *vertex.normal)):
                raise ValueError('Nonfinite cuff geometry')

    original = [vertex.co.copy() for vertex in trousers.data.vertices]
    positions = [point.copy() for point in original]
    faces = [tuple(polygon.vertices) for polygon in trousers.data.polygons]
    shoes.data.calc_loop_triangles()
    shoe_faces = [tuple(triangle.vertices) for triangle in shoes.data.loop_triangles]
    shoe_polygon_ids = [triangle.polygon_index for triangle in shoes.data.loop_triangles]
    shoe_positions = [vertex.co.copy() for vertex in shoes.data.vertices]
    actual_shoes = BVHTree.FromPolygons(shoe_positions, shoe_faces, all_triangles=True)
    padded_shoes = BVHTree.FromPolygons(
        [vertex.co + vertex.normal * envelope for vertex in shoes.data.vertices], shoe_faces,
        all_triangles=True)
    directions = [Vector((vertex.normal.x, vertex.normal.y, 0)) for vertex in trousers.data.vertices]
    for direction in directions:
        if direction.length > 1e-8:
            direction.normalize()
    # The generated cuff may touch a shoe's upper rim; unrelated upper clothing
    # must never enter the repair even if a future asset has unexpected contacts.
    lower = min(point.z for point in shoe_positions)
    upper = max(point.z for point in shoe_positions) + .05
    iterations = 0
    # Blender can choose a different diagonal from BVHTree's implicit polygon
    # tessellation. Recalculate the real loop triangles on an unpublished copy
    # after each move, so checks use the same surface as the saved/rendered mesh.
    scratch = trousers.data.copy()
    try:
        def cloth_tree():
            for vertex, point in zip(scratch.vertices, positions):
                vertex.co = point
            scratch.update()
            scratch.calc_loop_triangles()
            triangles = [tuple(triangle.vertices) for triangle in scratch.loop_triangles]
            polygon_ids = [triangle.polygon_index for triangle in scratch.loop_triangles]
            return BVHTree.FromPolygons(positions, triangles, all_triangles=True), polygon_ids

        tree, polygon_ids = cloth_tree()
        initial_pairs = len({(polygon_ids[a], shoe_polygon_ids[b])
                             for a, b in tree.overlap(actual_shoes)})
        for iteration in range(maximum_steps + 1):
            pairs = tree.overlap(padded_shoes)
            if not pairs:
                break
            if iteration == maximum_steps:
                raise ValueError('Cuff intersections remain at the step limit')
            affected = sorted({index for triangle, _ in pairs
                               for index in faces[polygon_ids[triangle]]})
            for index in affected:
                if not lower <= original[index].z <= upper or directions[index].length < .99:
                    raise ValueError('Cuff intersection outside the supported repair region')
                proposed = positions[index] + directions[index] * step
                if (proposed - original[index]).length > maximum_displacement + 1e-7:
                    raise ValueError('Cuff displacement limit exceeded')
                positions[index] = proposed
            iterations += 1
            tree, polygon_ids = cloth_tree()
        if tree.overlap(actual_shoes):
            raise ValueError('Cuff intersections remain against original footwear')
    finally:
        bpy.data.meshes.remove(scratch)
    distances = [(point - original[index]).length for index, point in enumerate(positions)]
    # Publish coordinates only after all checks. Failures above leave both meshes
    # unchanged, including topology, UVs, materials, weights and armature links.
    for vertex, point in zip(trousers.data.vertices, positions):
        vertex.co = point
    trousers.data.update()
    return {'method': 'bounded-horizontal-cuff-separation-v2',
            'intersectionMethod': 'explicit Blender loop triangles',
            'intersectionPairsBefore': initial_pairs, 'intersectionPairsAfter': 0,
            'paddedIntersectionPairsAfter': 0, 'shoeVertexNormalEnvelopeMetres': envelope,
            'stepMetres': step, 'maximumDisplacementMetres': maximum_displacement,
            'maximumSteps': maximum_steps, 'stepsUsed': iterations,
            'changedVertices': sum(distance > 1e-8 for distance in distances),
            'largestDisplacementMetres': max(distances), 'vertexHeightsPreserved': True,
            'qualification': 'static authoring separation only; animation and Unity pending'}

def fit_asset(asset_root, manifest, stem, texture_path, base_vertices, to_world, rig, material_factory, body=None):
    def read(relative, binary=False):
        entry = next(f for f in manifest['files'] if f['path'] == relative)
        raw = (asset_root/relative).read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError('Asset differs from recorded source: '+relative)
        return raw if binary else raw.decode('utf-8-sig')
    obj = read(stem+'.obj')
    mapping = read(stem+'.mhclo')
    texcoords, faces, source_count = [], [], 0
    for line in obj.splitlines():
        fields=line.split()
        if not fields:
            continue
        if fields[0]=='v':
            source_count+=1
        elif fields[0]=='vt':
            texcoords.append(tuple(map(float,fields[1:3])))
        elif fields[0]=='f':
            faces.append([tuple(int(v)-1 for v in item.split('/')[:2]) for item in fields[1:]])
    axes=[1.,1.,1.]
    refs=[]
    active=False
    for line in mapping.splitlines():
        fields=line.split()
        if not fields or fields[0].startswith('#'):
            continue
        if fields[0] in ('x_scale','y_scale','z_scale'):
            axis='xyz'.index(fields[0][0])
            a,b=int(fields[1]),int(fields[2])
            axes[axis]=abs(base_vertices[a][axis]-base_vertices[b][axis])/float(fields[3])
        if fields[0]=='verts':
            active=True
        elif active and fields[0].isdigit():
            if len(fields)==1:
                refs.append(([(int(fields[0]),1.)],Vector()))
            elif len(fields)==9:
                refs.append(([(int(fields[i]),float(fields[i+3])) for i in range(3)],Vector(tuple(map(float,fields[6:9])))))
            else:
                raise ValueError('Unsupported vertex mapping')
        elif active and fields[0] in ('delete_verts','weights','vertexboneweights'):
            active=False
    if len(refs)!=source_count:
        raise ValueError('Mapping count does not match OBJ')
    fitted=[]
    for influences,offset in refs:
        if abs(sum(weight for _,weight in influences)-1)>0.001:
            raise ValueError('Invalid reference weights')
        point=sum((base_vertices[i]*weight for i,weight in influences),Vector())
        point+=Vector(tuple(offset[i]*axes[i] for i in range(3)))
        fitted.append(to_world(point))
    mesh=bpy.data.meshes.new(stem.split('/')[-1])
    mesh.from_pydata(fitted,[],[[v for v,_ in f] for f in faces])
    mesh.update()
    layer=mesh.uv_layers.new(name='UVMap')
    for polygon,face in zip(mesh.polygons,faces):
        polygon.use_smooth=True
        for loop,(_,t) in zip(polygon.loop_indices,face):
            layer.data[loop].uv=texcoords[t]
    obj=bpy.data.objects.new(stem.split('/')[-1],mesh)
    bpy.context.collection.objects.link(obj)
    read(texture_path,binary=True)
    image=bpy.data.images.load(str(asset_root/texture_path))
    image.pack()
    mat=material_factory('CC0 '+obj.name,(1,1,1),.45)
    shader=mat.node_tree.nodes['Principled BSDF']
    texture=mat.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image=image
    mat.node_tree.nodes.active=texture
    mat.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
    if stem.startswith('hair/'):
        mat.node_tree.links.new(texture.outputs['Alpha'],shader.inputs['Alpha'])
    mesh.materials.append(mat)
    obj.parent=rig
    if body is None:
        weights=obj.vertex_groups.new(name='Head')
        weights.add(list(range(len(mesh.vertices))),1.,'REPLACE')
    else:
        tree=KDTree(len(body.data.vertices))
        for v in body.data.vertices:
            tree.insert(v.co,v.index)
        tree.balance()
        for group in body.vertex_groups:
            obj.vertex_groups.new(name=group.name)
        for vertex in mesh.vertices:
            combined={}
            for _,index,distance in tree.find_n(vertex.co,3):
                factor=1/max(distance,.0001)**2
                for influence in body.data.vertices[index].groups:
                    combined[influence.group]=combined.get(influence.group,0)+factor*influence.weight
            strongest=sorted(combined.items(),key=lambda pair:pair[1],reverse=True)[:4]
            total=sum(weight for _,weight in strongest)
            if total<=0:
                raise ValueError('Unweighted garment vertex')
            for group,weight in strongest:
                obj.vertex_groups[group].add([vertex.index],weight/total,'REPLACE')
    modifier=obj.modifiers.new('Rig','ARMATURE')
    modifier.object=rig
    return obj
