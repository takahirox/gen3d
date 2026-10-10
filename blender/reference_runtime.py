"""Local self-contained model inspection and permission-aware reuse helpers.

Never open a library .blend as the working file: append its objects with scripts
 disabled, and keep them in separate scenes. Sources are only read.
"""
import bpy
import hashlib
import json
import math
import os
from mathutils import Vector

MAX_OBJECTS = 2000
MAX_VERTICES = 2000000


def scene_info(scene):
    objects = list(scene.objects)
    if len(objects) > MAX_OBJECTS or sum(len(o.data.vertices) for o in objects if o.type == 'MESH') > MAX_VERTICES:
        raise RuntimeError('Model exceeds 2,000 objects / 2,000,000 vertices')
    meshes = [o for o in objects if o.type == 'MESH' and len(o.data.vertices)]
    if not meshes:
        raise RuntimeError('Model contains no mesh geometry')
    for obj in objects:
        if obj.animation_data:
            obj.animation_data_clear()  # Drivers are executable content, never evaluated.
        for modifier in obj.modifiers:
            if modifier.type in {'MESH_CACHE', 'MESH_SEQUENCE_CACHE', 'FLUID', 'NODES'}:
                raise RuntimeError('External caches, fluid and geometry-node modifiers are unsupported')
    return {'objects': [{'name': o.name, 'type': o.type,
                         'vertices': len(o.data.vertices) if o.type == 'MESH' else 0,
                         'polygons': len(o.data.polygons) if o.type == 'MESH' else 0,
                         'edges': len(o.data.edges) if o.type == 'MESH' else 0,
                         'materials': [m.name for m in getattr(o.data, 'materials', []) if m],
                         'materialDetails': [{'name': m.name, 'baseColor': list(m.diffuse_color),
                                              'nodeTypes': [n.bl_idname for n in m.node_tree.nodes] if m.node_tree else [],
                                              'textures': [{'name': n.image.name, 'size': list(n.image.size)} for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image] if m.node_tree else []}
                                             for m in getattr(o.data, 'materials', []) if m],
                         'bounds': [list(o.matrix_world @ Vector(c)) for c in o.bound_box] if o.type == 'MESH' else [],
                         'shapeKeys': list(o.data.shape_keys.key_blocks.keys()) if o.type == 'MESH' and o.data.shape_keys else []}
                        for o in objects],
            'vertices': sum(len(o.data.vertices) for o in meshes), 'meshes': len(meshes)}


