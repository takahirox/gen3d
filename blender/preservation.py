"""Complete-scene base editing with conservative, measured preservation.

No mesh-only copies. Unsupported GLB capabilities block rather than disappear.
"""
import bpy
import hashlib
import json
import os
import struct
import tempfile
from mathutils import Matrix, Quaternion, Vector
from mathutils.kdtree import KDTree


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def nums(value):
    return [(round(float(v), 5) or 0.0) for v in value]


def oriented_face(corners):
    # A cyclic rotation describes the same face; reversing its corners does
    # not. Keep duplicates and corner associations, including split normals.
    return min(json.dumps(corners[i:] + corners[:i]) for i in range(len(corners)))


def same_geometry(before, after):
    if digest(before) == digest(after):
        return True
    # Saved scenes retain exact shading settings/normals. Only semantic GLB
    # evidence (without authoring flags) permits normal encoding roundoff.
    if not isinstance(before, dict) or not isinstance(after, dict) or 'shading' in before or 'shading' in after:
        return False
    if before['vertices'] != after['vertices']:
        return False

    def surfaces(geometry):
        result = {}
        for face in geometry['corners']:
            corners = json.loads(face)
            key = oriented_face([c[0] for c in corners])
            result.setdefault(key, []).append(corners)
        return result

    old, new = surfaces(before), surfaces(after)
    if old.keys() != new.keys():
        return False
    for key, faces in old.items():
        remaining = list(new[key])
        for face in faces:
            matched = False
            for index, candidate in enumerate(remaining):
                for offset in range(len(candidate)):
                    rotated = candidate[offset:] + candidate[:offset]
                    # Blender encodes imported custom normals with finite
                    # precision. Bound vector error to 0.0002 (~0.012 degrees)
                    # while keeping positions, orientation and multiplicity exact.
                    if len(face) == len(rotated) and all(a[0] == b[0] and sum((x - y) ** 2 for x, y in zip(a[1], b[1])) <= 0.0002 ** 2 for a, b in zip(face, rotated)):
                        remaining.pop(index)
                        matched = True
                        break
                if matched:
                    break
            if not matched:
                return False
        if remaining:
            return False
    return True


def evaluated_geometry(o, coords, semantic):
    evaluated = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        if len(mesh.vertices) != len(coords):
            raise RuntimeError('Unsupported evaluated skin topology: ' + o.name)
        points = [nums(evaluated.matrix_world @ v.co) for v in mesh.vertices]
        normal_matrix = evaluated.matrix_world.to_3x3().inverted().transposed()
        normals = [nums((normal_matrix @ n.vector).normalized()) for n in mesh.corner_normals]
        if not semantic:
            return {'points': points, 'normals': normals}
        # Bind positions identify corners through glTF seam splits/reordering.
        # Measure the visible result with current expressions AND skin enabled.
        return {'corners': sorted(oriented_face([[coords[mesh.loops[i].vertex_index], points[mesh.loops[i].vertex_index], normals[i]] for i in face.loop_indices]) for face in mesh.polygons)}
    finally:
        evaluated.to_mesh_clear()


def same_evaluation(before, after):
    if digest(before) == digest(after):
        return True
    if not before or not after or 'corners' not in before or 'corners' not in after:
        return False  # Saved scenes use exact vertex/corner identity.
    remaining = {}
    for face in after['corners']:
        corners = json.loads(face)
        remaining.setdefault(oriented_face([c[0] for c in corners]), []).append(corners)
    for face in before['corners']:
        corners = json.loads(face)
        key = oriented_face([c[0] for c in corners])
        matches = remaining.get(key, [])
        found = False
        for index, candidate in enumerate(matches):
            for offset in range(len(candidate)):
                rotated = candidate[offset:] + candidate[:offset]
                # Two five-decimal samples plus float32 skin evaluation can
                # straddle a rounding boundary. Bound positions to 2e-5 scene
                # units and normals to the existing GLB normal encoding bound.
                if len(corners) == len(rotated) and all(a[0] == b[0] and sum((x-y)**2 for x,y in zip(a[1],b[1])) <= 0.00002**2 and sum((x-y)**2 for x,y in zip(a[2],b[2])) <= 0.0002**2 for a,b in zip(corners,rotated)):
                    matches.pop(index)
                    found = True
                    break
            if found:
                break
        if not found:
            return False
    return not any(remaining.values())


