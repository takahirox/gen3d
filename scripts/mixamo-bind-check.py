"""Deterministic glTF-authored #40 fixtures and real Blender preservation checks.

No downloaded model or Blender-exported input: the source matrices, skin and
binary data are encoded here independently of Blender's importer/exporter.
"""
import bpy
import hashlib
import importlib.util
import json
import os
import struct
import sys
from mathutils import Matrix, Vector


def flat(matrix):
    return [v for row in matrix.transposed() for v in row]


def fixture(file, posed=False, scale=(1, 1, 1), skeleton='hip', morph=False):
    binary, views, accessors = bytearray(), [], []

    def accessor(rows, kind, fmt='f', component=5126):
        binary.extend(b'\0' * (-len(binary) % 4))
        start = len(binary)
        for row in rows:
            binary.extend(struct.pack('<' + fmt * len(row), *row))
        views.append({'buffer': 0, 'byteOffset': start, 'byteLength': len(binary) - start})
        entry = {'bufferView': len(views) - 1, 'componentType': component, 'count': len(rows), 'type': kind}
        if kind == 'VEC3':
            entry.update({'min': [min(v[i] for v in rows) for i in range(3)], 'max': [max(v[i] for v in rows) for i in range(3)]})
        accessors.append(entry)
        return len(accessors) - 1

    parent = Matrix.Translation((.1, -.05, .02)) @ Matrix.Rotation(-.12, 4, 'Z')
    armature = Matrix.Translation((.3, .2, -.1)) @ Matrix.Rotation(.23, 4, 'Y') @ Matrix.Diagonal((*scale, 1))
    rest = Matrix.Translation((0, 1, 0)) @ Matrix.Rotation(.18, 4, 'Y')
    child = Matrix.Translation((0, .7, 0))
    pose = rest @ Matrix.Translation((.08 if posed else 0, 0, 0)) @ Matrix.Rotation(.3 if posed else 0, 4, 'X')
    child_pose = child @ Matrix.Rotation(-.2 if posed else 0, 4, 'Z')
    nodes = [
        {'name': 'Character', 'matrix': flat(parent), 'children': [1, 4]},
        {'name': 'Rig', 'matrix': flat(armature), 'children': [2]},
        {'name': 'mixamorig:Hips', 'matrix': flat(pose), 'children': [3]},
        {'name': 'mixamorig:Spine', 'matrix': flat(child_pose)},
        # glTF ignores skinned mesh node/parent transforms in skin evaluation.
        # Keep deliberately nonidentity mesh ancestry to catch double application.
        {'name': 'MeshParent', 'translation': [2, 3, 4], 'children': [5, 6]},
        {'name': 'Body', 'mesh': 0, 'skin': 0, 'translation': [4, 0, 0]},
        {'name': 'Hair', 'mesh': 1, 'skin': 0, 'rotation': [0, 0, .1, (1-.01)**.5]},
    ]
    binds = [parent @ armature @ rest, parent @ armature @ rest @ child]
    inverse_binds = accessor([flat(m.inverted()) for m in binds], 'MAT4')
    meshes = []
    for y in [1, 2]:
        positions = accessor([(-.2, y, 0), (.2, y, 0), (0, y+.3, 0)], 'VEC3')
        normals = accessor([(0, 0, 1)] * 3, 'VEC3')
        joints = accessor([(0, 1, 0, 0)] * 3, 'VEC4', 'H', 5123)
        weights = accessor([(.3, .7, 0, 0)] * 3, 'VEC4')
        primitive = {'attributes': {'POSITION': positions, 'NORMAL': normals, 'JOINTS_0': joints, 'WEIGHTS_0': weights}}
        mesh = {'primitives': [primitive]}
        if morph and y == 1:
            primitive['targets'] = [{'POSITION': accessor([(0, 0, 0), (0, 0, 0), (.03, 0, .01)], 'VEC3')}]
            mesh.update({'extras': {'targetNames': ['Smile']}, 'weights': [.35]})
        meshes.append(mesh)
    skin = {'joints': [2, 3], 'inverseBindMatrices': inverse_binds}
    if skeleton != 'omitted':
        skin['skeleton'] = {'hip': 2, 'armature': 1, 'ancestor': 0}[skeleton]
    doc = {'asset': {'version': '2.0', 'generator': 'gen3d issue40 deterministic fixture'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes, 'meshes': meshes, 'skins': [skin], 'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(binary)}]}
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    with open(file, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 28+len(encoded)+len(binary)) + struct.pack('<I4s', len(encoded), b'JSON') + encoded + struct.pack('<I4s', len(binary), b'BIN\0') + binary)
    return doc


def source_evidence(p, file):
    doc = p.preflight_glb(file)
    worlds, parents = p.glb_worlds(doc)
    return {'nodes': doc['nodes'], 'skins': doc['skins'], 'worldMatrices': {doc['nodes'][i]['name']: [list(row) for row in matrix] for i, matrix in worlds.items()}, 'parents': {doc['nodes'][i]['name']: doc['nodes'][j]['name'] for i, j in parents.items()}, 'inverseBinds': [p.glb_accessor(file, doc, skin['inverseBindMatrices']) for skin in doc['skins']]}


def imported_evidence():
    bpy.context.view_layer.update()
    objects = {}
    for obj in bpy.context.scene.objects:
        record = {'type': obj.type, 'parent': obj.parent.name if obj.parent else None, 'worldMatrix': [list(row) for row in obj.matrix_world]}
        if obj.type == 'ARMATURE':
            record['bones'] = {b.name: {'parent': b.parent.name if b.parent else None, 'rest': [list(row) for row in obj.matrix_world @ b.bone.matrix_local], 'pose': [list(row) for row in obj.matrix_world @ b.matrix], 'basis': [list(row) for row in b.matrix_basis]} for b in obj.pose.bones}
        elif obj.type == 'MESH':
            record['bindPoints'] = [list(obj.matrix_world @ v.co) for v in obj.data.vertices]
            record['weights'] = [[[obj.vertex_groups[g.group].name, g.weight] for g in v.groups] for v in obj.data.vertices]
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            mesh = evaluated.to_mesh()
            try:
                record['evaluatedPoints'] = [list(evaluated.matrix_world @ v.co) for v in mesh.vertices]
            finally:
                evaluated.to_mesh_clear()
        objects[obj.name] = record
    return objects


def import_matrix_errors(p, source, baseline=False):
    doc = p.preflight_glb(source)
    worlds, _ = p.glb_worlds(doc)
    to_blender = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    rig = bpy.data.objects['Rig']
    skin = doc['skins'][0]
    errors = {}
    for joint, values in zip(skin['joints'], p.glb_accessor(source, doc, skin['inverseBindMatrices'])):
        name = doc['nodes'][joint]['name']
        bone = rig.pose.bones[name]
        expected = to_blender @ p.matrix_from_gltf(values).inverted()
        actual = rig.matrix_world @ bone.bone.matrix_local
        posed = to_blender @ worlds[joint]
        errors[name] = {'maxRestMatrixError': max(abs(a-b) for a, b in zip(flat(expected), flat(actual))), 'maxPoseMatrixError': max(abs(a-b) for a, b in zip(flat(posed), flat(rig.matrix_world @ bone.matrix)))}
        if baseline:
            duplicated = to_blender @ worlds[1] @ p.matrix_from_gltf(values).inverted()
            errors[name]['maxDuplicatedArmatureFrameError'] = max(abs(a-b) for a, b in zip(flat(duplicated), flat(actual)))
            assert errors[name]['maxDuplicatedArmatureFrameError'] <= .00002
    return errors


def measurements(p, source, exported):
    """Compare raw GLB joint worlds/IBMs/weights/protected surfaces, no import."""
    docs = [p.preflight_glb(file) for file in [source, exported]]
    worlds = [p.glb_worlds(doc)[0] for doc in docs]
    nodes = [{n['name']: i for i, n in enumerate(doc['nodes'])} for doc in docs]
    result = {'maxJointWorldError': 0, 'maxInverseBindError': 0, 'maxRestWorldError': 0, 'maxProtectedBindPositionError': 0, 'maxProtectedBindNormalError': 0, 'maxProtectedSurfaceError': 0, 'maxWeightError': 0}
    for name in ['mixamorig:Hips', 'mixamorig:Spine']:
        matrices, inverses = [], []
        for file, doc, world, mapping in zip([source, exported], docs, worlds, nodes):
            joint = mapping[name]
            matrices.append(flat(world[joint]))
            skin = doc['skins'][0]
            inverses.append(p.glb_accessor(file, doc, skin['inverseBindMatrices'])[skin['joints'].index(joint)])
        result['maxJointWorldError'] = max(result['maxJointWorldError'], max(abs(a-b) for a, b in zip(*matrices)))
        result['maxInverseBindError'] = max(result['maxInverseBindError'], max(abs(a-b) for a, b in zip(*inverses)))
        rest = [flat(p.matrix_from_gltf(values).inverted()) for values in inverses]
        result['maxRestWorldError'] = max(result['maxRestWorldError'], max(abs(a-b) for a, b in zip(*rest)))
    points, evaluated, influences, normals = [], [], [], []
    for file, doc, world, mapping in zip([source, exported], docs, worlds, nodes):
        node = doc['nodes'][mapping['Body']]
        skin = doc['skins'][node['skin']]
        primitive = doc['meshes'][node['mesh']]['primitives'][0]
        attrs = primitive['attributes']
        values = {key: p.glb_accessor(file, doc, index) for key, index in attrs.items()}
        inverse = [p.matrix_from_gltf(row) for row in p.glb_accessor(file, doc, skin['inverseBindMatrices'])]
        morphs = [p.glb_accessor(file, doc, t['POSITION']) for t in primitive.get('targets', [])]
        morph_weights = node.get('weights', doc['meshes'][node['mesh']].get('weights', []))
        rows, visible, weights = [], [], []
        for i, position in enumerate(values['POSITION']):
            rows.append(position)
            v = Vector(position)
            for target, weight in zip(morphs, morph_weights):
                v += weight * Vector(target[i])
            skin_point = Vector((0, 0, 0))
            named = {}
            for j, weight in zip(values['JOINTS_0'][i], values['WEIGHTS_0'][i]):
                if weight:
                    joint = skin['joints'][j]
                    skin_point += weight * (world[joint] @ inverse[j] @ v)
                    named[doc['nodes'][joint]['name']] = weight
            visible.append(skin_point)
            weights.append(named)
        points.append(rows)
        evaluated.append(visible)
        influences.append(weights)
        normals.append(values['NORMAL'])
    assert len(points[0]) == len(points[1])
    used = set()
    for i, point in enumerate(points[0]):
        j = min(range(len(points[1])), key=lambda j: (Vector(point)-Vector(points[1][j])).length)
        assert j not in used
        used.add(j)
        assert influences[0][i].keys() == influences[1][j].keys()
        result['maxProtectedBindPositionError'] = max(result['maxProtectedBindPositionError'], (Vector(point)-Vector(points[1][j])).length)
        result['maxProtectedSurfaceError'] = max(result['maxProtectedSurfaceError'], (evaluated[0][i]-evaluated[1][j]).length)
        result['maxProtectedBindNormalError'] = max(result['maxProtectedBindNormalError'], (Vector(normals[0][i])-Vector(normals[1][j])).length)
        result['maxWeightError'] = max(result['maxWeightError'], max(abs(influences[0][i][key]-influences[1][j][key]) for key in influences[0][i]))
    for field, error in result.items():
        assert error <= (.0002 if field == 'maxProtectedBindNormalError' else .00002), (field, error)
    return result


def run(p, directory, baseline_file=None):
    os.makedirs(directory, exist_ok=True)
    scope = {'editableObjects': ['Hair'], 'allowChanges': [], 'allowNewObjects': False}
    evidence = {'realBlender': True, 'blender': bpy.app.version_string, 'codexUsed': False, 'actualMixamoSample': False, 'valid': [], 'blocked': []}
    sha = lambda file: hashlib.sha256(open(file, 'rb').read()).hexdigest()

    def blocked(label, action, expected=None):
        try:
            action()
        except RuntimeError as error:
            if expected:
                assert expected in str(error), str(error)
            evidence['blocked'].append({'case': label, 'diagnostic': str(error)})
        else:
            raise AssertionError('Expected rejection: ' + label)

    variants = [('rest', {}), ('posed', {'posed': True}), ('scaled', {'posed': True, 'scale': (.01, .01, .01)}), ('morph', {'posed': True, 'morph': True}), ('omitted-skeleton', {'posed': True, 'skeleton': 'omitted'}), ('armature-skeleton', {'posed': True, 'skeleton': 'armature'}), ('ancestor-skeleton', {'posed': True, 'skeleton': 'ancestor'})]
    for label, options in variants:
        source = os.path.join(directory, label + '.glb')
        fixture(source, **options)
        original_hash = sha(source)
        versioned = os.path.abspath('docs/validation/issue40/' + label + '.glb')
        if os.path.exists(versioned):
            assert sha(versioned) == original_hash, 'Versioned fixture differs from its deterministic generator: ' + label
        if baseline_file and label in {'rest', 'posed'}:
            spec = importlib.util.spec_from_file_location('issue40_baseline', baseline_file)
            baseline = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(baseline)
            try:
                baseline.open_base(source)
            except RuntimeError as error:
                assert 'Unverifiable GLB bind/rest after import: mixamorig:Hips' in str(error), str(error)
                p.write(os.path.join(directory, label + '-baseline.json'), {'baselineCommit': '9ea358f941f267f7ea4c8e83a440ad46dedcf885', 'diagnostic': str(error), 'source': source_evidence(p, source), 'imported': imported_evidence(), 'matrixErrors': import_matrix_errors(p, source, True), 'realBlender': True, 'blender': bpy.app.version_string, 'coordinateConversion': 'C = ((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)); expected rest = C inverse(IBM), imported rest = C A inverse(IBM), A = armature world in glTF'})
            else:
                raise AssertionError('Baseline did not reproduce #40')
        prepared = os.path.join(directory, label)
        os.makedirs(prepared, exist_ok=True)
        p.prepare(source, prepared, scope)
        errors = import_matrix_errors(p, source)
        assert all(value <= .00002 for bone in errors.values() for value in bone.values())
        p.write(prepared + '/import-evidence.json', {'objects': imported_evidence(), 'matrixErrors': errors})
        for v in bpy.data.objects['Hair'].data.vertices:
            v.co.x *= 1.15
        candidate, exported = prepared + '/edited.blend', prepared + '/edited.glb'
        bpy.ops.wm.save_as_mainfile(filepath=candidate, compress=False)
        p.export_glb(exported)
        report = p.validate(prepared + '/baseline.json', scope, candidate, exported, prepared + '/preservation.json')
        assert report['passed'] and report['roundtrip']['passed']
        assert all(name in report['unchangedObjects'] for name in ['Body', 'Rig', 'Character'])
        direct = measurements(p, source, exported)
        p.open_base(exported)
        p.export_glb(prepared + '/reexported.glb')
        repeated = measurements(p, source, prepared + '/reexported.glb')
        assert sha(source) == original_hash
        evidence['valid'].append({'case': label, 'sha256': original_hash, 'sourceUnchanged': True, 'meshEdit': report['changed'], 'roundtrip': direct, 'reexportRoundtrip': repeated})

    prepared = os.path.join(directory, 'posed')
    candidate, exported = prepared + '/edited.blend', prepared + '/edited.glb'
    for mutation in ['hip-pose', 'child-parent', 'weights', 'surface']:
        p.open_base(candidate)
        rig = bpy.data.objects['Rig']
        if mutation == 'hip-pose':
            rig.pose.bones['mixamorig:Hips'].location.x += .1
        elif mutation == 'child-parent':
            bpy.context.view_layer.objects.active = rig
            bpy.ops.object.mode_set(mode='EDIT')
            rig.data.edit_bones['mixamorig:Spine'].parent = None
            bpy.ops.object.mode_set(mode='OBJECT')
        elif mutation == 'weights':
            bpy.data.objects['Body'].vertex_groups['mixamorig:Hips'].add([0], .5, 'REPLACE')
        else:
            bpy.data.objects['Body'].data.vertices[0].co.x += .01
        changed = prepared + '/' + mutation + '.blend'
        bpy.ops.wm.save_as_mainfile(filepath=changed, compress=False)
        target = prepared + '/' + mutation + '-validation.json'
        p.write(target, {'passed': True, 'stale': True})
        blocked('saved scene ' + mutation, lambda: p.validate(prepared + '/baseline.json', scope, changed, exported, target))
        assert not os.path.exists(target)
        p.export_glb(prepared + '/' + mutation + '.glb')
        blocked('export only ' + mutation, lambda: p.validate(prepared + '/baseline.json', scope, candidate, prepared + '/' + mutation + '.glb', target))
        assert not os.path.exists(target)

    doc = p.preflight_glb(exported)
    content = open(exported, 'rb').read()
    start = 28 + struct.unpack_from('<I', content, 12)[0]
    ibm = doc['accessors'][doc['skins'][0]['inverseBindMatrices']]
    offset = start + doc['bufferViews'][ibm['bufferView']].get('byteOffset', 0) + ibm.get('byteOffset', 0)
    for label in ['inverse-bind-drift', 'singular-bind', 'rest-scale', 'nonfinite-bind']:
        changed = bytearray(content)
        if label == 'inverse-bind-drift':
            value = struct.unpack_from('<f', changed, offset + 48)[0]
            struct.pack_into('<f', changed, offset + 48, value + .1)
        elif label == 'singular-bind':
            changed[offset:offset+64] = bytes(64)
        elif label == 'nonfinite-bind':
            struct.pack_into('<f', changed, offset, float('nan'))
        else:
            # Change one complete basis column so it is no longer a rigid rest.
            for i in range(3):
                value = struct.unpack_from('<f', changed, offset + i*4)[0]
                struct.pack_into('<f', changed, offset + i*4, value * 1.2)
        file = os.path.join(directory, label + '.glb')
        with open(file, 'wb') as f:
            f.write(changed)
        target = prepared + '/' + label + '-validation.json'
        p.write(target, {'passed': True, 'stale': True})
        blocked('export only ' + label, lambda: p.validate(prepared + '/baseline.json', scope, candidate, file, target))
        assert not os.path.exists(target)

    # Invalid source weights must not be normalized/repaired by the importer.
    source = os.path.join(directory, 'posed.glb')
    doc = p.preflight_glb(source)
    content = bytearray(open(source, 'rb').read())
    start = 28 + struct.unpack_from('<I', content, 12)[0]
    primitive = doc['meshes'][0]['primitives'][0]
    weights = doc['accessors'][primitive['attributes']['WEIGHTS_0']]
    offset = start + doc['bufferViews'][weights['bufferView']].get('byteOffset', 0)
    struct.pack_into('<4f', content, offset, 0, 0, 0, 0)
    file = os.path.join(directory, 'zero-weights.glb')
    with open(file, 'wb') as f:
        f.write(content)
    blocked('invalid source zero weights', lambda: p.open_base(file), 'Invalid GLB skin weights')
    doc['skins'][0]['skeleton'] = 4
    file = os.path.join(directory, 'wrong-skeleton.glb')
    p.write_glb_json(source, file, doc)
    blocked('source skeleton outside ancestry', lambda: p.open_base(file), 'skeleton differs')

    # Blender's exporter currently mis-transforms normals for a rotated,
    # nonuniformly scaled armature. Keep the measured rejection; no tolerance
    # relaxation or geometry/pose baking is permitted to hide that limitation.
    file = os.path.join(directory, 'nonuniform.glb')
    fixture(file, posed=True, scale=(1.2, .8, 1.1))
    target = os.path.join(directory, 'nonuniform')
    os.makedirs(target, exist_ok=True)
    blocked('nonuniform armature export normals', lambda: p.prepare(file, target, scope), 'GLB roundtrip')
    assert not os.path.exists(target + '/base-validation.json')
    p.write(os.path.join(directory, 'report.json'), evidence)
    return evidence


if __name__ == '__main__':
    sys.path.insert(0, os.path.abspath('blender'))
    import preservation
    output = os.path.abspath('.gen3d/mixamo-bind-check')
    baseline = sys.argv[sys.argv.index('--baseline') + 1] if '--baseline' in sys.argv else None
    run(preservation, output, baseline)
