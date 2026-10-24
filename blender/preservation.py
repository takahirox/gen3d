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
    if any(n.mute for n in m.node_tree.nodes):
        raise RuntimeError('Muted material nodes are unsupported for protected export: ' + m.name)
    shader = shaders[0]
    # Every accepted Principled input is protected, including emission, coat,
    # transmission and specular. A format that drops a non-default input fails
    # the measured roundtrip below rather than claiming to preserve it.
    result = {'inputs': {s.name: nums(s.default_value) if s.type in {'RGBA', 'VECTOR'} else round(float(s.default_value), 5) for s in shader.inputs}}
    settings = ['use_backface_culling', 'use_backface_culling_shadow', 'use_backface_culling_lightprobe_volume', 'surface_render_method', 'use_transparent_shadow', 'use_transparency_overlap']
    if not hasattr(m, 'surface_render_method'):
        settings += ['blend_method', 'alpha_threshold', 'show_transparent_back']
    result['settings'] = {name: getattr(m, name) for name in settings if hasattr(m, name)}
    result['shaderSettings'] = {name: getattr(shader, name) for name in ['distribution', 'subsurface_method'] if hasattr(shader, name)}
    outputs = [n for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL']
    if len(outputs) != 1 or not outputs[0].is_active_output or outputs[0].target != 'ALL' or len(outputs[0].inputs['Surface'].links) != 1 or outputs[0].inputs['Surface'].links[0].from_node != shader or any(s.is_linked for s in outputs[0].inputs if s.name != 'Surface'):
        raise RuntimeError('Protected material requires one direct Principled surface output: ' + m.name)
    for socket in shader.inputs:
        if socket.is_linked and (socket.name not in {'Base Color', 'Alpha'} or any(link.from_node.type != 'TEX_IMAGE' for link in socket.links)):
            raise RuntimeError('Unsupported linked material input for protected export: ' + m.name + '.' + socket.name)
    if any(n.type == 'TEX_IMAGE' and any(s.is_linked for s in n.inputs) for n in m.node_tree.nodes):
        raise RuntimeError('Protected image materials require untransformed active UV coordinates: ' + m.name)
    result['links'] = {socket.name: sorted([digest(nums(link.from_node.image.pixels[:])), link.from_socket.name] for link in socket.links) for socket in shader.inputs if socket.is_linked}
    if not semantic:
        result['name'] = m.name
    result['images'] = sorted(json.dumps({'pixels': digest(nums(n.image.pixels[:])), 'colorSpace': n.image.colorspace_settings.name, 'alphaMode': n.image.alpha_mode, 'interpolation': n.interpolation, 'extension': n.extension, 'projection': n.projection}, sort_keys=True) for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    return result


def expressions(o, coords, semantic=False):
    keys = o.data.shape_keys
    if not keys:
        return {}
    blocks = list(keys.key_blocks[1:])
    # glTF morph targets cannot retain Blender's vertex-group mask binding.
    # Do not silently bake or discard an approved expression configuration.
    for k in blocks:
        if semantic and k.vertex_group:
            raise RuntimeError('Unsupported expression vertex-group mask for protected GLB export: ' + o.name + '.' + k.name + ' (' + k.vertex_group + '); explicitly convert to an unmasked expression before authorizing this base')

    def evaluated_points():
        bpy.context.view_layer.update()
        evaluated = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            if len(mesh.vertices) != len(coords):
                raise RuntimeError('Unsupported evaluated expression topology: ' + o.name)
            return [(evaluated.matrix_world @ v.co if semantic else v.co).copy() for v in mesh.vertices]
        finally:
            evaluated.to_mesh_clear()

    values = [k.value for k in blocks]
    result = {}
    try:
        for k in blocks:
            k.value = 0
        neutral = evaluated_points()
        for index, k in enumerate(blocks):
            k.value = 1
            deformed = evaluated_points()
            k.value = 0
            group = o.vertex_groups.get(k.vertex_group)
            weights = [round(next((g.weight for g in v.groups if g.group == group.index), 0.0), 5) for v in o.data.vertices] if group else None
            result[k.name] = {
                'value': round(values[index], 5),
                'mute': k.mute,
                'relative': k.relative_key.name if k.relative_key != keys.key_blocks[0] else 'Basis',
                'mask': {'vertexGroup': k.vertex_group, 'weights': weights},
                'points': sorted(set(json.dumps([coords[i] if semantic else i, nums(o.matrix_world @ v.co if semantic else v.co)]) for i, v in enumerate(k.data))),
                # Measure the working expression, including masking/muting and
                # skinning, rather than inferring it from raw key coordinates.
                'deformation': sorted(set(json.dumps([coords[i] if semantic else i, nums(v - neutral[i])]) for i, v in enumerate(deformed)))
            }
    finally:
        for k, value in zip(blocks, values):
            k.value = value
        bpy.context.view_layer.update()
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
        # Visibility is part of the protected scene, including viewport hiding
        # and render/ray flags that glTF may not be able to represent.
        record['visibility'] = {name: getattr(o, name) for name in ['hide_render', 'hide_viewport', 'visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow', 'is_holdout', 'is_shadow_catcher'] if hasattr(o, name)}
        record['visibility']['hidden'] = o.hide_get()
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
            # Weights and a target name alone do not establish working skinning.
            # Preserve stack order, enable flags, binding mode and influence masks.
            record['armature'] = [{'object': m.object.name if m.object else None, 'settings': {name: getattr(m, name) for name in ['use_vertex_groups', 'use_bone_envelopes', 'use_deform_preserve_volume', 'use_multi_modifier', 'vertex_group', 'invert_vertex_group', 'show_viewport', 'show_render', 'show_in_editmode', 'show_on_cage']}} for m in o.modifiers]
            record['shapeKeys'] = expressions(o, coords, semantic)
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
    try:
        report = compare(semantic_before, after, {'editableObjects': [], 'allowChanges': [], 'allowNewObjects': False}, False)
    except RuntimeError as error:
        raise RuntimeError('Unsupported protected base GLB roundtrip: ' + str(error)) from error
    report['kind'] = 'base-glb-roundtrip'
    write(os.path.join(directory, 'base-validation.json'), report)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)


def validate(baseline_file, scope, blend, glb, report_file):
    with open(baseline_file) as f:
        baseline = json.load(f)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
    final = snapshot()
    report = compare(baseline, final, scope)
    semantic_final = snapshot(True)
    open_base(glb)
    roundtrip = snapshot(True)
    # The export itself has no permission to change additional features.
    try:
        export_report = compare(semantic_final, roundtrip, {'editableObjects': [], 'allowChanges': [], 'allowNewObjects': False}, False)
    except RuntimeError as error:
        raise RuntimeError('Protected candidate GLB roundtrip mismatch: ' + str(error)) from error
    report['roundtrip'] = export_report
    report['kind'] = 'edited-scene-and-glb-preservation'
    write(report_file, report)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
    return report
