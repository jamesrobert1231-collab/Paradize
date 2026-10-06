import ast
import importlib.util
import json
import math
import tempfile
import unittest
import re
from pathlib import Path
from types import SimpleNamespace as S

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('weight_reference', ROOT / 'scripts/characters/weight-reference.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Identity:
    def __matmul__(self, point):
        return point


def fixture():
    rig = S(data=S(bones=[S(name=f'Bone{i}', use_deform=True) for i in range(5)]))
    parts = []
    for role in sorted(module.ROLES):
        vertex = S(co=(1, 2, 3), groups=[S(group=i, weight=w) for i, w in enumerate((.7, .2, .09, .00999, .00001))])
        obj = S(name=role, type='MESH', modifiers=[S(type='ARMATURE', object=rig)],
                vertex_groups=[S(index=i, name=f'Bone{i}') for i in range(5)],
                matrix_world=Identity(), data=S(vertices=[vertex]))
        parts.append((role, obj))
    return parts, rig


class ReferenceTests(unittest.TestCase):
    def test_existing_default_export_rejected_before_authoring(self):
        tree = ast.parse((ROOT / 'scripts/characters/build-human.py').read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'character_output_directory')
        scope = {'Path': Path, 're': re}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<output-guard>', 'exec'), scope)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(scope['character_output_directory'](root, []), root / '.build/characters')
            (root / '.build/characters').mkdir(parents=True)
            with self.assertRaises(ValueError): scope['character_output_directory'](root, [])

    def test_retains_tiny_and_fifth_weight_without_mutation(self):
        parts, rig = fixture()
        before = [g.weight for g in parts[0][1].data.vertices[0].groups]
        result = module.build_weight_reference(parts, rig, [])
        self.assertEqual([g.weight for g in parts[0][1].data.vertices[0].groups], before)
        self.assertEqual(result['meshes'][0]['vertices'][0]['weights'][-1], {'bone': 'Bone4', 'value': .00001})
        self.assertFalse(result['runtimeQualified'])
        self.assertFalse(result['sourceWeightsAdjusted'])

    def test_missing_role(self):
        parts, rig = fixture()
        with self.assertRaises(ValueError): module.build_weight_reference(parts[:-1], rig, [])

    def test_duplicate_mesh(self):
        parts, rig = fixture(); parts[1][1].name = parts[0][1].name
        with self.assertRaises(ValueError): module.build_weight_reference(parts, rig, [])

    def test_wrong_rig(self):
        parts, rig = fixture(); parts[0][1].modifiers[0].object = S()
        with self.assertRaises(ValueError): module.build_weight_reference(parts, rig, [])

    def test_nonfinite_position(self):
        parts, rig = fixture(); parts[0][1].data.vertices[0].co = (math.nan, 0, 0)
        with self.assertRaises(ValueError): module.build_weight_reference(parts, rig, [])

    def test_invalid_weights(self):
        for value in (math.nan, math.inf, -1, 0, .5):
            with self.subTest(value=value):
                parts, rig = fixture(); parts[0][1].data.vertices[0].groups[0].weight = value
                with self.assertRaises(ValueError): module.build_weight_reference(parts, rig, [])

    def test_unknown_group(self):
        parts, rig = fixture(); parts[0][1].data.vertices[0].groups[0].group = 100
        with self.assertRaises(ValueError): module.build_weight_reference(parts, rig, [])

    def test_weight_above_one_rejected_within_sum_tolerance(self):
        parts, rig = fixture()
        parts[0][1].data.vertices[0].groups = [S(group=0, weight=1.00005)]
        with self.assertRaises(ValueError): module.build_weight_reference(parts, rig, [])

    def test_excess_influences(self):
        parts, rig = fixture(); rig.data.bones = [S(name=f'Bone{i}', use_deform=True) for i in range(9)]
        parts[0][1].vertex_groups = [S(index=i, name=f'Bone{i}') for i in range(9)]
        parts[0][1].data.vertices[0].groups = [S(group=i, weight=1/9) for i in range(9)]
        with self.assertRaises(ValueError): module.build_weight_reference(parts, rig, [])

    def test_hash_binding_and_no_overwrite(self):
        parts, rig = fixture()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            for name in ('human-candidate.blend', 'human-candidate.fbx'): (output / name).write_bytes(name.encode())
            result = module.write_weight_reference(output, parts, rig)
            self.assertEqual(len(result['artifacts']), 2)
            self.assertEqual(len(result['generatorSha256']), 64)
            self.assertEqual(json.loads((output / 'human-candidate.weights.json').read_text()), result)
            (output / 'human-candidate.fbx').write_bytes(b'changed')
            self.assertNotEqual(module.artifact_fingerprint(output / 'human-candidate.fbx'), result['artifacts'][1])
            with self.assertRaises(FileExistsError): module.write_weight_reference(output, parts, rig)


if __name__ == '__main__': unittest.main()
