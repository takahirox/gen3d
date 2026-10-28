"""Deterministic real Blender fixtures for #38; invoked by workflow-blender-check.

Can also reproduce the old guard with --baseline /path/to/old/preservation.py.
"""
import bpy
import hashlib
import importlib.util
import json
import os
import sys
from mathutils import Matrix


def check_selection_preview(p, source, preview):
    """Measure the actual AssetLibrary picker GLB against the evaluated source."""
    import struct

    def surfaces():
        result = {}
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for obj in bpy.context.scene.objects:
            if obj.type != 'MESH':
                continue
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            try:
                mesh.calc_loop_triangles()
                points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
                result[obj.get('gen3d_part', obj.name)] = sorted(
                    sorted(tuple(points[i]) for i in triangle.vertices)
                    for triangle in mesh.loop_triangles)
            finally:
                evaluated.to_mesh_clear()
        return result

    p.open_base(source)
    expected = surfaces()
    # Mapping is checked on GLB mesh nodes, not inferred from renamed Blender IDs.
    with open(preview, 'rb') as f:
        raw = f.read()
    doc = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
    nodes = [n for n in doc['nodes'] if 'mesh' in n]
    names = [n.get('extras', {}).get('gen3d_part') for n in nodes]
    assert len(names) == len(expected) and set(names) == set(expected), names
    assert all('skin' not in n for n in nodes), 'Picker must contain only static evaluated surfaces'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=preview)
    actual = surfaces()
    assert set(actual) == set(expected)
    measurements = []
    for name in sorted(expected):
        assert len(expected[name]) == len(actual[name]), name
        error = max((sum((a - b) ** 2 for a, b in zip(before, after)) ** 0.5
                     for t1, t2 in zip(expected[name], actual[name])
                     for before, after in zip(t1, t2)), default=0)
        assert error < 0.00001, (name, error)
        measurements.append({'part': name, 'triangles': len(expected[name]), 'maxSurfaceError': error})
    return {'exactPartMapping': names, 'evaluatedSurfaces': measurements}


def fixture(directory):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm = bpy.data.armatures.new('Skeleton')
    rig = bpy.data.objects.new('Rig', arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    spine = arm.edit_bones.new('mixamorig:Spine')
    spine.head, spine.tail, spine.roll = (0, 0, 0), (0, 0, 1), 0.23
    child = arm.edit_bones.new('mixamorig:Head')
    child.head, child.tail, child.parent = (0, 0, 1), (0.2, 0, 2), spine
    bpy.ops.object.mode_set(mode='OBJECT')
    spine = rig.pose.bones['mixamorig:Spine']
    spine.rotation_mode = 'XYZ'
    spine.rotation_euler.x = 0.3
    spine.location.x = 0.08
    child = rig.pose.bones['mixamorig:Head']
    child.rotation_mode = 'XYZ'
    child.rotation_euler.z = -0.2
    mat = bpy.data.materials.new('Skin')
    mat.use_nodes = True
    for name, z, radius in [('Body', 0.8, 0.6), ('Hair', 1.8, 0.25)]:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=(0, 0, z))
        obj = bpy.context.object
        obj.name = name
        obj.parent = rig
        obj.data.materials.append(mat)
        for bone, weight in [('mixamorig:Spine', 0.3), ('mixamorig:Head', 0.7)]:
            group = obj.vertex_groups.new(name=bone)
            group.add(list(range(len(obj.data.vertices))), weight, 'REPLACE')
        modifier = obj.modifiers.new('Skin', 'ARMATURE')
        modifier.object = rig
    # A non-bone parent and transformed mesh placement exercise local/world
    # representation independently of the bone basis and GLB seam splits.
    parent = bpy.data.objects.new('Character', None)
    bpy.context.scene.collection.objects.link(parent)
    rig.parent = parent
    source = os.path.join(directory, 'posed.blend')
    bpy.ops.wm.save_as_mainfile(filepath=source, compress=False)
    return source