def coordinate_map(before, after):
    if set(before) == set(after):
        return {value: value for value in after}
    if len(before) != len(after):
        raise RuntimeError('GLB surface position count changed')
    tree = KDTree(len(before))
    for i, value in enumerate(before):
        tree.insert(Vector(json.loads(value)), i)
    tree.balance()
    mapping = {}
    for value in after:
        matches = tree.find_range(Vector(json.loads(value)), 0.00002)
        if len(matches) != 1:
            raise RuntimeError('GLB surface positions differ or have ambiguous correspondence at 0.00002 scene units')
        mapping[value] = before[matches[0][1]]
    if len(set(mapping.values())) != len(before):
        raise RuntimeError('GLB surface position correspondence is not one-to-one')
    return mapping


def align_semantic_mesh(before, after):
    # Float32 inverse-bind retargeting can straddle five-decimal boundaries.
    # Establish a bounded bijection, then retain exact corner topology, weight,
    # UV and material associations. Never use this for saved-scene comparisons.
    mapping = coordinate_map(before['geometry']['vertices'], after['geometry']['vertices'])
    result = json.loads(json.dumps(after))

    def point(value):
        return json.loads(mapping[json.dumps(value)])

    def face(value):
        return oriented_face([point(p) for p in json.loads(value)])

    result['geometry']['vertices'] = sorted(mapping.values())
    result['geometry']['corners'] = sorted(oriented_face([[point(c[0]), c[1]] for c in json.loads(f)]) for f in result['geometry']['corners'])
    result['topology'] = sorted(face(f) for f in result['topology'])
    result['weights'] = sorted(json.dumps([point(row[0]), row[1]]) for row in map(json.loads, result['weights']))
    result['uvs']['layers'] = [sorted(json.dumps([point(row[0]), row[1]]) for row in map(json.loads, layer)) for layer in result['uvs']['layers']]
    result['materials']['faces'] = sorted(json.dumps([face(row[0]), row[1]]) for row in map(json.loads, result['materials']['faces']))
    result['evaluatedGeometry']['corners'] = sorted(oriented_face([[point(c[0]), c[1], c[2]] for c in json.loads(f)]) for f in result['evaluatedGeometry']['corners'])
    for key in result['shapeKeys'].values():
        for field in ['points', 'deformation']:
            key[field] = sorted(json.dumps([point(row[0]), row[1]]) for row in map(json.loads, key[field]))
    return result


def same_armature(before, after):
    # Scene basis/length/settings stay exact. Only semantic joint/rest matrices
    # cross float32 GLB encoding; hierarchy and inheritance stay exact there too.
    if not isinstance(before, dict) or not isinstance(after, dict) or before.keys() != after.keys():
        return digest(before) == digest(after)
    for name, bone in before.items():
        current = after[name]
        if 'posedMatrix' not in bone or 'posedMatrix' not in current:
            return digest(before) == digest(after)
        if bone.keys() != current.keys():
            return False
        for key in bone:
            if key in {'matrix', 'posedMatrix'}:
                if any(abs(x-y) > 0.00002 for a,b in zip(bone[key],current[key]) for x,y in zip(a,b)):
                    return False
            elif digest(bone[key]) != digest(current[key]):
                return False
    return True


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