def load_file(file, asset_id, permission='reference-only'):
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    original = bpy.context.scene
    groups = ('objects', 'meshes', 'materials', 'images', 'textures', 'node_groups', 'shape_keys', 'armatures', 'curves', 'libraries')
    before = {group: set(getattr(bpy.data, group)) for group in groups}
    scene = bpy.data.scenes.new('gen3d_reference_' + asset_id)
    scene['gen3d_reference_asset'] = asset_id
    scene['gen3d_usage_permission'] = permission
    bpy.context.window.scene = scene
    try:
        if file.lower().endswith('.blend'):
            with bpy.data.libraries.load(file, link=False) as (source, target):
                if len(source.objects) > MAX_OBJECTS:
                    raise RuntimeError('Too many objects')
                target.objects = source.objects
            for obj in target.objects:
                if obj:
                    scene.collection.objects.link(obj)
        elif file.lower().endswith('.glb'):
            bpy.ops.import_scene.gltf(filepath=file)
        else:
            raise RuntimeError('Unsupported model format')
        # Validate only this asset's appended resources, preserving the deliverable.
        for image in set(bpy.data.images) - before['images']:
            if image.source not in {'GENERATED', 'VIEWER'} and not image.packed_file and not image.packed_files:
                raise RuntimeError('Pack all images into the .blend file before importing')
        for group in groups:
            for block in set(getattr(bpy.data, group)) - before[group]:
                if getattr(block, 'library', None):
                    raise RuntimeError('Linked Blender libraries are unsupported; make them local and pack resources')
                if getattr(block, 'animation_data', None):
                    block.animation_data_clear()
                tree = getattr(block, 'node_tree', None)
                if tree and tree.animation_data:
                    tree.animation_data_clear()
        info = scene_info(scene)
        for obj in scene.objects:
            obj['gen3d_reference_asset'] = asset_id
        scene['gen3d_reference_info'] = json.dumps(info)
        return scene, info
    except Exception:
        for obj in list(scene.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(scene)
        bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
        raise
    finally:
        bpy.context.window.scene = original


def load_references(manifest):
    results = []
    for ref in manifest:
        with open(ref['path'], 'rb') as file:
            if hashlib.sha256(file.read()).hexdigest() != ref['sha256']:
                raise RuntimeError('Reference source changed: ' + ref['name'])
        try:
            scene, info = load_file(ref['path'], ref['assetId'], ref['permission'])
        except Exception as error:
            raise RuntimeError('Cannot load selected 3D reference ' + ref['name'] + ' (' + ref['assetId'] + '): ' + str(error)) from error
        results.append({'assetId': ref['assetId'], 'scene': scene.name, 'role': ref['role'],
                        'permission': ref['permission'], **info})
    return results


def inspect_reference(asset_id):
    scene = next((s for s in bpy.data.scenes if s.get('gen3d_reference_asset') == asset_id), None)
    if scene is None:
        raise RuntimeError('Reference was not loaded')
    return {'scene': scene.name, 'permission': scene['gen3d_usage_permission'], **scene_info(scene)}


def reuse_object(asset_id, object_name):
    scene = next((s for s in bpy.data.scenes if s.get('gen3d_reference_asset') == asset_id), None)
    if scene is None or scene.get('gen3d_usage_permission') != 'reuse-edit':
        raise RuntimeError('Human approval does not permit copying or editing this reference')
    source = scene.objects.get(object_name)
    if source is None or source.type != 'MESH':
        raise RuntimeError('Choose a mesh from this reference scene')
    if source.constraints or any(isinstance(getattr(m, p.identifier, None), bpy.types.Object) for m in source.modifiers for p in m.bl_rna.properties if p.type == 'POINTER'):
        raise RuntimeError('This mesh depends on a rig/constraint/object modifier; prepare a standalone mesh copy before reuse')
    world = source.matrix_world.copy()
    duplicate = source.copy()
    duplicate.data = source.data.copy()  # Includes shape keys; never edit source data.
    duplicate.animation_data_clear()
    duplicate.parent = None
    duplicate.matrix_world = world
    del duplicate['gen3d_reference_asset']
    duplicate['gen3d_reused_from'] = asset_id
    duplicate['gen3d_reused_object'] = object_name
    duplicate['gen3d_reuse_method'] = 'reuse_reference_mesh'
    duplicate.name = 'reused_' + object_name
    for modifier in duplicate.modifiers:
        texture = getattr(modifier, 'texture', None)
        if texture:
            modifier.texture = texture.copy()
            if getattr(modifier.texture, 'image', None):
                modifier.texture.image = modifier.texture.image.copy()
    for i, material in enumerate(duplicate.data.materials):
        if material:
            duplicate.data.materials[i] = material.copy()
            def copy_nodes(tree, copied):
                for node in tree.nodes:
                    for prop in node.bl_rna.properties:
                        dependency = getattr(node, prop.identifier, None) if prop.type == 'POINTER' else None
                        if isinstance(dependency, bpy.types.Object) and dependency.get('gen3d_reference_asset'):
                            if dependency != source:
                                raise RuntimeError('Material depends on another source object; bake standalone materials before reuse')
                            setattr(node, prop.identifier, duplicate)
                    if node.type == 'GROUP' and node.node_tree:
                        old = node.node_tree
                        if old not in copied:
                            copied[old] = old.copy()
                            copy_nodes(copied[old], copied)
                        node.node_tree = copied[old]
                    if node.type == 'TEX_IMAGE' and node.image:
                        node.image = node.image.copy()
            if duplicate.data.materials[i].node_tree:
                copy_nodes(duplicate.data.materials[i].node_tree, {})
    bpy.context.scene.collection.objects.link(duplicate)
    return {'object': duplicate.name, 'assetId': asset_id, 'objectName': object_name, 'method': 'reuse_reference_mesh'}


def render_reference(asset_id, directory):
    """Material renders of all axes; axis labels avoid guessing a GLB's front/up."""
    scene = next((s for s in bpy.data.scenes if s.get('gen3d_reference_asset') == asset_id), None)
    if scene is None:
        raise RuntimeError('Reference was not loaded: ' + asset_id)
    original = bpy.context.scene
    temporary = []
    try:
        bpy.context.window.scene = scene
        bpy.context.view_layer.update()
        meshes = [o for o in scene.objects if o.type == 'MESH' and len(o.data.vertices)]
        points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        if not points or any(not math.isfinite(v) for p in points for v in p):
            raise RuntimeError('Reference has invalid bounds: ' + asset_id)
        lo = Vector([min(p[i] for p in points) for i in range(3)])
        hi = Vector([max(p[i] for p in points) for i in range(3)])
        center = (lo + hi) / 2
        radius = (hi - lo).length / 2
        if radius < 1e-6:
            raise RuntimeError('Reference has degenerate geometry: ' + asset_id)
        camera = bpy.data.objects.new('reference_camera', bpy.data.cameras.new('reference_camera'))
        scene.collection.objects.link(camera)
        temporary.append(camera)
        camera.data.type = 'ORTHO'
        camera.data.clip_start = radius / 1000
        camera.data.clip_end = radius * 100
        scene.camera = camera
        for obj in scene.objects:
            if obj.type == 'LIGHT':
                obj.hide_render = True
        for label, direction, energy in [('key', (2, -3, 4), 1000), ('fill', (-3, 1, 2), 800), ('rim', (0, 3, -2), 600)]:
            light = bpy.data.objects.new('reference_' + label, bpy.data.lights.new('reference_' + label, 'AREA'))
            scene.collection.objects.link(light)
            temporary.append(light)
            light.data.energy = energy * radius * radius
            light.data.size = radius * 3
            light.location = center + Vector(direction) * radius
            light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
        scene.world = bpy.data.worlds.new('reference_world')
        scene.world.use_nodes = True
        scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.16, .18, .23, 1)
        scene.world.node_tree.nodes['Background'].inputs[1].default_value = .6
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 8
        scene.render.resolution_x = scene.render.resolution_y = 384
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        os.makedirs(directory, exist_ok=True)
        views = []
        # Opposite axes include back/side/top for arbitrarily oriented assets.
        for label, direction in [('minus-y', (0, -1, 0)), ('plus-x', (1, 0, 0)), ('plus-y', (0, 1, 0)), ('minus-x', (-1, 0, 0)),
                                 ('plus-z', (0, 0, 1)), ('minus-z', (0, 0, -1)), ('three-quarter-a', (1, -1, .5)), ('three-quarter-b', (-1, 1, .5))]:
            camera.location = center + Vector(direction).normalized() * radius * 4
            camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
            # Frame projected bounds separately for each subject/view, not a fixed GLB orientation.
            inverse = camera.rotation_euler.to_matrix().transposed()
            projected = [inverse @ (p - center) for p in points]
            camera.data.ortho_scale = max(max(max(p[i] for p in projected) - min(p[i] for p in projected) for i in (0, 1)) * 1.2, radius * .05)
            scene.render.filepath = os.path.join(directory, label + '.png')
            bpy.ops.render.render(write_still=True)
            views.append({'view': label, 'direction': list(direction), 'center': list(center), 'orthoScale': camera.data.ortho_scale,
                          'projection': 'orthographic', 'image': label + '.png'})
        return views
    finally:
        scene.camera = None
        bpy.context.window.scene = original
        for obj in temporary:
            bpy.data.objects.remove(obj, do_unlink=True)