def run(p, directory):
    os.makedirs(directory, exist_ok=True)
    source = fixture(directory)
    sha = lambda f: hashlib.sha256(open(f, 'rb').read()).hexdigest()
    original_hash = sha(source)
    scope = {'editableObjects': ['Hair'], 'allowChanges': [], 'allowNewObjects': False}
    evidence = {'realBlender': True, 'blender': bpy.app.version_string, 'codexUsed': False, 'valid': [], 'blocked': []}

    def blocked(label, action):
        try:
            action()
        except RuntimeError as error:
            evidence['blocked'].append({'case': label, 'diagnostic': str(error)})
        else:
            raise AssertionError('Expected rejection: ' + label)

    for kind, asset in [('blend', source), ('glb', directory + '/blend/base.glb')]:
        prepared = directory + '/' + kind
        os.makedirs(prepared, exist_ok=True)
        p.prepare(asset, prepared, scope)
        baseline = p.snapshot()
        rig = bpy.data.objects['Rig']
        assert rig.data.pose_position == 'POSE'
        assert abs(rig.pose.bones['mixamorig:Spine'].matrix_basis[1][2]) > 0.1
        assert rig.data.bones['mixamorig:Head'].parent.name == 'mixamorig:Spine'
        # A quaternion/Euler authoring change with the identical basis is a
        # valid representation, not an edit or a loss of pose.
        spine = rig.pose.bones['mixamorig:Spine']
        basis = spine.matrix_basis.copy()
        rotation = basis.to_quaternion()
        spine.rotation_mode = 'QUATERNION'
        spine.rotation_quaternion = rotation
        bpy.context.view_layer.update()
        p.compare(baseline, p.snapshot(), scope, False)
        blocked(kind + ' no-op', lambda: p.compare(baseline, p.snapshot(), scope))
        hair = bpy.data.objects['Hair']
        for v in hair.data.vertices:
            v.co.x *= 1.15
        candidate, exported = prepared + '/edited.blend', prepared + '/edited.glb'
        bpy.ops.wm.save_as_mainfile(filepath=candidate, compress=False)
        p.export_glb(exported)
        report = p.validate(prepared + '/baseline.json', scope, candidate, exported, prepared + '/preservation.json')
        assert report['changed'][0]['object'] == 'Hair'
        assert 'Body' in report['unchangedObjects'] and 'Rig' in report['unchangedObjects']
        assert report['roundtrip']['passed']
        scene = p.snapshot(True)
        p.open_base(exported)
        p.compare(scene, p.snapshot(True), {'editableObjects': []}, False)
        # Import/re-export AGAIN: a single visually plausible import cannot
        # establish that the rig and its bind frame are reusable.
        p.export_glb(prepared + '/reexported.glb')
        p.open_base(prepared + '/reexported.glb')
        p.compare(scene, p.snapshot(True), {'editableObjects': []}, False)
        evidence['valid'].append({'source': kind, 'meshEdit': report['changed'], 'roundtrip': True, 'reexportRoundtrip': True})

        for mutation in ['spine-pose', 'child-pose', 'hierarchy', 'bind', 'weights', 'protected-geometry', 'pose-position', 'mesh-bone-parent']:
            p.open_base(candidate)
            rig = bpy.data.objects['Rig']
            if mutation.endswith('-pose'):
                name = 'mixamorig:Spine' if mutation == 'spine-pose' else 'mixamorig:Head'
                rig.pose.bones[name].location.y += 0.1
            elif mutation in {'hierarchy', 'bind'}:
                bpy.context.view_layer.objects.active = rig
                bpy.ops.object.mode_set(mode='EDIT')
                child = rig.data.edit_bones['mixamorig:Head']
                if mutation == 'hierarchy':
                    child.parent = None
                else:
                    child.head.x += 0.12
                bpy.ops.object.mode_set(mode='OBJECT')
            elif mutation == 'weights':
                bpy.data.objects['Body'].vertex_groups['mixamorig:Spine'].add([0], 0.5, 'REPLACE')
            elif mutation == 'protected-geometry':
                bpy.data.objects['Body'].data.vertices[0].co.x += 0.01
            elif mutation == 'mesh-bone-parent':
                bpy.data.objects['Hair'].parent_type = 'BONE'
                bpy.data.objects['Hair'].parent_bone = 'mixamorig:Head'
            else:
                rig.data.pose_position = 'REST'
            changed_blend = prepared + '/' + mutation + '.blend'
            bpy.ops.wm.save_as_mainfile(filepath=changed_blend, compress=False)
            report_file = prepared + '/' + mutation + '-validation.json'
            blocked(kind + ' ' + mutation, lambda: p.validate(prepared + '/baseline.json', scope, changed_blend, exported, report_file))
            assert not os.path.exists(report_file)

        p.open_base(candidate)
        rig = bpy.data.objects['Rig']
        rig.pose.bones['mixamorig:Head'].location.x += 0.15
        p.export_glb(prepared + '/broken-pose.glb')
        blocked(kind + ' export-only child pose', lambda: p.validate(prepared + '/baseline.json', scope, candidate, prepared + '/broken-pose.glb', prepared + '/broken-validation.json'))
        # The old default exporter loses the pose while retaining bind/weights.
        p.open_base(candidate)
        bpy.ops.export_scene.gltf(filepath=prepared + '/reset-export.glb', export_format='GLB', export_apply=False, export_animations=False)
        blocked(kind + ' default exporter lost pose', lambda: p.validate(prepared + '/baseline.json', scope, candidate, prepared + '/reset-export.glb', prepared + '/reset-validation.json'))
        assert not os.path.exists(prepared + '/broken-validation.json')
        assert not os.path.exists(prepared + '/reset-validation.json')

    # Ordinary scale transforms coexist with rotations and translated joints.
    p.open_base(source)
    rig = bpy.data.objects['Rig']
    rig.pose.bones['mixamorig:Spine'].scale = (1.04, 1.04, 1.04)
    rig.pose.bones['mixamorig:Head'].scale = (1.02, 0.98, 1.0)
    scaled = directory + '/scaled'
    os.makedirs(scaled, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=scaled + '/source.blend', compress=False)
    p.prepare(scaled + '/source.blend', scaled, scope)
    for v in bpy.data.objects['Hair'].data.vertices:
        v.co.x *= 1.15
    bpy.ops.wm.save_as_mainfile(filepath=scaled + '/edited.blend', compress=False)
    p.export_glb(scaled + '/edited.glb')
    p.validate(scaled + '/baseline.json', scope, scaled + '/edited.blend', scaled + '/edited.glb', scaled + '/validation.json')
    evidence['valid'].append({'source': 'posed blend with bone scales', 'roundtrip': True, 'meshEdit': True})

    # Alter ONLY binary export data: scene validation still passes, so the
    # reopened GLB must independently catch bind loss and small surface drift.
    import struct
    exported = directory + '/blend/edited.glb'
    doc = p.preflight_glb(exported)
    original = open(exported, 'rb').read()
    binary_start = 28 + struct.unpack_from('<I', original, 12)[0]
    mesh_node = next(n for n in doc['nodes'] if n.get('name') == 'Body')
    for label, accessor_index, component in [
        ('inverse-bind', doc['skins'][0]['inverseBindMatrices'], 12),
        ('position-drift', doc['meshes'][mesh_node['mesh']]['primitives'][0]['attributes']['POSITION'], 0)
    ]:
        accessor = doc['accessors'][accessor_index]
        view = doc['bufferViews'][accessor['bufferView']]
        offset = binary_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0) + component * 4
        data = bytearray(original)
        value = struct.unpack_from('<f', data, offset)[0]
        struct.pack_into('<f', data, offset, value + (0.1 if label == 'inverse-bind' else 0.0001))
        file = directory + '/' + label + '.glb'
        with open(file, 'wb') as f:
            f.write(data)
        report_file = directory + '/' + label + '-validation.json'
        p.write(report_file, {'passed': True, 'stale': True})
        blocked('export-only ' + label, lambda: p.validate(directory + '/blend/baseline.json', scope, directory + '/blend/edited.blend', file, report_file))
        assert not os.path.exists(report_file)

    for feature in ['constraint', 'driver', 'animation', 'nla', 'data-driver', 'rest-display']:
        p.open_base(source)
        rig = bpy.data.objects['Rig']
        if feature == 'constraint':
            rig.pose.bones['mixamorig:Spine'].constraints.new('COPY_ROTATION')
        elif feature == 'driver':
            rig.pose.bones['mixamorig:Spine'].driver_add('location', 0)
        elif feature == 'data-driver':
            rig.data.driver_add('pose_position')
        elif feature in {'animation', 'nla'}:
            rig.pose.bones['mixamorig:Spine'].keyframe_insert('location')
            if feature == 'nla':
                action = rig.animation_data.action
                rig.animation_data.nla_tracks.new().strips.new('Authored motion', 1, action)
                rig.animation_data.action = None
        else:
            rig.data.pose_position = 'REST'
        file = directory + '/' + feature + '.blend'
        bpy.ops.wm.save_as_mainfile(filepath=file, compress=False)
        target = directory + '/unsupported-' + feature
        os.makedirs(target, exist_ok=True)
        blocked('unsupported ' + feature, lambda: p.prepare(file, target, scope))
        assert not os.path.exists(target + '/base-validation.json')

    # An omitted skeleton reference has an unambiguous named parent in this
    # fixture. Only metadata in a temporary copy changes; input bytes do not.
    glb = directory + '/blend/base.glb'
    doc = p.preflight_glb(glb)
    for skin in doc['skins']:
        skin.pop('skeleton', None)
    omitted = directory + '/omitted-skeleton.glb'
    p.write_glb_json(glb, omitted, doc)
    omitted_hash = sha(omitted)
    p.open_base(omitted)
    assert sha(omitted) == omitted_hash
    evidence['valid'].append({'source': 'glb without optional skeleton reference', 'unchangedSource': True})
    for skin in doc['skins']:
        skin.pop('inverseBindMatrices')
    missing = directory + '/missing-binds.glb'
    p.write_glb_json(glb, missing, doc)
    blocked('GLB missing explicit inverse binds', lambda: p.open_base(missing))
    assert original_hash == sha(source)
    evidence['sourceUnchanged'] = True
    evidence['sourceSha256'] = original_hash
    p.write(directory + '/report.json', evidence)
    return evidence


if __name__ == '__main__':
    if '--baseline' in sys.argv:
        baseline_file = sys.argv[sys.argv.index('--baseline') + 1]
        directory = os.path.abspath('.gen3d/posed-baseline')
        os.makedirs(directory, exist_ok=True)
        fixture(directory)
        spec = importlib.util.spec_from_file_location('baseline_preservation', baseline_file)
        baseline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(baseline)
        try:
            baseline.snapshot(True)
        except RuntimeError as error:
            assert str(error) == 'Protected GLB export requires a rest pose: mixamorig:Spine'
            baseline.write(directory + '/reproduction.json', {'realBlender': True, 'blender': bpy.app.version_string, 'diagnostic': str(error), 'fixture': 'scripts/posed-rig-check.py'})
        else:
            raise AssertionError('Baseline did not reproduce #38')
    else:
        sys.path.insert(0, os.path.abspath('blender'))
        import preservation
        run(preservation, os.path.abspath('.gen3d/posed-rig-check'))
