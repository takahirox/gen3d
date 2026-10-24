"""Complete-scene base editing with conservative, measured preservation.

No mesh-only copies. Unsupported GLB capabilities block rather than disappear.
"""
import bpy
import hashlib
import json
import os
import struct


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def nums(value):
    return [(round(float(v), 5) or 0.0) for v in value]


def material(m, semantic=False):
    if m is None:
        return None
    if not m.use_nodes:
        raise RuntimeError('Unsupported base material: enable a glTF-compatible Principled BSDF material: ' + m.name)
    allowed = {'OUTPUT_MATERIAL', 'BSDF_PRINCIPLED', 'TEX_IMAGE'}
    if any(n.type not in allowed for n in m.node_tree.nodes):
        raise RuntimeError('Unsupported procedural/material nodes in ' + m.name + '; bake/convert explicitly before authorizing this base')
    shaders = [n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED']
    if len(shaders) != 1:
        raise RuntimeError('Base material needs one glTF-compatible Principled BSDF: ' + m.name)
    shader = shaders[0]
    result = {k: nums(shader.inputs[k].default_value) if k == 'Base Color' else round(float(shader.inputs[k].default_value), 5) for k in ['Base Color', 'Metallic', 'Roughness', 'Alpha']}
    for socket in shader.inputs:
        if socket.is_linked and (socket.name not in {'Base Color', 'Alpha'} or any(link.from_node.type != 'TEX_IMAGE' for link in socket.links)):
            raise RuntimeError('Unsupported linked material input for protected export: ' + m.name + '.' + socket.name)
    if any(n.type == 'TEX_IMAGE' and any(s.is_linked for s in n.inputs) for n in m.node_tree.nodes):
        raise RuntimeError('Protected image materials require untransformed active UV coordinates: ' + m.name)
    result['links'] = {socket.name: sorted([digest(nums(link.from_node.image.pixels[:])), link.from_socket.name] for link in socket.links) for socket in shader.inputs if socket.is_linked}
    if not semantic:
        result['name'] = m.name
    result['images'] = sorted(digest(nums(n.image.pixels[:])) for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    return result


def snapshot(semantic=False):
    bpy.context.view_layer.update()
    objects = {}
    for o in bpy.context.scene.objects:
        if o.type not in {'MESH', 'ARMATURE', 'EMPTY'}:
            if o.type in {'CAMERA', 'LIGHT'}:
                continue
            raise RuntimeError('Unsupported base object type for protected GLB roundtrip: ' + o.type)
        if o.library or o.constraints or (o.animation_data and (o.animation_data.drivers or o.animation_data.action)):
            raise RuntimeError('Linked data, constraints, drivers and authored animations require explicit conversion before base editing: ' + o.name)
        record = {'type': o.type, 'parent': o.parent.name if o.parent else None, 'transform': [nums(row) for row in o.matrix_local]}
        if o.type == 'ARMATURE':
            record['armature'] = {b.name: {'parent': b.parent.name if b.parent else None, 'matrix': [nums(row) for row in b.matrix_local], 'deform': b.use_deform} for b in o.data.bones}
            for bone in o.pose.bones:
                if bone.constraints:
                    raise RuntimeError('Protected GLB export does not support bone constraints: ' + bone.name)
                if semantic and any(abs(bone.matrix_basis[i][j] - (1 if i == j else 0)) > 0.00001 for i in range(4) for j in range(4)):
                    raise RuntimeError('Protected GLB export requires a rest pose: ' + bone.name)
                if not semantic:
                    record['armature'][bone.name]['pose'] = [nums(row) for row in bone.matrix_basis]
                    record['armature'][bone.name]['length'] = round(bone.bone.length, 5)
        if o.type == 'MESH':
            if any(m.type != 'ARMATURE' for m in o.modifiers):
                raise RuntimeError('Unsupported base modifier: apply explicitly before approving base: ' + o.name)
            if o.data.shape_keys and (o.data.shape_keys.animation_data or not o.data.shape_keys.use_relative):
                raise RuntimeError('Driven/absolute shape keys are unsupported by protected GLB export: ' + o.name)
            mesh = o.data
            coords = [nums(o.matrix_world @ v.co if semantic else v.co) for v in mesh.vertices]
            if semantic:
                # glTF stores skinned geometry in a different local frame;
                # world-space surface/weights/morphs are the export invariant.
                record.pop('transform')
            # Ignore vertex ordering/splits at UV seams while retaining per-corner UVs.
            record['geometry'] = sorted(set(json.dumps(c) for c in coords)) if semantic else coords
            record['topology'] = sorted(json.dumps(sorted(coords[i] for i in p.vertices)) for p in mesh.polygons) if semantic else [list(p.vertices) for p in mesh.polygons]
            record['weights'] = sorted(set(json.dumps([coords[v.index] if semantic else v.index, sorted([o.vertex_groups[g.group].name, round(g.weight, 5)] for g in v.groups if g.weight > 0)]) for v in mesh.vertices if v.groups))
            record['armature'] = sorted(m.object.name for m in o.modifiers if m.type == 'ARMATURE' and m.object)
            record['shapeKeys'] = {k.name: {'value': round(k.value, 5), 'relative': k.relative_key.name if k.relative_key != mesh.shape_keys.key_blocks[0] else 'Basis', 'points': sorted(set(json.dumps([coords[i] if semantic else i, nums(o.matrix_world @ v.co if semantic else v.co)]) for i, v in enumerate(k.data)))} for k in mesh.shape_keys.key_blocks[1:]} if mesh.shape_keys else {}
            record['uvs'] = [sorted(json.dumps([coords[mesh.loops[i].vertex_index] if semantic else [i, mesh.loops[i].vertex_index], nums(v.uv)]) for i, v in enumerate(layer.data)) for layer in mesh.uv_layers]
            record['uvs'] = {'layers': record['uvs']}
            if not semantic:
                record['uvs'].update({'names': [layer.name for layer in mesh.uv_layers], 'active': mesh.uv_layers.active_index, 'render': [layer.active_render for layer in mesh.uv_layers]})
            record['materials'] = {'slots': [material(m, semantic) for m in mesh.materials], 'faces': sorted(json.dumps([sorted(coords[i] for i in p.vertices) if semantic else p.index, p.material_index]) for p in mesh.polygons)}
        objects[o.name] = record
    if not any(o['type'] == 'MESH' for o in objects.values()):
        raise RuntimeError('Base has no editable meshes')
    return {'objects': objects}


def preflight_glb(file):
    with open(file, 'rb') as f:
        content = f.read()
    if content[:4] != b'glTF' or len(content) < 20:
        raise RuntimeError('Invalid GLB base')
    length = struct.unpack_from('<I', content, 12)[0]
    gltf = json.loads(content[20:20 + length])
    if gltf.get('extensionsUsed'):
        raise RuntimeError('Editable-base preservation does not support these GLB extensions: ' + ', '.join(gltf['extensionsUsed']))
    if gltf.get('animations'):
        raise RuntimeError('Authored GLB animations are unsupported for protected editing; convert explicitly before authorization')
    nodes = gltf.get('nodes', [])
    names = [n.get('name') for n in nodes]
    if any(not n for n in names) or len(set(names)) != len(names):
        raise RuntimeError('Editable GLB base requires unique named nodes for protection evidence')
    for mesh in gltf.get('meshes', []):
        targets = max((len(p.get('targets', [])) for p in mesh['primitives']), default=0)
        if targets and len(mesh.get('extras', {}).get('targetNames', [])) != targets:
            raise RuntimeError('GLB morph targets require explicit names to preserve expressions')
        for primitive in mesh['primitives']:
            if primitive.get('mode', 4) != 4 or 'JOINTS_1' in primitive.get('attributes', {}):
                raise RuntimeError('Protected GLB base supports triangle primitives and up to four skin influences per vertex')
    return gltf


def open_base(file):
    if file.lower().endswith('.blend'):
        bpy.ops.wm.open_mainfile(filepath=file, use_scripts=False)
        if len([s for s in bpy.data.scenes if any(o.type in {'MESH', 'ARMATURE'} for o in s.objects)]) != 1:
            raise RuntimeError('Base must have one modeling scene; multi-scene GLB preservation is unsupported')
    else:
        gltf = preflight_glb(file)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=file, disable_bone_shape=True, bone_heuristic='BLENDER')
        bones = {b.name for o in bpy.context.scene.objects if o.type == 'ARMATURE' for b in o.data.bones}
        required_bones = {gltf['nodes'][i]['name'] for skin in gltf.get('skins', []) for i in skin['joints']}
        if bones != required_bones:
            raise RuntimeError('GLB skeleton import mismatch; protected editing blocked')
        required_keys = {name for m in gltf.get('meshes', []) for name in m.get('extras', {}).get('targetNames', [])}
        imported_keys = {k.name for o in bpy.context.scene.objects if o.type == 'MESH' and o.data.shape_keys for k in o.data.shape_keys.key_blocks[1:]}
        if imported_keys != required_keys:
            raise RuntimeError('GLB morph import mismatch; protected editing blocked')
    # Packed copies retain all scene/rig relationships, UVs, keys and materials.
    bpy.ops.file.pack_all()


def compare(before, after, scope, require_change=True):
    editable = set(scope['editableObjects'])
    allowed = set(scope.get('allowChanges', []))
    old = before['objects']
    new = after['objects']
    missing = sorted(set(old) - set(new))
    if missing:
        raise RuntimeError('Protected base objects removed/renamed: ' + ', '.join(missing))
    added = sorted(set(new) - set(old))
    if added and not scope.get('allowNewObjects', False):
        raise RuntimeError('New objects are outside authorized scope: ' + ', '.join(added))
    changed = []
    protected = []
    for name, original in old.items():
        current = new[name]
        changes = [key for key in set(original) | set(current) if digest(original.get(key)) != digest(current.get(key))]
        if not changes:
            protected.append(name)
            continue
        if name not in editable:
            raise RuntimeError('Protected object changed: ' + name + ' (' + ', '.join(changes) + ')')
        for key in changes:
            if key not in {'geometry', 'topology', 'transform'} and key not in allowed:
                raise RuntimeError('Protected feature changed: ' + name + '.' + key)
        changed.append({'object': name, 'features': changes})
    if require_change and not changed and not added:
        raise RuntimeError('No authorized model edit detected')
    return {'passed': True, 'changed': changed, 'unchangedObjects': protected, 'addedObjects': added, 'beforeHash': digest(before), 'afterHash': digest(after), 'scope': scope}


def write(file, value):
    with open(file, 'w') as f:
        json.dump(value, f, indent=2)


def prepare(source, directory, scope):
    open_base(source)
    before = snapshot()
    semantic_before = snapshot(True)
    for name in scope['editableObjects']:
        if name not in before['objects'] or before['objects'][name]['type'] != 'MESH':
            raise RuntimeError('Editable scope must name existing mesh objects: ' + name)
    # Triangulation is a prerequisite; glTF triangulates and would otherwise
    # change topology evidence. Explicitly block rather than silently normalize.
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and any(len(p.vertices) != 3 for p in o.data.polygons):
            raise RuntimeError('Triangulate base meshes before authorization for exact GLB preservation: ' + o.name)
    blend = os.path.join(directory, 'base.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=False)
    write(os.path.join(directory, 'baseline.json'), before)
    glb = os.path.join(directory, 'base.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=False, export_yup=True, export_animations=False)
    open_base(glb)
    after = snapshot(True)
    write(os.path.join(directory, 'roundtrip-before.json'), semantic_before)
    write(os.path.join(directory, 'roundtrip-after.json'), after)
    # A format roundtrip must preserve every declared feature before any edit.
    report = compare(semantic_before, after, {'editableObjects': [], 'allowChanges': [], 'allowNewObjects': False}, False)
    report['kind'] = 'base-glb-roundtrip'
    write(os.path.join(directory, 'base-validation.json'), report)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)


def validate(baseline_file, scope, blend, glb, report_file):
    with open(baseline_file) as f:
        baseline = json.load(f)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
    final = snapshot()
    semantic_final = snapshot(True)
    report = compare(baseline, final, scope)
    open_base(glb)
    roundtrip = snapshot(True)
    # The export itself has no permission to change additional features.
    export_report = compare(semantic_final, roundtrip, {'editableObjects': [], 'allowChanges': [], 'allowNewObjects': False}, False)
    report['roundtrip'] = export_report
    report['kind'] = 'edited-scene-and-glb-preservation'
    write(report_file, report)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
    return report