def validate_deliverable(manifest):
    """Check evaluated meshes and source dependencies before removing inspection scenes."""
    allowed = {r['assetId']: r for r in manifest if r['permission'] == 'reuse-edit'}
    provenance = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    sources = {o for o in bpy.data.objects if o.get('gen3d_reference_asset')}
    source_materials = {m for s in sources if s.type == 'MESH' for m in s.data.materials if m}
    def material_objects(tree, visited):
        if not tree or tree in visited:
            return
        visited.add(tree)
        for node in tree.nodes:
            for prop in node.bl_rna.properties:
                value = getattr(node, prop.identifier, None) if prop.type == 'POINTER' else None
                if isinstance(value, bpy.types.Object):
                    yield value
            if node.type == 'GROUP':
                yield from material_objects(node.node_tree, visited)
    for obj in bpy.context.scene.objects:
        if obj.get('gen3d_reference_asset'):
            continue  # Incidental linked reference is removed by remove_references.
        dependencies = [obj.parent] + [getattr(c, 'target', None) for c in obj.constraints]
        dependencies += [getattr(m, p.identifier, None) for m in obj.modifiers for p in m.bl_rna.properties if p.type == 'POINTER']
        if obj.type == 'MESH':
            dependencies += [dependency for m in obj.data.materials if m for dependency in material_objects(m.node_tree, set())]
        if any(d in sources for d in dependencies if isinstance(d, bpy.types.Object)):
            raise RuntimeError('Deliverable depends on an inspection object: ' + obj.name)
        if obj.type != 'MESH':
            continue
        if any(obj.data == s.data for s in sources if s.type == 'MESH'):
            raise RuntimeError('Deliverable shares source mesh data: ' + obj.name)
        if any(m in source_materials for m in obj.data.materials if m):
            raise RuntimeError('Deliverable shares source materials: ' + obj.name)
        if obj.data.shape_keys and any(len(k.data) != len(obj.data.vertices) for k in obj.data.shape_keys.key_blocks):
            raise RuntimeError('Broken shape keys: ' + obj.name)
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            if not obj.hide_render and (not mesh.vertices or not mesh.polygons or any(not math.isfinite(v) for p in mesh.vertices for v in evaluated.matrix_world @ p.co)):
                raise RuntimeError('Modifier produced unusable mesh: ' + obj.name)
        finally:
            evaluated.to_mesh_clear()
        asset_id = obj.get('gen3d_reused_from')
        if asset_id:
            if asset_id not in allowed:
                raise RuntimeError('Unapproved reference reuse')
            provenance.append({'assetId': asset_id, 'objectName': obj.get('gen3d_reused_object'), 'targetObject': obj.name,
                               'method': obj.get('gen3d_reuse_method'), 'sha256': allowed[asset_id]['sha256']})
    return provenance