def check_collection_visibility():
    # glTF has no collection/view-layer visibility model. Object hide flags
    # alone miss excluded or hidden ancestors (including ancestors of a rig).
    # Conservatively reject these configurations instead of flattening them
    # into apparently unchanged objects or successful scene/GLB evidence.
    scene = bpy.context.scene
    model_names = {o.name for o in scene.objects if o.type in {'MESH', 'ARMATURE', 'EMPTY'}}

    def blocked(objects, location, flags):
        if objects and flags:
            raise RuntimeError('Unsupported collection/view-layer visibility for protected GLB export: '
                               + sorted(objects)[0] + ' in ' + location + ' (' + ', '.join(flags)
                               + '); restore default visibility before base/candidate validation')

    def visit(layer_collection, layer_name, path):
        collection = layer_collection.collection
        path = path + [collection.name]
        objects = model_names.intersection(o.name for o in collection.all_objects)
        flags = ['collection.' + name for name in ['hide_render', 'hide_viewport'] if getattr(collection, name)]
        flags += ['layerCollection.' + name for name in ['exclude', 'hide_viewport', 'holdout', 'indirect_only'] if getattr(layer_collection, name)]
        blocked(objects, 'view layer ' + layer_name + ', collection ' + '/'.join(path), flags)
        for child in layer_collection.children:
            visit(child, layer_name, path)

    # Check every layer, not just the active one: a saved scene can render a
    # different layer, and exclusion must be detected before depsgraph probes.
    for layer in scene.view_layers:
        blocked(model_names, 'view layer ' + layer.name, [] if layer.use else ['viewLayer.use=False'])
        visit(layer.layer_collection, layer.name, [])
        if layer != bpy.context.view_layer:
            for o in layer.objects:
                blocked({o.name} & model_names, 'view layer ' + layer.name, ['object.hidden'] if o.hide_get(view_layer=layer) else [])


