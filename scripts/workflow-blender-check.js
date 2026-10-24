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
p.write(out + '/report.json', {'realBlender':True, 'codexUsed':False, 'checks':checks, 'preservation':report})
`);
try {
  await runProcess(process.env.GEN3D_BLENDER_BIN || 'blender', ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', script], { timeout: 180000, onLine: line => { if (/Error|RuntimeError|Traceback|AssertionError/.test(line)) console.log(line); } });
  const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
  assert.equal(report.preservation.passed, true); assert.equal(report.preservation.roundtrip.passed, true);
  report.sourceSha256 = fileHash(path.join(output,'character.blend')); report.validatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output,'report.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify({ realBlender:true, checks:report.checks, output }));
} catch(e) { console.error(e.message); process.exitCode=1; }
