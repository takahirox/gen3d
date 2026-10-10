"""Local self-contained model inspection and permission-aware reuse helpers.

Never open a library .blend as the working file: append its objects with scripts
 disabled, and keep them in separate scenes. Sources are only read.
"""
import bpy
import hashlib
import json
import math
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
                         'materials': [m.name for m in getattr(o.data, 'materials', []) if m],
                         'bounds': [list(o.matrix_world @ Vector(c)) for c in o.bound_box] if o.type == 'MESH' else [],
                         'shapeKeys': list(o.data.shape_keys.key_blocks.keys()) if o.type == 'MESH' and o.data.shape_keys else []}
                        for o in objects],
            'vertices': sum(len(o.data.vertices) for o in meshes), 'meshes': len(meshes)}


def load_file(file, asset_id, permission='reference-only'):
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    original = bpy.context.scene
    groups = ('objects', 'meshes', 'materials', 'images', 'node_groups', 'shape_keys', 'armatures', 'curves', 'libraries')
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
        scene, info = load_file(ref['path'], ref['assetId'], ref['permission'])
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
    if source.constraints or any(getattr(m, field, None) is not None for m in source.modifiers for field in ('object', 'target', 'mirror_object', 'offset_object')):
        raise RuntimeError('This mesh depends on a rig/constraint/object modifier; prepare a standalone mesh copy before reuse')
    world = source.matrix_world.copy()
    duplicate = source.copy()
    duplicate.data = source.data.copy()  # Includes shape keys; never edit source data.
    duplicate.animation_data_clear()
    duplicate.parent = None
    duplicate.matrix_world = world
    del duplicate['gen3d_reference_asset']
    duplicate['gen3d_reused_from'] = asset_id
    duplicate.name = 'reused_' + object_name
    for i, material in enumerate(duplicate.data.materials):
        if material:
            duplicate.data.materials[i] = material.copy()
    bpy.context.scene.collection.objects.link(duplicate)
    return {'object': duplicate.name, 'assetId': asset_id}


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