def snapshot(semantic=False):
    check_collection_visibility()
    bpy.context.view_layer.update()
    objects = {}
    for o in bpy.context.scene.objects:
        if o.type not in {'MESH', 'ARMATURE', 'EMPTY'}:
            if o.type in {'CAMERA', 'LIGHT'}:
                continue
            raise RuntimeError('Unsupported base object type for protected GLB roundtrip: ' + o.type)
        if o.library or o.constraints or any(data and data.animation_data and (data.animation_data.drivers or data.animation_data.action or data.animation_data.nla_tracks) for data in [o, o.data]):
            raise RuntimeError('Linked data, constraints, drivers and authored animations require explicit conversion before base editing: ' + o.name)
        record = {'type': o.type, 'parent': o.parent.name if o.parent else None, 'parentType': o.parent_type, 'parentBone': o.parent_bone, 'transform': [nums(row) for row in o.matrix_local]}
        # Visibility is part of the protected scene, including viewport hiding
        # and render/ray flags that glTF may not be able to represent.
        record['visibility'] = {name: getattr(o, name) for name in ['hide_render', 'hide_viewport', 'visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow', 'is_holdout', 'is_shadow_catcher'] if hasattr(o, name)}
        record['visibility']['hidden'] = o.hide_get()
        if o.type == 'ARMATURE':
            # REST disables skin deformation even when every bone, pose and
            # weight is unchanged. Protect the evaluation mode in both scene
            # and semantic export evidence; glTF may normalize it to POSE.
            record['posePosition'] = o.data.pose_position
            # Rest matrices and weights do not describe how a child responds to
            # parent motion. Protect inheritance in both the saved scene and
            # semantic export evidence, so GLB loss blocks the roundtrip too.
            record['armature'] = {b.name: {'parent': b.parent.name if b.parent else None, 'matrix': [nums(row) for row in b.matrix_local], 'deform': b.use_deform, 'settings': {name: getattr(b, name) for name in ['use_inherit_rotation', 'inherit_scale', 'use_local_location', 'use_relative_parent']}} for b in o.data.bones}
            for bone in o.pose.bones:
                if bone.constraints:
                    raise RuntimeError('Protected GLB export does not support bone constraints: ' + bone.name)
                if semantic:
                    # The basis depends on the rest/parent representation. The
                    # evaluated armature-space joint matrix is the GLB invariant.
                    record['armature'][bone.name]['posedMatrix'] = [nums(row) for row in bone.matrix]
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
            # GLB may reorder/split vertices at UV seams or sharp edges. Compare
            # oriented surface corners in world space, with each normal bound
            # to its own face/position rather than an unordered normal set.
            normal_matrix = o.matrix_world.to_3x3().inverted().transposed() if semantic else None
            normals = [nums((normal_matrix @ n.vector).normalized() if semantic else n.vector) for n in mesh.corner_normals]
            corners = [[[coords[mesh.loops[i].vertex_index], normals[i]] for i in p.loop_indices] for p in mesh.polygons]
            record['geometry'] = {
                'vertices': sorted(set(json.dumps(c) for c in coords)) if semantic else coords,
                'corners': sorted(oriented_face(face) for face in corners) if semantic else corners
            }
            if not semantic:
                # GLB represents shading through split corner normals, not
                # Blender's smooth/custom-normal authoring flags. Preserve both
                # the scene settings and their effective exported appearance.
                record['geometry']['shading'] = {
                    'smooth': [p.use_smooth for p in mesh.polygons],
                    'sharpEdges': [e.use_edge_sharp for e in mesh.edges],
                    'customNormals': mesh.has_custom_normals
                }
            record['topology'] = sorted(oriented_face([coords[i] for i in p.vertices]) for p in mesh.polygons) if semantic else [list(p.vertices) for p in mesh.polygons]
            record['weights'] = sorted(set(json.dumps([coords[v.index] if semantic else v.index, sorted([o.vertex_groups[g.group].name, round(g.weight, 5)] for g in v.groups if g.weight > 0)]) for v in mesh.vertices if v.groups))
            # Weights and a target name alone do not establish working skinning.
            # Preserve stack order, enable flags, binding mode and influence masks.
            record['armature'] = [{'object': m.object.name if m.object else None, 'settings': {name: getattr(m, name) for name in ['use_vertex_groups', 'use_bone_envelopes', 'use_deform_preserve_volume', 'use_multi_modifier', 'vertex_group', 'invert_vertex_group', 'show_viewport', 'show_render', 'show_in_editmode', 'show_on_cage']}} for m in o.modifiers]
            record['evaluatedGeometry'] = evaluated_geometry(o, coords, semantic)
            record['shapeKeys'] = expressions(o, coords, semantic)
            record['uvs'] = [sorted(json.dumps([coords[mesh.loops[i].vertex_index] if semantic else [i, mesh.loops[i].vertex_index], nums(v.uv)]) for i, v in enumerate(layer.data)) for layer in mesh.uv_layers]
            record['uvs'] = {'layers': record['uvs']}
            if not semantic:
                record['uvs'].update({'names': [layer.name for layer in mesh.uv_layers], 'active': mesh.uv_layers.active_index, 'render': [layer.active_render for layer in mesh.uv_layers]})
            record['materials'] = {'slots': [material(m, semantic) for m in mesh.materials], 'faces': sorted(json.dumps([oriented_face([coords[i] for i in p.vertices]) if semantic else p.index, p.material_index]) for p in mesh.polygons)}
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


