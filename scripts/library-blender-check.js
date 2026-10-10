// Deterministic real Blender validation. No Codex invocation or allowance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.js';
import { runProcess } from '../src/codex.js';
import { exportCode, validateArtifacts } from '../src/runner.js';
import { referenceSheet, referenceDecisions } from '../src/model-reference-visuals.js';

const output = path.resolve(process.env.GEN3D_LIBRARY_OUTPUT || '.gen3d/library-blender-check');
fs.mkdirSync(output, { recursive: true });
const source = path.join(output, 'sources'); fs.mkdirSync(source, { recursive: true });
const runtimeDir = path.resolve('blender');
const run = async (name, python) => {
  const file = path.join(output, name + '.py'); fs.writeFileSync(file, python);
  const log = await runProcess(process.env.GEN3D_BLENDER_BIN || 'blender', ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', file], { timeout: 180000 });
  fs.writeFileSync(path.join(output, name + '.log'), log); return log;
};
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
await run('fixtures', `import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8)
o = bpy.context.object
o.name = 'Stylized_head'
o.scale = (1.5, 0.7, 1.2)
mat = bpy.data.materials.new('Peach_stylized')
mat.diffuse_color = (0.8, 0.3, 0.2, 1)
o.data.materials.append(mat)
mat.use_nodes = True
group = bpy.data.node_groups.new('Packed_style_group', 'ShaderNodeTree')
texture = group.nodes.new('ShaderNodeTexImage')
texture.image = bpy.data.images.new('Packed_style_texture', width=2, height=2)
texture.image.pack()
node = mat.node_tree.nodes.new('ShaderNodeGroup')
node.name = 'Packed_style_group'
node.node_tree = group
o.shape_key_add(name='Basis')
key = o.shape_key_add(name='Anime_cheeks')
for point in key.data:
    point.co.x *= 1.1
detail = o.modifiers.new('Controlled_surface_detail', 'DISPLACE')
detail.texture = bpy.data.textures.new('Gentle_detail', type='CLOUDS')
detail.strength = .02
bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(path.join(source, 'head.blend'))}, compress=False)
bpy.ops.export_scene.gltf(filepath=${JSON.stringify(path.join(source, 'style.glb'))}, export_format='GLB')
# Valid header but corrupt contents; external dependencies must be rejected too.
image = bpy.data.images.new('Unpacked_texture', width=2, height=2)
image.filepath_raw = ${JSON.stringify(path.join(source, 'texture.png'))}
image.file_format = 'PNG'
image.save()
mat.use_nodes = True
node = mat.node_tree.nodes.new('ShaderNodeTexImage')
node.image = bpy.data.images.load(image.filepath_raw)
bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(path.join(source, 'unpacked.blend'))}, compress=False)
# Two role-specific GLBs, including two independently attributable parts in one.
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for index in range(3):
    bpy.ops.mesh.primitive_cube_add(location=(index * 3, 0, 0))
    o = bpy.context.object
    o.name = ['Body', 'Collar', 'Hair'][index]
    o.scale = [(1, .5, 1), (.5, .7, .3), (.8, .6, .4)][index]
    material = bpy.data.materials.new(o.name + '_color')
    material.use_nodes = True
    material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = [(1, 0, 0, 1), (0, 1, 0, 1), (0, 0, 1, 1)][index]
    o.data.materials.append(material)
bpy.ops.object.select_all(action='DESELECT')
for name in ['Body', 'Collar']:
    bpy.data.objects[name].select_set(True)
bpy.ops.export_scene.gltf(filepath=${JSON.stringify(path.join(source, 'parts.glb'))}, export_format='GLB', use_selection=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.data.objects['Hair'].select_set(True)
bpy.ops.export_scene.gltf(filepath=${JSON.stringify(path.join(source, 'hair.glb'))}, export_format='GLB', use_selection=True)
`);
const store = new Store(fs.mkdtempSync(path.join(output, 'data-')));
const managed = await store.library.import({ name: 'style.glb', data: fs.readFileSync(path.join(source, 'style.glb')).toString('base64') });
store.library.addSource({ directory: source }, 'web');
const head = store.library.list({ search: 'head.blend' }).assets[0];
await store.library.inspected(head.id);
const unpacked = store.library.list({ search: 'unpacked.blend' }).assets[0];
await assert.rejects(store.library.inspected(unpacked.id), /Blender could not inspect/);
const corrupt = Buffer.from(fs.readFileSync(path.join(source, 'head.blend')).subarray(0, 40));
await assert.rejects(store.library.import({ name: 'corrupt.blend', data: corrupt.toString('base64') }), /Blender could not inspect/);
const manifest = store.library.jobFiles([{ assetId: managed.id, name: managed.name, sha256: managed.sha256, role: 'overall style', permission: 'reference-only' }, { assetId: head.id, name: head.name, sha256: store.library.get(head.id).sha256, role: 'face', permission: 'reuse-edit' }]);
const before = Object.fromEntries(manifest.map(a => [a.assetId, hash(a.path)]));
const parts = await store.library.import({ name: 'parts.glb', data: fs.readFileSync(path.join(source, 'parts.glb')).toString('base64') });
const hair = await store.library.import({ name: 'hair.glb', data: fs.readFileSync(path.join(source, 'hair.glb')).toString('base64') });
const combinedManifest = store.library.jobFiles([
  { assetId: parts.id, sha256: parts.sha256, role: 'body and collar', permission: 'reuse-edit' },
  { assetId: hair.id, sha256: hair.sha256, role: 'hair', permission: 'reuse-edit' },
  { assetId: managed.id, sha256: managed.sha256, role: 'style', permission: 'reference-only' },
]);
const combinedHashes = Object.fromEntries(combinedManifest.map(a => [a.assetId, hash(a.path)]));
const fixtureHashes = Object.fromEntries(['parts.glb', 'hair.glb', 'style.glb'].map(name => [name, hash(path.join(source, name))]));
const finalDir = path.join(output, 'deliverable'); fs.mkdirSync(finalDir, { recursive: true });
await run('isolation', `import bpy, sys, json
sys.path.insert(0, ${JSON.stringify(runtimeDir)})
import reference_runtime as refs
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
loaded = refs.load_references(json.loads(${JSON.stringify(JSON.stringify(manifest))}))
assert len(loaded) == 2
assert len(bpy.context.scene.objects) == 0
reference_views = []
for asset in json.loads(${JSON.stringify(JSON.stringify(manifest))}):
    reference_views.append({'assetId': asset['assetId'], 'views': refs.render_reference(asset['assetId'], ${JSON.stringify(path.join(output, 'reference-renders'))} + '/' + asset['assetId'])})
with open(${JSON.stringify(path.join(output, 'reference-views.json'))}, 'w') as f:
    json.dump(reference_views, f)
try:
    refs.reuse_object(${JSON.stringify(managed.id)}, loaded[0]['objects'][0]['name'])
except RuntimeError as error:
    assert 'does not permit' in str(error)
else:
    raise AssertionError('Reference-only mesh was copied')
name = loaded[1]['objects'][0]['name']
copy = refs.reuse_object(${JSON.stringify(head.id)}, name)
o = bpy.data.objects[copy['object']]
assert o.data.shape_keys is not None
assert 'Anime_cheeks' in o.data.shape_keys.key_blocks
original = next(s for s in bpy.data.scenes if s.get('gen3d_reference_asset') == ${JSON.stringify(head.id)}).objects[name]
assert o.data != original.data and o.data.materials[0] != original.data.materials[0]
assert o.data.shape_keys != original.data.shape_keys
copied_group = o.data.materials[0].node_tree.nodes['Packed_style_group'].node_tree
original_group = original.data.materials[0].node_tree.nodes['Packed_style_group'].node_tree
assert copied_group != original_group
assert copied_group.nodes[0].image != original_group.nodes[0].image
assert o.modifiers['Controlled_surface_detail'].texture != original.modifiers['Controlled_surface_detail'].texture
coordinate = o.data.materials[0].node_tree.nodes.new('ShaderNodeTexCoord')
coordinate.object = original
try:
    refs.validate_deliverable(json.loads(${JSON.stringify(JSON.stringify(manifest))}))
except RuntimeError as error:
    assert 'inspection object' in str(error)
else:
    raise AssertionError('Source material coordinate dependency accepted')
coordinate.object = None
o.data.materials[0].diffuse_color = (0, 1, 0, 1)
assert tuple(original.data.materials[0].diffuse_color) != tuple(o.data.materials[0].diffuse_color)
# Semantic shape-key edit and a useful optional subdivision on the independent mesh.
o.data.shape_keys.key_blocks['Anime_cheeks'].value = .7
o.scale.z *= 1.15
modifier = o.modifiers.new('Controlled_subdivision', 'SUBSURF')
modifier.levels = modifier.render_levels = 1
bpy.context.view_layer.update()
evaluated = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
evaluated_mesh = evaluated.to_mesh()
evaluated_vertices = len(evaluated_mesh.vertices)
source_vertices = len(original.data.vertices)
expected_positions = [evaluated.matrix_world @ v.co for v in evaluated_mesh.vertices]
expected_triangles = sum(len(p.vertices) - 2 for p in evaluated_mesh.polygons)
assert evaluated_vertices > len(original.data.vertices)
evaluated.to_mesh_clear()
# Reject source-object dependencies and unusable modifier results before export.
bad = o.modifiers.new('Forbidden_source_dependency', 'MIRROR')
bad.mirror_object = original
try:
    refs.validate_deliverable(json.loads(${JSON.stringify(JSON.stringify(manifest))}))
except RuntimeError as error:
    assert 'inspection object' in str(error)
else:
    raise AssertionError('Source modifier dependency accepted')
o.modifiers.remove(bad)
bad = o.modifiers.new('Empty_geometry', 'MASK')
try:
    bpy.context.view_layer.update()
    refs.validate_deliverable(json.loads(${JSON.stringify(JSON.stringify(manifest))}))
except RuntimeError as error:
    assert 'unusable mesh' in str(error)
else:
    raise AssertionError('Empty modifier result accepted')
o.modifiers.remove(bad)
# An incidental reference linked into the deliverable is still excluded.
ref = next(s for s in bpy.data.scenes if s.get('gen3d_reference_asset') == ${JSON.stringify(managed.id)}).objects[0]
bpy.context.scene.collection.objects.link(ref)
${exportCode(finalDir, { modelReferences: manifest })}
assert len([o for o in bpy.context.scene.objects if o.type == 'MESH']) == 1
assert not any(o.get('gen3d_reference_asset') for o in bpy.data.objects)
assert not any(s.get('gen3d_reference_asset') for s in bpy.data.scenes)
with open(${JSON.stringify(path.join(output, 'isolation.json'))}, 'w') as f:
    json.dump({'loaded': loaded, 'deliverableMeshes': 1, 'permissionRefusal': True, 'independentMeshMaterialsShapeKeys': True,
               'semanticShapeKeyValue': o.data.shape_keys.key_blocks['Anime_cheeks'].value,
               'sourceVertices': source_vertices,
               'evaluatedVertices': evaluated_vertices, 'sourceDependencyRejected': True, 'emptyModifierRejected': True}, f)
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(path.join(finalDir, 'scene.blend'))}, use_scripts=False)
assert len([o for o in bpy.data.objects if o.type == 'MESH']) == 1
assert len(bpy.data.scenes) == 1
assert not any(o.get('gen3d_reference_asset') for o in bpy.data.objects)
reopened = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
assert abs(reopened.data.shape_keys.key_blocks['Anime_cheeks'].value - .7) < .00001
for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH':
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=${JSON.stringify(path.join(finalDir, 'model.glb'))})
exported = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(exported) == 1
assert len(exported[0].data.vertices) >= evaluated_vertices, 'GLB lost evaluated subdivision detail'
assert len(exported[0].data.polygons) == expected_triangles, 'GLB lost evaluated topology'
from mathutils.kdtree import KDTree
actual_positions = [exported[0].matrix_world @ v.co for v in exported[0].data.vertices]
for original_points, imported_points in [(expected_positions, actual_positions), (actual_positions, expected_positions)]:
    tree = KDTree(len(original_points))
    for i, point in enumerate(original_points):
        tree.insert(point, i)
    tree.balance()
    assert all(tree.find(point)[2] < .00005 for point in imported_points), 'GLB geometry differs from evaluated mesh'
bpy.context.scene.render.filepath = ${JSON.stringify(path.join(finalDir, 'model-roundtrip.png'))}
bpy.ops.render.render(write_still=True)
`);
assert.equal(validateArtifacts(finalDir).meshes, 1);
const editedProvenance = JSON.parse(fs.readFileSync(path.join(finalDir, 'reference-provenance.json')));
assert.equal(editedProvenance.length, 1);
assert.equal(editedProvenance[0].assetId, head.id, 'Semantic edits/modifiers lost source provenance');
const combinedDir = path.join(output, 'combined'); fs.mkdirSync(combinedDir, { recursive: true });
await run('combined', `import bpy, sys, json
from mathutils.kdtree import KDTree
sys.path.insert(0, ${JSON.stringify(runtimeDir)})
import reference_runtime as refs
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
manifest = json.loads(${JSON.stringify(JSON.stringify(combinedManifest))})
loaded = refs.load_references(manifest)
def source_state():
    return {o.name: {'vertices': [list(v.co) for v in o.data.vertices],
                     'materials': [m.name for m in o.data.materials],
                     'attributes': [a.name for a in o.data.attributes]}
            for s in bpy.data.scenes if s.get('gen3d_reference_asset')
            for o in s.objects if o.type == 'MESH'}
original_state = source_state()
copies = []
expected_origins = set()
for asset in loaded[:2]:
    for info in asset['objects']:
        if info['type'] == 'MESH':
            copy = refs.reuse_object(asset['assetId'], info['name'])
            copies.append(bpy.data.objects[copy['object']])
            expected_origins.add((asset['assetId'], info['name']))
assert len(copies) == 3
expected_vertices = sum(len(o.data.vertices) for o in copies)
def join(objects, active):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    assert bpy.ops.object.join() == {'FINISHED'}
    return active
# First combine two parts of one asset, then join with another active asset.
same_asset = join(copies[:2], copies[0])
assert len([p for p in refs.validate_deliverable(manifest) if p['targetObject'] == same_asset.name]) == 2
combined = join([same_asset, copies[2]], copies[2])
combined.name = 'Combined_roles'
combined.scale.z *= 1.2
bpy.context.view_layer.update()
assert len(combined.data.vertices) == expected_vertices
assert len(combined.data.materials) == 3
provenance = refs.validate_deliverable(manifest)
assert {(p['assetId'], p['objectName']) for p in provenance} == expected_origins
assert len(provenance) == 3 and all(p['targetObject'] == combined.name for p in provenance)
assert source_state() == original_state, 'Combination modified inspection sources'
# Permission must cover every contributor, including the non-active asset.
for asset_id in [manifest[0]['assetId'], manifest[1]['assetId']]:
    denied = [dict(r, permission='reference-only') if r['assetId'] == asset_id else r for r in manifest]
    try:
        refs.validate_deliverable(denied)
    except RuntimeError as error:
        assert 'Unapproved reference reuse' in str(error)
    else:
        raise AssertionError('Joined geometry bypassed contributor permission')
try:
    refs.reuse_object(manifest[2]['assetId'], loaded[2]['objects'][0]['name'])
except RuntimeError as error:
    assert 'does not permit' in str(error)
else:
    raise AssertionError('Reference-only geometry copied for combination')
expected_positions = [combined.matrix_world @ v.co for v in combined.data.vertices]
expected_triangles = sum(len(p.vertices) - 2 for p in combined.data.polygons)
${exportCode(combinedDir, { modelReferences: combinedManifest })}
assert len(bpy.data.scenes) == 1
assert not any(o.get('gen3d_reference_asset') for o in bpy.data.objects)
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(path.join(combinedDir, 'scene.blend'))}, use_scripts=False)
assert refs.validate_deliverable(manifest) == provenance, 'Saved scene lost combined provenance'
assert len([o for o in bpy.data.objects if o.type == 'MESH']) == 1
combined = bpy.data.objects['Combined_roles']
# Removed pieces must not retain provenance merely because their mask exists.
import bmesh
mesh = bmesh.new()
mesh.from_mesh(combined.data)
origin = next(token for token, value in json.loads(bpy.context.scene[refs.ORIGIN_REGISTRY]).items() if value['assetId'] == manifest[1]['assetId'])
indices = [index for index, point in enumerate(combined.data.attributes[origin].data) if point.value]
mesh.verts.ensure_lookup_table()
bmesh.ops.delete(mesh, geom=[mesh.verts[index] for index in indices], context='VERTS')
mesh.to_mesh(combined.data)
mesh.free()
bpy.context.view_layer.update()
remaining = refs.validate_deliverable(manifest)
assert len(remaining) == 2 and all(p['assetId'] == manifest[0]['assetId'] for p in remaining)
for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH':
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=${JSON.stringify(path.join(combinedDir, 'model.glb'))})
exported = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(exported) == 1
assert len(exported[0].data.materials) == 3
assert len(exported[0].data.polygons) == expected_triangles
actual_positions = [exported[0].matrix_world @ v.co for v in exported[0].data.vertices]
for original_points, imported_points in [(expected_positions, actual_positions), (actual_positions, expected_positions)]:
    tree = KDTree(len(original_points))
    for index, point in enumerate(original_points):
        tree.insert(point, index)
    tree.balance()
    assert all(tree.find(point)[2] < .00005 for point in imported_points), 'Combined GLB lost contributed geometry'
bpy.context.scene.render.filepath = ${JSON.stringify(path.join(combinedDir, 'model-roundtrip.png'))}
bpy.ops.render.render(write_still=True)
`);
assert.equal(validateArtifacts(combinedDir).meshes, 1);
const combinedProvenance = JSON.parse(fs.readFileSync(path.join(combinedDir, 'reference-provenance.json')));
const combinedDecisions = referenceDecisions(combinedManifest, combinedManifest.map(m => ({ tool: 'choose_reference_usage', assetId: m.assetId,
  usage: m.permission === 'reuse-edit' ? 'reuse' : 'visual-only', reason: 'Apply each approved part to its assigned role; style stays visual-only.' })), combinedProvenance);
assert.deepEqual(combinedDecisions.map(d => d.objects.length), [2, 1, 0]);
assert.deepEqual(Object.fromEntries(combinedManifest.map(a => [a.assetId, hash(a.path)])), combinedHashes);
assert.deepEqual(Object.fromEntries(Object.keys(fixtureHashes).map(name => [name, hash(path.join(source, name))])), fixtureHashes);
fs.writeFileSync(path.join(combinedDir, 'decisions.json'), JSON.stringify(combinedDecisions, null, 2));
const rendered = JSON.parse(fs.readFileSync(path.join(output, 'reference-views.json')));
for (const record of rendered) {
  assert.equal(record.views.length, 8);
  await referenceSheet(manifest.find(r => r.assetId === record.assetId), record.views, path.join(output, 'reference-renders', record.assetId));
}
const after = Object.fromEntries(manifest.map(a => [a.assetId, hash(a.path)])); assert.deepEqual(after, before);
const report = { realBlender: true, codexUsed: false, checkedAt: new Date().toISOString(), checks: ['real GLB managed import', 'real .blend folder inspection', 'modern .blend header', 'reject valid-header corrupt file', 'reject unpacked missing/external textures', 'load both into separate scenes', 'reject reference-only duplication', 'reuse independent mesh/materials/shape keys/node groups/images', 'semantic shape-key edit and optional subdivision', 'reimport GLB and verify evaluated subdivision geometry', 'reject inspection-object modifier dependencies', 'reject empty evaluated modifier results', 'strip incidental geometry from render/GLB/.blend', 'reopen .blend and check single mesh and scene', 'unchanged library/source file hashes', 'ordinary joins preserve multiple assets and same-asset source objects', 'joined contributor permissions and removed geometry checked', 'combined GLB geometry/materials and saved .blend provenance verified'], sourceHashes: before, combinedSourceHashes: combinedHashes, fixtureHashes, combinedProvenance, isolation: JSON.parse(fs.readFileSync(path.join(output, 'isolation.json'))), outputMeshes: 1 };
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Real Blender library checks passed: ${output}`);
