"""gen3d adapter for a user-installed MPFB; no third-party code or assets bundled.

API checked against MPFB v2.0.17 docs/services/humanservice.md and createhuman.py.
Executed inside the existing Blender bridge, never a separate service.
"""
import bpy
import importlib
import inspect
import json
import hashlib

GEN3D_MPFB_SETUP = ('Install and enable MPFB 2.0.x in the Blender 4.2–5.x process running '
                    'the gen3d bridge, save preferences, then restart that bridge. '
                    'See docs/mpfb.md, or explicitly choose Existing Blender modeling (scratch). '
                    'gen3d will not download MPFB/assets or silently substitute primitives.')


def gen3d_mpfb_api():
    if not (4, 2, 0) <= bpy.app.version < (6, 0, 0):
        raise RuntimeError('Unsupported Blender version for MPFB. ' + GEN3D_MPFB_SETUP)
    names = [a.module for a in bpy.context.preferences.addons
             if a.module == 'mpfb' or a.module.startswith('bl_ext.') and a.module.endswith('.mpfb')]
    if len(names) != 1:
        raise RuntimeError('MPFB is missing, disabled, or installed more than once. ' + GEN3D_MPFB_SETUP)
    try:
        module = importlib.import_module(names[0])
        version = tuple(module.VERSION)
        if version[:2] != (2, 0):
            raise ValueError('Expected MPFB 2.0.x')
        service = importlib.import_module(names[0] + '.services.humanservice').HumanService
        inspect.signature(service.create_human).bind(mask_helpers=True, detailed_helpers=True,
                                                     extra_vertex_groups=True, feet_on_ground=True, scale=0.1)
    except Exception as error:
        raise RuntimeError('MPFB API is incompatible: ' + str(error) + '. ' + GEN3D_MPFB_SETUP) from error
    return service, {'available': True, 'module': names[0], 'mpfbVersion': '.'.join(map(str, version)),
                     'blenderVersion': bpy.app.version_string, 'api': 'HumanService.create_human'}


def gen3d_mpfb_status():
    return gen3d_mpfb_api()[1]


def gen3d_mpfb_topology(obj):
    # Coordinates may change with target/shape edits; the connected base topology stays intact.
    payload = [len(obj.data.vertices), [list(p.vertices) for p in obj.data.polygons]]
    return hashlib.sha256(json.dumps(payload, separators=(',', ':')).encode()).hexdigest()


def gen3d_mpfb_create():
    service, info = gen3d_mpfb_api()
    if any(o.get('gen3d_mpfb_body') for o in bpy.context.scene.objects):
        raise RuntimeError('An MPFB body already exists. Adjust that continuous mesh instead of replacing it.')
    try:
        obj = service.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
                                   feet_on_ground=True, scale=0.1)
    except Exception as error:
        raise RuntimeError('MPFB could not create its local base mesh: ' + str(error) + '. ' + GEN3D_MPFB_SETUP) from error
    if obj.type != 'MESH' or len(obj.data.vertices) < 1000 or len(obj.data.polygons) < 1000:
        raise RuntimeError('MPFB did not create a nontrivial human base mesh')
    obj.name = 'gen3d_mpfb_body'
    obj['gen3d_mpfb_body'] = True
    obj['gen3d_mpfb_info'] = json.dumps(info)
    obj['gen3d_mpfb_topology'] = gen3d_mpfb_topology(obj)
    obj.use_shape_key_edit_mode = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    return gen3d_mpfb_verify()


def gen3d_mpfb_verify():
    bodies = [o for o in bpy.context.scene.objects if o.get('gen3d_mpfb_body') and o.type == 'MESH']
    if len(bodies) != 1:
        raise RuntimeError('MPFB mode requires the original continuous MPFB body; no primitive fallback is allowed.')
    obj = bodies[0]
    if (obj.hide_render or obj.hide_get() or len(obj.data.vertices) < 1000
            or gen3d_mpfb_topology(obj) != obj.get('gen3d_mpfb_topology')):
        raise RuntimeError('The MPFB body was hidden, replaced or its base topology destroyed. Preserve the body and adapt its shapes.')
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    if len(evaluated.data.vertices) < 1000 or len(evaluated.data.polygons) < 1000:
        raise RuntimeError('The evaluated MPFB body is empty or trivial; check masking and modifiers.')
    return {**json.loads(obj['gen3d_mpfb_info']), 'body': obj.name, 'vertices': len(obj.data.vertices),
            'polygons': len(obj.data.polygons), 'evaluatedVertices': len(evaluated.data.vertices),
            'topologyPreserved': True, 'topologyHash': obj['gen3d_mpfb_topology']}