def glb_accessor(file, gltf, index, content=None):
    accessor = gltf['accessors'][index]
    fmt = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}.get(accessor['componentType'])
    count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}.get(accessor['type'])
    if not fmt or not count:
        raise RuntimeError('Unsupported protected skin accessor encoding')
    if content is None:
        with open(file, 'rb') as f:
            content = f.read()
    json_length = struct.unpack_from('<I', content, 12)[0]

    def read(view_index, offset, length, encoding, width):
        view = gltf['bufferViews'][view_index]
        if view.get('buffer', 0) != 0 or gltf['buffers'][view.get('buffer', 0)].get('uri'):
            raise RuntimeError('Protected skin verification requires an embedded GLB buffer')
        start = 20 + json_length + 8 + view.get('byteOffset', 0) + offset
        size = struct.calcsize('<' + encoding * width)
        return [struct.unpack_from('<' + encoding * width, content, start + i * view.get('byteStride', size)) for i in range(length)]

    values = read(accessor['bufferView'], accessor.get('byteOffset', 0), accessor['count'], fmt, count) if 'bufferView' in accessor else [(0,) * count] * accessor['count']
    # Blender's existing morph-target support exports sparse POSITION deltas.
    sparse = accessor.get('sparse')
    if sparse:
        indices, data = sparse['indices'], sparse['values']
        index_fmt = {5121: 'B', 5123: 'H', 5125: 'I'}[indices['componentType']]
        indices = read(indices['bufferView'], indices.get('byteOffset', 0), sparse['count'], index_fmt, 1)
        data = read(data['bufferView'], data.get('byteOffset', 0), sparse['count'], fmt, count)
        for (i,), value in zip(indices, data):
            values[i] = value
    if accessor.get('normalized'):
        divisor = {5121: 255, 5123: 65535}.get(accessor['componentType'])
        if not divisor:
            raise RuntimeError('Unsupported normalized protected skin accessor')
        values = [tuple(v / divisor for v in row) for row in values]
    return values


def matrix_from_gltf(values):
    return Matrix([values[i:i+4] for i in range(0, 16, 4)]).transposed()


def glb_worlds(gltf):
    nodes = gltf.get('nodes', [])
    parents = {child: i for i, node in enumerate(nodes) for child in node.get('children', [])}
    worlds = {}

    def world(i):
        if i not in worlds:
            node = nodes[i]
            rotation = node.get('rotation', [0, 0, 0, 1])
            local = matrix_from_gltf(node['matrix']) if 'matrix' in node else Matrix.LocRotScale(Vector(node.get('translation', [0, 0, 0])), Quaternion((rotation[3], *rotation[:3])), Vector(node.get('scale', [1, 1, 1])))
            worlds[i] = world(parents[i]) @ local if i in parents else local
        return worlds[i]

    for i in range(len(nodes)):
        world(i)
    return worlds, parents


def explicit_skeletons(gltf):
    # Blender's bind-pose importer only uses a root inverse bind matrix when
    # the skin declares its skeleton ancestor. glTF permits omitting it. Add
    # only this redundant reference in a temporary import copy, never change
    # joints, inverse binds, geometry or the user's source file.
    _, parents = glb_worlds(gltf)
    for skin in gltf.get('skins', []):
        joints = set(skin['joints'])
        roots = [i for i in joints if parents.get(i) not in joints]
        ancestors = {parents.get(i) for i in roots}
        if len(ancestors) != 1 or None in ancestors:
            raise RuntimeError('Unverifiable GLB bind frame: skin needs a common named armature parent')
        ancestor = ancestors.pop()
        if skin.get('skeleton', ancestor) not in {ancestor, *roots}:
            raise RuntimeError('Unverifiable GLB bind frame: skeleton differs from the joint hierarchy')
        skin['skeleton'] = ancestor