def remove_references():
    # Also remove tagged objects accidentally linked into the deliverable scene.
    removed = False
    for obj in list(bpy.data.objects):
        if obj.get('gen3d_reference_asset'):
            removed = True
            bpy.data.objects.remove(obj, do_unlink=True)
    for scene in list(bpy.data.scenes):
        if scene.get('gen3d_reference_asset'):
            removed = True
            bpy.data.scenes.remove(scene)
    if removed:
        bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)


def inspect_file(file, thumbnail=None):
    scene, info = load_file(file, 'inspection')
    if thumbnail:
        bpy.context.window.scene = scene
        meshes = [o for o in scene.objects if o.type == 'MESH' and len(o.data.vertices)]
        bpy.context.view_layer.update()
        points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        if any(not math.isfinite(v) for p in points for v in p):
            raise RuntimeError('Non-finite mesh bounds')
        lo = Vector([min(p[i] for p in points) for i in range(3)])
        hi = Vector([max(p[i] for p in points) for i in range(3)])
        center = (lo + hi) / 2
        radius = max((hi - lo).length / 2, .1)
        # Disable user cameras/lights and use a cheap solid preview.
        camera = bpy.data.objects.new('preview_camera', bpy.data.cameras.new('preview_camera'))
        scene.collection.objects.link(camera)
        camera.location = center + Vector((1.4, -2, 1)).normalized() * radius * 4
        camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.clip_end = max(radius * 100, 1000)
        scene.camera = camera
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'MATERIAL'
        scene.render.resolution_x = scene.render.resolution_y = 160
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.filepath = thumbnail
        bpy.ops.render.render(write_still=True)
    return info
