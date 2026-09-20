"""Fit selected CC0 mesh data. No upstream executable code is loaded."""
import bpy
import hashlib
from mathutils import Vector
from mathutils.kdtree import KDTree

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