def write_glb_json(source, destination, gltf):
    with open(source, 'rb') as f:
        content = f.read()
    old_length = struct.unpack_from('<I', content, 12)[0]
    encoded = json.dumps(gltf, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    tail = content[20 + old_length:]
    with open(destination, 'wb') as f:
        f.write(content[:8] + struct.pack('<I', 20 + len(encoded) + len(tail)) + struct.pack('<I4s', len(encoded), b'JSON') + encoded + tail)


def verify_imported_skin(file, gltf):
    # Do not trust the importer's bind-pose guess. Verify against the actual
    # encoded inverse binds and joint hierarchy before establishing a baseline.
    worlds, _ = glb_worlds(gltf)
    with open(file, 'rb') as f:
        content = f.read()

    def access(index):
        return glb_accessor(file, gltf, index, content)

    to_blender = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    bones = {b.name: (o, b) for o in bpy.context.scene.objects if o.type == 'ARMATURE' for b in o.pose.bones}
    bpy.context.view_layer.update()
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' not in skin:
            raise RuntimeError('Unverifiable GLB bind frame: explicit inverse bind matrices are required')
        accessor = gltf['accessors'][skin['inverseBindMatrices']]
        if accessor['componentType'] != 5126 or accessor['type'] != 'MAT4' or accessor['count'] != len(skin['joints']):
            raise RuntimeError('Invalid GLB inverse bind matrices for protected editing')
        for joint, values in zip(skin['joints'], access(skin['inverseBindMatrices'])):
            name = gltf['nodes'][joint]['name']
            if name not in bones:
                raise RuntimeError('GLB skeleton import mismatch: ' + name)
            rig, bone = bones[name]
            try:
                bind = to_blender @ matrix_from_gltf(values).inverted()
            except ValueError as error:
                raise RuntimeError('Singular GLB inverse bind matrix: ' + name) from error
            for label, expected, actual in [('bind/rest', bind, rig.matrix_world @ bone.bone.matrix_local), ('posed joint', to_blender @ worlds[joint], rig.matrix_world @ bone.matrix)]:
                if max(abs(x-y) for a,b in zip(expected,actual) for x,y in zip(a,b)) > 0.00002:
                    raise RuntimeError('Unverifiable GLB ' + label + ' after import: ' + name + '; encoded transforms cannot be retained by the supported Blender bind-frame representation')
    for node in gltf.get('nodes', []):
        if 'mesh' not in node or 'skin' not in node:
            continue
        skin = gltf['skins'][node['skin']]
        joints = skin['joints']
        inverse_binds = [matrix_from_gltf(v) for v in access(skin['inverseBindMatrices'])]
        expected_faces, expected_weights, bind_positions = [], set(), set()
        mesh = gltf['meshes'][node['mesh']]
        morph_weights = node.get('weights', mesh.get('weights', []))
        for primitive in mesh['primitives']:
            attrs = primitive['attributes']
            if 'JOINTS_0' not in attrs or 'WEIGHTS_0' not in attrs:
                raise RuntimeError('GLB skin is missing joint/weight attributes: ' + node['name'])
            positions = access(attrs['POSITION'])
            joint_indices = access(attrs['JOINTS_0'])
            weights = access(attrs['WEIGHTS_0'])
            morphs = [access(target['POSITION']) if 'POSITION' in target else None for target in primitive.get('targets', [])]
            corners = []
            for vertex_index, (position, indices, influences) in enumerate(zip(positions, joint_indices, weights)):
                bind = nums(to_blender @ Vector(position))
                bind_positions.add(json.dumps(bind))
                morphed = Vector(position)
                for morph, weight in zip(morphs, morph_weights):
                    if morph:
                        morphed += weight * Vector(morph[vertex_index])
                visible = Vector((0, 0, 0))
                names = []
                for index, weight in zip(indices, influences):
                    if weight > 0:
                        joint = joints[index]
                        visible += weight * (to_blender @ worlds[joint] @ inverse_binds[index] @ morphed)
                        names.append([gltf['nodes'][joint]['name'], round(weight, 5)])
                expected_weights.add(json.dumps([bind, sorted(names)]))
                corners.append([bind, nums(visible), [0, 0, 0]])
            indices = [row[0] for row in access(primitive['indices'])] if 'indices' in primitive else list(range(len(positions)))
            expected_faces.extend(oriented_face([corners[i] for i in indices[start:start+3]]) for start in range(0, len(indices), 3))
        obj = bpy.context.scene.objects.get(node['name'])
        if not obj or obj.type != 'MESH':
            raise RuntimeError('GLB skinned mesh import mismatch: ' + node['name'])
        coords = [nums(obj.matrix_world @ v.co) for v in obj.data.vertices]
        mapping = coordinate_map(sorted(bind_positions), sorted(set(json.dumps(v) for v in coords)))
        actual_weights = {json.dumps([json.loads(mapping[json.dumps(coords[v.index])]), sorted([obj.vertex_groups[g.group].name, round(g.weight, 5)] for g in v.groups if g.weight > 0)]) for v in obj.data.vertices}
        measured = evaluated_geometry(obj, coords, True)
        measured['corners'] = [oriented_face([[json.loads(mapping[json.dumps(c[0])]), c[1], [0, 0, 0]] for c in json.loads(f)]) for f in measured['corners']]
        if expected_weights != actual_weights or not same_evaluation({'corners': expected_faces}, measured):
            raise RuntimeError('GLB skin weights or evaluated surface changed during import: ' + node['name'])


def import_glb(file, gltf):
    explicit_skeletons(gltf)
    with tempfile.TemporaryDirectory(prefix='gen3d-skin-import-') as directory:
        normalized = os.path.join(directory, 'import.glb')
        write_glb_json(file, normalized, gltf)
        bpy.ops.import_scene.gltf(filepath=normalized, disable_bone_shape=True, bone_heuristic='BLENDER', guess_original_bind_pose=True)
    verify_imported_skin(file, gltf)


def export_glb(file):
    # Keep inverse binds at the original rest frame and export current static
    # joint transforms. No reset, pose-as-rest operation or mesh baking.
    bpy.ops.export_scene.gltf(filepath=file, export_format='GLB', export_apply=False, export_yup=True, export_animations=False, export_current_frame=True, export_rest_position_armature=False)
    gltf = preflight_glb(file)
    explicit_skeletons(gltf)
    write_glb_json(file, file, gltf)


def open_base(file):
    if file.lower().endswith('.blend'):
        bpy.ops.wm.open_mainfile(filepath=file, use_scripts=False)
        if len([s for s in bpy.data.scenes if any(o.type in {'MESH', 'ARMATURE'} for o in s.objects)]) != 1:
            raise RuntimeError('Base must have one modeling scene; multi-scene GLB preservation is unsupported')
    else:
        gltf = preflight_glb(file)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        import_glb(file, gltf)
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
        if original['type'] == current['type'] == 'MESH' and 'shading' not in original['geometry'] and 'shading' not in current['geometry']:
            try:
                current = align_semantic_mesh(original, current)
            except RuntimeError as error:
                raise RuntimeError('Protected object changed: ' + name + ' (geometry: ' + str(error) + ')') from error
        comparators = {'geometry': same_geometry, 'evaluatedGeometry': same_evaluation, 'armature': same_armature}
        changes = sorted(key for key in set(original) | set(current) if not comparators.get(key, lambda a,b: digest(a) == digest(b))(original.get(key), current.get(key)))
        if not changes:
            protected.append(name)
            continue
        if name not in editable:
            raise RuntimeError('Protected object changed: ' + name + ' (' + ', '.join(changes) + ')')
        for key in changes:
            if key not in {'geometry', 'topology', 'transform', 'evaluatedGeometry'} and key not in allowed:
                raise RuntimeError('Protected feature changed: ' + name + '.' + key)
        changed.append({'object': name, 'features': changes})
    if require_change and not changed and not added:
        raise RuntimeError('No authorized model edit detected')
    return {'passed': True, 'changed': changed, 'unchangedObjects': protected, 'addedObjects': added, 'beforeHash': digest(before), 'afterHash': digest(after), 'scope': scope}


def write(file, value):
    with open(file, 'w') as f:
        json.dump(value, f, indent=2)


def prepare(source, directory, scope):
    validation = os.path.join(directory, 'base-validation.json')
    if os.path.exists(validation):
        os.remove(validation)
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
    export_glb(glb)
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
    report['poseStrategy'] = 'static-joints-and-inverse-binds-v1'
    write(validation, report)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)


def validate(baseline_file, scope, blend, glb, report_file):
    if os.path.exists(report_file):
        os.remove(report_file)
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
    report['poseStrategy'] = 'static-joints-and-inverse-binds-v1'
    write(report_file, report)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
    return report
