// Real Blender preservation check. No Codex or image-generation calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runProcess } from '../src/codex.js';
import { fileHash } from '../src/workflow.js';
const output = path.resolve(process.env.GEN3D_WORKFLOW_BLENDER_OUTPUT || '.gen3d/workflow-blender-check');
fs.mkdirSync(output, { recursive: true });
const runtime = path.resolve('blender');
const script = path.join(output, 'check.py');
fs.writeFileSync(script, `import bpy, sys, json, os, hashlib
sys.path.insert(0, ${JSON.stringify(runtime)})
import preservation as p
out = ${JSON.stringify(output)}
bpy.ops.wm.read_factory_settings(use_empty=True)
mat = bpy.data.materials.new('CharacterMaterial')
mat.use_nodes = True
mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.22,0.42,0.65,1)
arm = bpy.data.armatures.new('Skeleton')
rig = bpy.data.objects.new('Rig', arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
root = arm.edit_bones.new('Root')
root.head = (0,0,0)
root.tail = (0,0,1)
head = arm.edit_bones.new('Head')
head.head = (0,0,1)
head.tail = (0,0,2)
head.parent = root
for name, x, z, length in [('Arm.L',0.55,0.5,0.8),('Arm.R',-0.55,0.5,0.8),('Leg.L',0.2,-0.65,0.85),('Leg.R',-0.2,-0.65,0.85)]:
    bone=arm.edit_bones.new(name)
    bone.head=(x,0,z)
    bone.tail=(x,0,z+length)
    bone.parent=root
bpy.ops.object.mode_set(mode='OBJECT')
rig.select_set(False)
def part(name, location, scale, bone=None, expression=False):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=location)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.data.materials.append(mat)
    uv = o.data.uv_layers.new(name='UVMap')
    for i, loop in enumerate(o.data.loops):
        uv.data[i].uv = ((i % 3) * 0.3, (i % 2) * 0.8)
    if bone:
        o.parent = rig
        group = o.vertex_groups.new(name=bone)
        group.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
        modifier = o.modifiers.new('Skin', 'ARMATURE')
        modifier.object = rig
    if expression:
        o.shape_key_add(name='Basis')
        smile = o.shape_key_add(name='Smile')
        for v in smile.data:
            if v.co.y < 0:
                v.co.z += 0.05
    return o
part('Body', (0,0,0.7), (0.4,0.25,0.6), 'Root')
part('HeadMesh', (0,0,1.55), (0.3,0.25,0.35), 'Head', True)
part('Hair', (0,0,1.9), (0.32,0.27,0.17))
part('ArmMesh.L', (0.55,0,0.9), (0.13,0.16,0.4), 'Arm.L')
part('ArmMesh.R', (-0.55,0,0.9), (0.13,0.16,0.4), 'Arm.R')
part('LegMesh.L', (0.2,0,-0.25), (0.15,0.18,0.43), 'Leg.L')
part('LegMesh.R', (-0.2,0,-0.25), (0.15,0.18,0.43), 'Leg.R')
source = out + '/character.blend'
bpy.ops.wm.save_as_mainfile(filepath=source, compress=False)
scope = {'editableObjects':['Hair'], 'allowChanges':[], 'allowNewObjects':False}
os.makedirs(out + '/prepared', exist_ok=True)
source_hash = hashlib.sha256(open(source, 'rb').read()).hexdigest()
p.prepare(source, out + '/prepared', scope)
os.makedirs(out + '/prepared-glb', exist_ok=True)
p.prepare(out + '/prepared/base.glb', out + '/prepared-glb', scope)
bpy.ops.wm.open_mainfile(filepath=out + '/prepared/base.blend', use_scripts=False)
assert hashlib.sha256(open(source, 'rb').read()).hexdigest() == source_hash
# A bounded geometry edit on the authorized hair object.
for v in bpy.data.objects['Hair'].data.vertices:
    v.co.x *= 1.15
bpy.ops.wm.save_as_mainfile(filepath=out + '/edited.blend', compress=False)
bpy.ops.export_scene.gltf(filepath=out + '/edited.glb', export_format='GLB', export_apply=False, export_animations=False)
report = p.validate(out + '/prepared/baseline.json', scope, out + '/edited.blend', out + '/edited.glb', out + '/preservation.json')
checks = ['complete GLB base import and roundtrip', 'unchanged library source hash', 'complete scene copy', 'rig and weights retained', 'Smile expression retained', 'UV and material retention', 'authorized Hair geometry changed', 'GLB reopened and compared']
# Collection visibility is inherited independently of object hide flags. Use
# nested collections to exercise visibility settings on an ancestor.
def group_body():
    parent = bpy.data.collections.new('ProtectedParent')
    child = bpy.data.collections.new('ProtectedChild')
    bpy.context.scene.collection.children.link(parent)
    parent.children.link(child)
    body = bpy.data.objects['Body']
    for collection in list(body.users_collection):
        collection.objects.unlink(body)
    child.objects.link(body)
    bpy.context.view_layer.update()
    return parent, child

def body_pixels(file, label):
    p.open_base(file)
    scene = bpy.context.scene
    for o in scene.objects:
        if o.type == 'MESH' and o.name != 'Body':
            o.hide_render = True
    camera = bpy.data.objects.new('VisibilityProbe', bpy.data.cameras.new('VisibilityProbe'))
    scene.collection.objects.link(camera)
    camera.location = (0, -4, 0.7)
    from mathutils import Vector
    camera.rotation_euler = (Vector((0, 0, 0.7)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 2
    scene.camera = camera
    engines = scene.render.bl_rna.properties['engine'].enum_items.keys()
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 64
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = out + '/' + label + '.png'
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(scene.render.filepath, check_existing=False)
    count = sum(alpha > 0.01 for alpha in image.pixels[:][3::4])
    bpy.data.images.remove(image)
    return count

bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
group_body()
nested_blend, nested_glb = out + '/nested.blend', out + '/nested.glb'
bpy.ops.wm.save_as_mainfile(filepath=nested_blend, compress=False)
bpy.ops.export_scene.gltf(filepath=nested_glb, export_format='GLB', export_apply=False, export_animations=False)
p.validate(out + '/prepared/baseline.json', scope, nested_blend, nested_glb, out + '/nested-validation.json')
visibility_evidence = {'visibleScenePixels':body_pixels(nested_blend, 'visible-body'), 'visibleGlbPixels':body_pixels(nested_glb, 'visible-glb-body'), 'blocked':[]}
assert visibility_evidence['visibleScenePixels'] > 0 and visibility_evidence['visibleGlbPixels'] > 0
checks.append('default nested collections preserve visible Body in saved scene and GLB')
for feature in ['collection.hide_render', 'collection.hide_viewport', 'layerCollection.exclude', 'layerCollection.hide_viewport', 'layerCollection.holdout', 'layerCollection.indirect_only', 'inactive-layer.exclude', 'viewLayer.disabled', 'inactive-object.hidden']:
    bpy.ops.wm.open_mainfile(filepath=nested_blend, use_scripts=False)
    parent = bpy.data.collections['ProtectedParent']
    layer = bpy.context.view_layer
    if feature.startswith('inactive-'):
        layer = bpy.context.scene.view_layers.new('OtherLayer')
    if feature.startswith('collection.'):
        setattr(parent, feature.split('.')[1], True)
    elif feature == 'viewLayer.disabled':
        layer.use = False
    elif feature == 'inactive-object.hidden':
        bpy.data.objects['Body'].hide_set(True, view_layer=layer)
    else:
        layer_parent = layer.layer_collection.children[parent.name]
        setattr(layer_parent, feature.split('.')[1], True)
    blend = out + '/visibility-' + feature + '.blend'
    glb = out + '/visibility-' + feature + '.glb'
    evidence = out + '/visibility-' + feature + '-validation.json'
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=False)
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=False, export_animations=False)
    if feature == 'collection.hide_render':
        # The exact review defect: no object hide flag changes, but Body
        # disappears from the scene while remaining visible in exported GLB.
        visibility_evidence['hiddenScenePixels'] = body_pixels(blend, 'hidden-body')
        visibility_evidence['hiddenGlbPixels'] = body_pixels(glb, 'hidden-glb-body')
        assert visibility_evidence['hiddenScenePixels'] == 0
        assert visibility_evidence['hiddenGlbPixels'] > 0
        bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
        body = bpy.data.objects['Body']
        assert not body.hide_render and not body.hide_viewport and not body.hide_get()
        # Even explicit object visibility permission cannot authorize a format
        # that cannot retain collection visibility in its scene/GLB evidence.
        try:
            p.validate(out + '/prepared/baseline.json', {'editableObjects':['Hair','Body'], 'allowChanges':['visibility']}, blend, glb, evidence)
            raise AssertionError('Unsupported scene/GLB collection visibility mismatch passed')
        except RuntimeError as error:
            assert 'collection/view-layer visibility' in str(error) and 'Body' in str(error), str(error)
            assert not os.path.exists(evidence)
            checks.append('blocked scene/GLB collection visibility mismatch even with object visibility permission')
    if os.path.exists(evidence):
        os.remove(evidence)
    try:
        p.validate(out + '/prepared/baseline.json', scope, blend, glb, evidence)
        raise AssertionError('Unauthorized collection/view-layer visibility became publication evidence: ' + feature)
    except RuntimeError as error:
        assert 'collection/view-layer visibility' in str(error), str(error)
        assert not os.path.exists(evidence)
        diagnostic = str(error)
        checks.append('blocked saved candidate ' + feature + ': ' + diagnostic)
    directory = out + '/unsupported-visibility-' + feature
    os.makedirs(directory, exist_ok=True)
    try:
        p.prepare(blend, directory, scope)
        raise AssertionError('Unsupported collection/view-layer base was authorized: ' + feature)
    except RuntimeError as error:
        assert 'collection/view-layer visibility' in str(error), str(error)
        assert not os.path.exists(directory + '/base-validation.json')
        visibility_evidence['blocked'].append({'feature':feature, 'candidateDiagnostic':diagnostic, 'baseDiagnostic':str(error), 'publicationEvidenceWritten':False})
        checks.append('blocked unsupported base ' + feature)
assert hashlib.sha256(open(source, 'rb').read()).hexdigest() == source_hash
bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
# Measure the saved expression through Blender independently of the snapshot.
def smile_displacement():
    head = bpy.data.objects['HeadMesh']
    key = head.data.shape_keys.key_blocks['Smile']
    original = key.value
    def points():
        bpy.context.view_layer.update()
        evaluated = head.evaluated_get(bpy.context.evaluated_depsgraph_get())
        return [v.co.copy() for v in evaluated.data.vertices]
    try:
        key.value = 0
        neutral = points()
        key.value = 1
        return max((v - neutral[i]).length for i, v in enumerate(points()))
    finally:
        key.value = original
        bpy.context.view_layer.update()

with open(out + '/prepared/baseline.json') as f:
    expression_baseline = json.load(f)
original_key = expression_baseline['objects']['HeadMesh']['shapeKeys']['Smile']
assert original_key['mask'] == {'vertexGroup':'', 'weights':None}
assert abs(max(abs(json.loads(row)[1][2]) for row in original_key['deformation']) - 0.05) < 0.00001
expression_evidence = {'authorizedDisplacement':smile_displacement(), 'masks':[]}
assert abs(expression_evidence['authorizedDisplacement'] - 0.05) < 0.00001
checks.append('reopened authorized Hair candidate retains measured 0.05 Smile deformation')
# Snapshot probes must restore the caller's current expression value.
smile = bpy.data.objects['HeadMesh'].data.shape_keys.key_blocks['Smile']
smile.value = 0.4
assert abs(p.snapshot()['objects']['HeadMesh']['shapeKeys']['Smile']['value'] - 0.4) < 0.00001
assert abs(smile.value - 0.4) < 0.00001
checks.append('expression measurement restores current shape-key values')

# Exact review reproduction: an empty group adds no per-vertex weights, but
# binding Smile to it disables the protected expression in the saved scene.
# Also measure a partial mask and a dangling mask reference, none of which can
# retain its Blender configuration through the protected GLB export path.
for mask_kind in ['empty', 'partial', 'missing']:
    bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
    head = bpy.data.objects['HeadMesh']
    smile = head.data.shape_keys.key_blocks['Smile']
    if mask_kind != 'missing':
        group = head.vertex_groups.new(name='ExpressionMask')
        if mask_kind == 'partial':
            group.add(list(range(len(head.data.vertices))), 0.5, 'REPLACE')
    smile.vertex_group = 'ExpressionMask'
    blend = out + '/expression-' + mask_kind + '.blend'
    glb = out + '/expression-' + mask_kind + '.glb'
    evidence = out + '/expression-' + mask_kind + '-validation.json'
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=False)
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=False, export_animations=False)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
    head = bpy.data.objects['HeadMesh']
    displacement = smile_displacement()
    current = p.snapshot()['objects']['HeadMesh']['shapeKeys']['Smile']
    measured = max(sum(v*v for v in json.loads(row)[1])**0.5 for row in current['deformation'])
    expected = {'empty':0, 'partial':0.025, 'missing':0.05}[mask_kind]
    assert abs(displacement - expected) < 0.00001, (mask_kind, displacement)
    assert abs(measured - displacement) < 0.00001, (mask_kind, measured, displacement)
    assert current['points'] == original_key['points']
    assert current['mask']['vertexGroup'] == 'ExpressionMask'
    if mask_kind == 'empty':
        assert current['mask']['weights'] == [0] * len(head.data.vertices)
        assert p.snapshot()['objects']['HeadMesh']['weights'] == expression_baseline['objects']['HeadMesh']['weights']
    elif mask_kind == 'missing':
        assert current['mask']['weights'] is None
    else:
        assert current['mask']['weights'] == [0.5] * len(head.data.vertices)
    if os.path.exists(evidence):
        os.remove(evidence)
    try:
        p.validate(out + '/prepared/baseline.json', scope, blend, glb, evidence)
        raise AssertionError('Unauthorized expression mask became candidate publication evidence')
    except RuntimeError as error:
        assert 'HeadMesh' in str(error) and 'shapeKeys' in str(error), str(error)
        assert not os.path.exists(evidence)
        checks.append('blocked saved candidate expression mask ' + mask_kind + ': ' + str(error))
        expression_evidence['masks'].append({'kind':mask_kind, 'displacement':displacement, 'snapshotDeformation':measured, 'diagnostic':str(error), 'publicationEvidenceWritten':False})
    directory = out + '/unsupported-expression-' + mask_kind
    os.makedirs(directory, exist_ok=True)
    try:
        p.prepare(blend, directory, scope)
        raise AssertionError('Unsupported masked expression base was authorized')
    except RuntimeError as error:
        assert 'Unsupported expression vertex-group mask' in str(error) and 'HeadMesh.Smile' in str(error) and 'ExpressionMask' in str(error), str(error)
        assert not os.path.exists(directory + '/base-validation.json')
        checks.append('blocked unsupported masked base ' + mask_kind + ': ' + str(error))
assert hashlib.sha256(open(source, 'rb').read()).hexdigest() == source_hash
bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
# Bone inheritance changes can leave rest geometry/weights unchanged while
# breaking deformation under a parent rotation. Measure the review reproduction
# independently, then reject every recorded inheritance setting at publication.
def rotated_head_points():
    root = bpy.data.objects['Rig'].pose.bones['Root']
    original = root.matrix_basis.copy()
    try:
        from mathutils import Matrix
        root.matrix_basis = Matrix.Rotation(1.0471975512, 4, 'X')
        bpy.context.view_layer.update()
        head = bpy.data.objects['HeadMesh'].evaluated_get(bpy.context.evaluated_depsgraph_get())
        return [(head.matrix_world @ v.co).copy() for v in head.data.vertices]
    finally:
        root.matrix_basis = original
        bpy.context.view_layer.update()

original_head_points = rotated_head_points()
bone_evidence = []
for setting, value in [('use_inherit_rotation', False), ('inherit_scale', 'NONE'), ('use_local_location', False), ('use_relative_parent', True)]:
    bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
    bone = bpy.data.objects['Rig'].data.bones['Head']
    assert getattr(bone, setting) != value
    setattr(bone, setting, value)
    blend = out + '/bone-' + setting + '.blend'
    glb = out + '/bone-' + setting + '.glb'
    evidence = out + '/bone-' + setting + '-validation.json'
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=False)
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=False, export_animations=False)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
    deformation_difference = max((v - original_head_points[i]).length for i, v in enumerate(rotated_head_points()))
    if setting == 'use_inherit_rotation':
        assert deformation_difference > 0.1, deformation_difference
        checks.append('reopened disabled bone rotation inheritance changes HeadMesh under 60 degree Root rotation')
    if os.path.exists(evidence):
        os.remove(evidence)
    try:
        p.validate(out + '/prepared/baseline.json', scope, blend, glb, evidence)
        raise AssertionError('Unauthorized bone setting became candidate publication evidence: ' + setting)
    except RuntimeError as error:
        assert 'Rig' in str(error) and 'armature' in str(error), str(error)
        assert not os.path.exists(evidence)
        checks.append('blocked saved candidate bone setting ' + setting + ': ' + str(error))
        candidate_error = str(error)
    # GLB cannot encode these nondefault Blender inheritance semantics. The
    # measured base roundtrip must reject them, rather than authorize their loss.
    directory = out + '/unsupported-bone-' + setting
    os.makedirs(directory, exist_ok=True)
    try:
        p.prepare(blend, directory, scope)
        raise AssertionError('Unsupported bone inheritance base was authorized: ' + setting)
    except RuntimeError as error:
        assert 'Unsupported protected base GLB roundtrip' in str(error) and 'Rig' in str(error) and 'armature' in str(error), str(error)
        assert not os.path.exists(directory + '/base-validation.json')
        checks.append('blocked unsupported bone inheritance base ' + setting + ': ' + str(error))
        bone_evidence.append({'setting':setting, 'value':value, 'parentRotationDegrees':60, 'maxHeadMeshDifference':deformation_difference, 'candidateDiagnostic':candidate_error, 'baseDiagnostic':str(error), 'publicationEvidenceWritten':False})
assert hashlib.sha256(open(source, 'rb').read()).hexdigest() == source_hash
bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
# Exercise the complete recorded binding/visibility settings individually.
with open(out + '/prepared/baseline.json') as f:
    before=json.load(f)
body = bpy.data.objects['Body']
modifier = body.modifiers[0]
for setting in before['objects']['Body']['armature'][0]['settings']:
    original = getattr(modifier, setting)
    setattr(modifier, setting, not original if isinstance(original, bool) else 'Root')
    try:
        p.compare(before, p.snapshot(), scope)
        raise AssertionError('Uncaught skin binding setting: ' + setting)
    except RuntimeError as error:
        assert 'Body' in str(error) and 'armature' in str(error), str(error)
        checks.append('blocked skin binding setting ' + setting)
    finally:
        setattr(modifier, setting, original)
for setting in before['objects']['Body']['visibility']:
    original = body.hide_get() if setting == 'hidden' else getattr(body, setting)
    if setting == 'hidden':
        body.hide_set(not original)
    else:
        setattr(body, setting, not original)
    try:
        p.compare(before, p.snapshot(), scope)
        raise AssertionError('Uncaught visibility setting: ' + setting)
    except RuntimeError as error:
        assert 'Body' in str(error) and 'visibility' in str(error), str(error)
        checks.append('blocked visibility setting ' + setting)
    finally:
        if setting == 'hidden':
            body.hide_set(original)
        else:
            setattr(body, setting, original)

def root_motion():
    body = bpy.data.objects['Body']
    root = bpy.data.objects['Rig'].pose.bones['Root']
    def position():
        bpy.context.view_layer.update()
        evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        return (evaluated.matrix_world @ evaluated.data.vertices[0].co).copy()
    original = root.location.copy()
    start = position()
    root.location.x += 0.25
    delta = position() - start
    root.location = original
    bpy.context.view_layer.update()
    return delta.x

# Reproduce both review defects on saved scenes with a valid Hair edit.
# No failed validation may produce the evidence used to publish a candidate.
assert abs(root_motion() - 0.25) < 0.00001
checks.append('authorized Hair candidate still deforms Body by 0.25 with Root')
# Evaluation mode can disable the complete rig without changing any bone,
# modifier or weight. Check saved scenes and measured GLB compatibility.
armature_evidence = {}
for label, file in [('source', source), ('authorizedScene', out + '/edited.blend'), ('authorizedGlb', out + '/edited.glb')]:
    p.open_base(file)
    armature_evidence[label] = {'posePosition':bpy.data.objects['Rig'].data.pose_position, 'bodyRootTranslation':root_motion()}
    assert armature_evidence[label]['posePosition'] == 'POSE'
    assert abs(armature_evidence[label]['bodyRootTranslation'] - 0.25) < 0.00001
checks.append('source and reopened authorized Hair scene/GLB retain POSE mode and 0.25 Body deformation')
bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
bpy.data.objects['Rig'].data.pose_position = 'REST'
blend = out + '/rest-mode.blend'
glb = out + '/rest-mode.glb'
evidence = out + '/rest-mode-validation.json'
bpy.ops.wm.save_as_mainfile(filepath=blend, compress=False)
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=False, export_animations=False)
bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
armature_evidence['unauthorizedScene'] = {'posePosition':bpy.data.objects['Rig'].data.pose_position, 'bodyRootTranslation':root_motion()}
assert armature_evidence['unauthorizedScene']['posePosition'] == 'REST'
assert abs(armature_evidence['unauthorizedScene']['bodyRootTranslation']) < 0.00001
checks.append('reopened REST-mode candidate moves Body by zero with Root')
if os.path.exists(evidence):
    os.remove(evidence)
try:
    p.validate(out + '/prepared/baseline.json', scope, blend, glb, evidence)
    raise AssertionError('Unauthorized REST evaluation mode became candidate publication evidence')
except RuntimeError as error:
    assert 'Rig' in str(error) and 'posePosition' in str(error), str(error)
    assert not os.path.exists(evidence)
    armature_evidence['candidateDiagnostic'] = str(error)
    armature_evidence['publicationEvidenceWritten'] = False
    checks.append('blocked saved REST-mode candidate: ' + str(error))
directory = out + '/unsupported-rest-mode'
os.makedirs(directory, exist_ok=True)
try:
    p.prepare(blend, directory, scope)
    raise AssertionError('Unsupported REST evaluation mode base roundtrip passed')
except RuntimeError as error:
    assert 'Unsupported protected base GLB roundtrip' in str(error) and 'Rig' in str(error) and 'posePosition' in str(error), str(error)
    assert not os.path.exists(directory + '/base-validation.json')
    armature_evidence['baseDiagnostic'] = str(error)
    checks.append('blocked unsupported REST-mode base: ' + str(error))
assert hashlib.sha256(open(source, 'rb').read()).hexdigest() == source_hash
for feature in ['disabled-skin', 'hidden-torso']:
    bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
    if feature == 'disabled-skin':
        bpy.data.objects['Body'].modifiers[0].use_vertex_groups = False
        expected = 'armature'
    else:
        bpy.data.objects['Body'].hide_render = True
        expected = 'visibility'
    blend = out + '/' + feature + '.blend'
    glb = out + '/' + feature + '.glb'
    evidence = out + '/' + feature + '-validation.json'
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=False)
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=False, export_animations=False)
    bpy.ops.wm.open_mainfile(filepath=blend, use_scripts=False)
    if feature == 'disabled-skin':
        assert abs(root_motion()) < 0.00001
        checks.append('reopened disabled-skin scene moves Body by zero with Root')
    else:
        assert bpy.data.objects['Body'].hide_render
    if os.path.exists(evidence):
        os.remove(evidence)
    try:
        p.validate(out + '/prepared/baseline.json', scope, blend, glb, evidence)
        raise AssertionError('Unauthorized ' + feature + ' became candidate publication evidence')
    except RuntimeError as error:
        assert 'Body' in str(error) and expected in str(error), str(error)
        assert not os.path.exists(evidence)
        checks.append('blocked candidate ' + feature + ': ' + str(error))
    # glTF export normalizes use_vertex_groups back to enabled on import.
    # Also test an export-only loss of the skin binding itself.
    if feature == 'disabled-skin':
        bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
        bpy.data.objects['Body'].modifiers[0].object = None
        unbound_glb = out + '/unbound-export.glb'
        bpy.ops.export_scene.gltf(filepath=unbound_glb, export_format='GLB', export_apply=False, export_animations=False)
        try:
            p.validate(out + '/prepared/baseline.json', scope, out + '/edited.blend', unbound_glb, out + '/skin-roundtrip-validation.json')
            raise AssertionError('Export-only skin change passed GLB validation')
        except RuntimeError as error:
            assert 'GLB roundtrip mismatch' in str(error) and 'Body' in str(error), str(error)
            checks.append('blocked export-only skin binding change: ' + str(error))

# These Blender features cannot survive this GLB path. Fail base preparation
# explicitly instead of silently normalizing them into an approved baseline.
for feature in ['preserve-volume', 'render-visibility']:
    bpy.ops.wm.open_mainfile(filepath=out + '/prepared/base.blend', use_scripts=False)
    if feature == 'preserve-volume':
        bpy.data.objects['Body'].modifiers[0].use_deform_preserve_volume = True
    else:
        bpy.data.objects['Body'].hide_render = True
    source_file = out + '/' + feature + '-base.blend'
    bpy.ops.wm.save_as_mainfile(filepath=source_file, compress=False)
    directory = out + '/unsupported-' + feature
    os.makedirs(directory, exist_ok=True)
    try:
        p.prepare(source_file, directory, scope)
        raise AssertionError('Unsupported ' + feature + ' base roundtrip passed')
    except RuntimeError as error:
        assert 'Unsupported protected base GLB roundtrip' in str(error) and 'Body' in str(error), str(error)
        checks.append('blocked unsupported base ' + feature + ': ' + str(error))
for feature in ['weights','shapeKeys','uvs','materials','armature','pose','uv-name','protected-object']:
    bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
    if feature == 'weights':
        bpy.data.objects['Body'].vertex_groups['Root'].add([0],0.25,'REPLACE')
    elif feature == 'shapeKeys':
        bpy.data.objects['HeadMesh'].data.shape_keys.key_blocks['Smile'].data[0].co.x += 0.2
    elif feature == 'uvs':
        bpy.data.objects['Body'].data.uv_layers[0].data[0].uv.x += 0.2
    elif feature == 'materials':
        bpy.data.materials['CharacterMaterial'].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(1,0,0,1)
    elif feature == 'pose':
        bpy.data.objects['Rig'].pose.bones['Head'].rotation_mode = 'XYZ'
        bpy.data.objects['Rig'].pose.bones['Head'].rotation_euler.x += 0.2
    elif feature == 'uv-name':
        bpy.data.objects['Body'].data.uv_layers[0].name = 'UnauthorizedUVRename'
    elif feature == 'armature':
        bpy.context.view_layer.objects.active = bpy.data.objects['Rig']
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.data.armatures['Skeleton'].edit_bones['Head'].tail.x += 0.2
        bpy.ops.object.mode_set(mode='OBJECT')
    else:
        bpy.data.objects['Body'].data.vertices[0].co.x += 0.2
    with open(out + '/prepared/baseline.json') as f:
        before=json.load(f)
    try:
        p.compare(before, p.snapshot(), scope)
        raise AssertionError('Uncaught protected feature: ' + feature)
    except RuntimeError as error:
        checks.append('blocked ' + feature + ': ' + str(error))
# Exercise every accepted Principled socket, rather than maintaining another
# short allowlist that could omit newly supported material inputs.
with open(out + '/prepared/baseline.json') as f:
    before=json.load(f)
bpy.ops.wm.open_mainfile(filepath=out + '/edited.blend', use_scripts=False)
shader = bpy.data.materials['CharacterMaterial'].node_tree.nodes.get('Principled BSDF')
for socket in shader.inputs:
    original = socket.default_value[:] if socket.type in {'RGBA', 'VECTOR'} else socket.default_value
    if socket.type in {'RGBA', 'VECTOR'}:
        value = list(original)
        value[0] = 0.25 if value[0] != 0.25 else 0.75
        socket.default_value = value
    else:
        socket.default_value = 0.25 if original != 0.25 else 0.75
    try:
        p.compare(before, p.snapshot(), scope)
        raise AssertionError('Uncaught Principled property: ' + socket.name)
    except RuntimeError as error:
        assert 'materials' in str(error), str(error)
        checks.append('blocked Principled ' + socket.name)
    finally:
        socket.default_value = original
mat = bpy.data.materials['CharacterMaterial']
for setting in p.material(mat)['settings']:
    original = getattr(mat, setting)
    if isinstance(original, bool):
        value = not original
    elif isinstance(original, str):
        value = next(item.identifier for item in mat.bl_rna.properties[setting].enum_items if item.identifier != original)
    else:
        value = 0.25 if original != 0.25 else 0.75
    setattr(mat, setting, value)
    try:
        p.compare(before, p.snapshot(), scope)
        raise AssertionError('Uncaught material setting: ' + setting)
    except RuntimeError as error:
        assert 'materials' in str(error), str(error)
        checks.append('blocked material setting ' + setting)
    finally:
        setattr(mat, setting, original)
for setting in p.material(mat)['shaderSettings']:
    original = getattr(shader, setting)
    value = next(item.identifier for item in shader.bl_rna.properties[setting].enum_items if item.identifier != original)
    setattr(shader, setting, value)
    try:
        p.compare(before, p.snapshot(), scope)
        raise AssertionError('Uncaught shader setting: ' + setting)
    except RuntimeError as error:
        assert 'materials' in str(error), str(error)
        checks.append('blocked shader setting ' + setting)
    finally:
        setattr(shader, setting, original)
# Reproduce the review finding at the actual candidate validation boundary:
# Hair has a permitted edit, while its shared material emits unauthorized red.
shader.inputs['Emission Color'].default_value = (1,0,0,1)
shader.inputs['Emission Strength'].default_value = 1
bpy.ops.wm.save_as_mainfile(filepath=out + '/emission.blend', compress=False)
bpy.ops.export_scene.gltf(filepath=out + '/emission.glb', export_format='GLB', export_apply=False, export_animations=False)
assert any(m.get('emissiveFactor') == [1,0,0] for m in p.preflight_glb(out + '/emission.glb').get('materials', []))
try:
    p.validate(out + '/prepared/baseline.json', scope, out + '/emission.blend', out + '/emission.glb', out + '/emission-validation.json')
    raise AssertionError('Unauthorized emission became valid acceptance/export evidence')
except RuntimeError as error:
    assert 'materials' in str(error), str(error)
    checks.append('blocked unauthorized emission in candidate scene and exported GLB: ' + str(error))
try:
    p.validate(out + '/prepared/baseline.json', scope, out + '/edited.blend', out + '/emission.glb', out + '/emission-roundtrip-validation.json')
    raise AssertionError('Export-only emission change passed roundtrip validation')
except RuntimeError as error:
    assert 'materials' in str(error), str(error)
    checks.append('blocked export-only emission change: ' + str(error))
p.write(out + '/report.json', {'realBlender':True, 'codexUsed':False, 'checks':checks, 'preservation':report, 'expressions':expression_evidence, 'boneInheritance':bone_evidence, 'armatureEvaluation':armature_evidence, 'collectionVisibility':visibility_evidence})
`);
try {
  await runProcess(process.env.GEN3D_BLENDER_BIN || 'blender', ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', script], { timeout: 180000, onLine: line => { if (/Error|RuntimeError|Traceback|AssertionError/.test(line)) console.log(line); } });
  const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
  assert.equal(report.preservation.passed, true); assert.equal(report.preservation.roundtrip.passed, true);
  report.sourceSha256 = fileHash(path.join(output,'character.blend')); report.validatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output,'report.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify({ realBlender:true, checks:report.checks, output }));
} catch(e) { console.error(e.message); process.exitCode=1; }
