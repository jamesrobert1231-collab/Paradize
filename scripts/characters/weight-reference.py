"""Bounded source-weight sidecar for the reviewed MakeHuman candidate, not activation."""
import hashlib
import json
import math
from pathlib import Path

ROLES = {'body', 'clothing', 'footwear', 'hair', 'eyes'}


def artifact_fingerprint(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Invalid weight reference artifact')
    before = path.stat()
    if not 0 < before.st_size <= 512 * 1024 * 1024:
        raise ValueError('Weight reference artifact size limit')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise ValueError('Weight reference artifact changed')
    return {'path': path.name, 'bytes': before.st_size, 'sha256': digest.hexdigest()}


def build_weight_reference(components, skeleton, artifacts):
    components = list(components)
    if len(components) != 5 or {role for role, _ in components} != ROLES:
        raise ValueError('Weight reference requires five distinct roles')
    if len({obj.name for _, obj in components}) != 5:
        raise ValueError('Duplicate weight reference mesh')
    deform = [bone.name for bone in skeleton.data.bones if bone.use_deform]
    if not deform or len(deform) > 128 or len(set(deform)) != len(deform):
        raise ValueError('Invalid weight reference skeleton')
    meshes, total = [], 0
    for role, obj in sorted(components):
        if obj.type != 'MESH' or [m.object for m in obj.modifiers if m.type == 'ARMATURE'] != [skeleton]:
            raise ValueError('Weight reference rig mismatch')
        vertices = obj.data.vertices
        total += len(vertices)
        if not 0 < len(vertices) <= 200000 or total > 500000:
            raise ValueError('Weight reference vertex limit')
        groups = {g.index: g.name for g in obj.vertex_groups}
        rows = []
        for vertex in vertices:
            point = obj.matrix_world @ vertex.co
            if not all(math.isfinite(float(point[i])) for i in range(3)):
                raise ValueError('Non-finite weight reference position')
            weights = []
            for group in vertex.groups:
                if group.group not in groups or not math.isfinite(group.weight) or not 0 <= group.weight <= 1:
                    raise ValueError('Invalid weight reference group')
                name = groups[group.group]
                if name in deform and group.weight > 0:
                    weights.append({'bone': name, 'value': float(group.weight)})
            if not 1 <= len(weights) <= 8 or len({w['bone'] for w in weights}) != len(weights):
                raise ValueError('Invalid weight reference influences')
            if abs(sum(w['value'] for w in weights) - 1) > 0.0001:
                raise ValueError('Unnormalized weight reference')
            rows.append({'position': dict(zip('xyz', map(float, point))),
                         'weights': sorted(weights, key=lambda w: (-w['value'], w['bone']))})
        meshes.append({'role': role, 'name': obj.name, 'vertexCount': len(rows), 'vertices': rows})
    return {'schemaVersion': 1, 'profile': 'makehuman-dressed-weight-reference-v1',
            'coordinateSpace': 'Blender-world-Z-up', 'artifacts': artifacts,
            'deformBones': sorted(deform), 'meshes': meshes, 'runtimeQualified': False,
            'sourceWeightsAdjusted': False}


def write_weight_reference(output, components, skeleton):
    output = Path(output)
    paths = [output / name for name in ('human-candidate.blend', 'human-candidate.fbx')]
    fingerprints = [artifact_fingerprint(path) for path in paths]
    reference = build_weight_reference(components, skeleton, fingerprints)
    reference['generatorSha256'] = artifact_fingerprint(Path(__file__))['sha256']
    payload = json.dumps(reference, separators=(',', ':'), allow_nan=False) + '\n'
    if len(payload.encode('utf-8')) > 128 * 1024 * 1024:
        raise ValueError('Weight reference output size limit')
    if fingerprints != [artifact_fingerprint(path) for path in paths]:
        raise ValueError('Weight reference artifact changed')
    target = output / 'human-candidate.weights.json'
    with target.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(payload)
    return reference
