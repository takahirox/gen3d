// Opt-in live Codex + local Blender trial. Uses ChatGPT allowance once; no retry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.js';
import { Runner } from '../src/runner.js';
import { blenderCall } from '../src/blender.js';
import { runProcess } from '../src/codex.js';

const output = path.resolve(process.env.GEN3D_LIBRARY_LIVE_OUTPUT || '.gen3d/library-live-validation');
fs.mkdirSync(output, { recursive: true });
const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const env = { ...process.env, GEN3D_BLENDER_PORT: String(port) };
const bridge = spawn(env.GEN3D_BLENDER_BIN || 'blender', ['--background', '--factory-startup', '--disable-autoexec', '--python', path.resolve('blender/gen3d_bridge.py'), '--', '--serve'], { env, stdio: 'ignore' });
const assets = path.resolve('docs/validation/issue10/prop/model-1');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const store = new Store(fs.mkdtempSync(path.join(output, 'data-')), { env });
let runner, p;
try {
  const deadline = Date.now() + 15000;
  while (true) { try { await blenderCall('get_scene_info', {}, { port, timeout: 1000 }); break; } catch (e) { if (Date.now() > deadline || bridge.exitCode !== null) throw e; await new Promise(resolve => setTimeout(resolve, 250)); } }
  const examples = path.join(output, 'sources'); fs.mkdirSync(examples, { recursive: true });
  const script = path.join(output, 'fixtures.py');
  fs.writeFileSync(script, `import bpy, os
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(path.join(assets, 'scene.blend'))}, use_scripts=False)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for label, words in [('body', []), ('doors', ['door']), ('hardware', ['knob']), ('feet', ['foot'])]:
    bpy.ops.object.select_all(action='DESELECT')
    selected = [o for o in meshes if not words or any(w in o.name.lower() for w in words)]
    for o in selected:
        o.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(${JSON.stringify(examples)}, label + '.glb'), export_format='GLB', use_selection=True, export_apply=True)
`);
  await runProcess(env.GEN3D_BLENDER_BIN || 'blender', ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', script], { env, timeout: 180000 });
  const selected = [];
  for (const [name, role, permission] of [['body', 'overall body proportions and standalone starting mesh; adapt to a slightly taller cabinet', 'reuse-edit'], ['doors', 'door panel shape and placement', 'reference-only'], ['hardware', 'round orange knob shapes and color; inspect only', 'reference-only'], ['feet', 'orange foot shape and placement; inspect only', 'reference-only']]) {
    const model = await store.library.import({ name: name + '.glb', data: fs.readFileSync(path.join(examples, name + '.glb')).toString('base64') });
    selected.push({ assetId: model.id, role, permission });
  }
  p = store.create({ name: 'Live 3D library trial', mode: 'image', image: 'data:image/png;base64,' + fs.readFileSync(path.resolve('docs/validation/issue10/prop/concept-1/concept.png')).toString('base64'),
    profile: 'object', prompt: 'Reconstruct the stylized teal cabinet with orange feet and round knobs from the input image. The body GLB is explicitly authorized as reusable starting geometry: inspect all four sheets, copy its appropriate parts via reuse_reference_mesh and adapt the cabinet to be eight percent taller while preserving its design. Prefer controlled transforms or shape edits. The three other GLBs are reference-only for doors, knobs and feet respectively. Never reuse those three sources. Preserve the clean stylized proportions. Keep this small validation task bounded, inspect all four references, reuse the permitted geometry, and finish with a useful cabinet model.',
    refinementSettings: { enabled: true, maxIterations: 1 }, checkpoints: { input: false, concept: false, multiView: false, preview: true } }, 'web');
  await store.selectModels(p.id, { models: selected }, 'web');
  for (const r of p.modelReferences) store.reviewModelReference(p.id, r.assetId, 'approved', 'web');
  const sources = store.library.jobFiles(store.library.snapshot(p.modelReferences));
  const before = Object.fromEntries(sources.map(s => [s.assetId, hash(s.path)]));
  runner = new Runner(store, { env });
  const started = Date.now();
  const timer = setInterval(() => console.log(JSON.stringify({ status: p.versions.at(-1)?.status, operations: p.activity.filter(e => e.type === 'blender_operation').length, usageLimited: runner.usageLimited })), 15000);
  try { runner.start(p.id, {}, 'web'); await runner.pending; } finally { clearInterval(timer); }
  const v = p.versions[0];
  if (v.modelReferenceVisuals) {
    assert.equal(v.modelReferenceVisuals.length, 4);
    for (const visual of v.modelReferenceVisuals) { assert.equal(visual.views.length, 8); store.imageArtifact(p.id, visual.sheet); }
  }
  const unchangedSources = sources.every(s => before[s.assetId] === hash(s.path));
  let isolation;
  if (v.status === 'ready') {
    await blenderCall('execute_code', { code: `import bpy\nbpy.ops.wm.open_mainfile(filepath=${JSON.stringify(store.artifact(p.id, v.artifacts.blend))}, use_scripts=False)` }, { port });
    const result = await blenderCall('execute_code', { code: "import bpy, json\nprint(json.dumps({'scenes': len(bpy.data.scenes), 'referenceObjects': sum(1 for o in bpy.data.objects if o.get('gen3d_reference_asset')), 'reusedMeshes': sum(1 for o in bpy.context.scene.objects if o.type == 'MESH' and o.get('gen3d_reused_from')), 'meshes': sum(1 for o in bpy.context.scene.objects if o.type == 'MESH')}))" }, { port });
    isolation = JSON.parse(result.output.trim());
    assert.equal(isolation.referenceObjects, 0); assert.equal(isolation.scenes, 1); assert.ok(isolation.reusedMeshes > 0);
    const adapted = await blenderCall('execute_code', { code: adaptationCode(sources, path.join(output, 'reuse-adaptation.json')) }, { port });
    isolation.adaptedMeshes = JSON.parse(adapted.output.trim()).adaptedMeshes;
    assert.ok(isolation.adaptedMeshes > 0, 'The permitted source must actually be adapted, not only named in a summary');
  }
  assert.equal(unchangedSources, true);
  const report = { live: true, realBlender: true, codexUsed: true, status: v.status, error: v.error, usageLimited: runner.usageLimited, elapsedMs: Date.now() - started, sourceHashes: before, unchangedSources, modelReferences: v.modelReferences, isolation, artifacts: v.artifacts, summary: v.summary, refinement: v.refinement, modelReferenceVisuals: v.modelReferenceVisuals, limitation: 'Real image-input cabinet trial with four distinct local GLBs; not an anime character aesthetic comparison or live text image-generation trial. Human final preview remains pending.' };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: v.status, error: v.error, isolation, unchangedSources, usageLimited: runner.usageLimited }));
  if (v.status !== 'ready') process.exitCode = 1;
} finally {
  if (bridge.exitCode === null) { bridge.kill(); await once(bridge, 'exit'); }
}

// Verify actual copied world-space geometry against the immutable source. This
// also works as a read-only check of saved live artifacts, without another turn.
export function adaptationCode(sources, evidence) {
  return `import bpy, sys, json, hashlib
sys.path.insert(0, ${JSON.stringify(path.resolve('blender'))})
import reference_runtime as refs
copies = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.get('gen3d_reused_from')]
refs.load_references(json.loads(${JSON.stringify(JSON.stringify(sources))}))
def fingerprint(obj):
    return hashlib.sha256(json.dumps(sorted([tuple(round(x, 5) for x in obj.matrix_world @ v.co) for v in obj.data.vertices])).encode()).hexdigest()
objects = []
for obj in copies:
    source_scene = next(s for s in bpy.data.scenes if s.get('gen3d_reference_asset') == obj['gen3d_reused_from'])
    source = source_scene.objects.get(obj['gen3d_reused_object'])
    if source is None:
        raise RuntimeError('Copied source object is missing from approved asset')
    original = fingerprint(source)
    edited = fingerprint(obj)
    objects.append({'assetId': obj['gen3d_reused_from'], 'objectName': source.name, 'targetObject': obj.name, 'sourceGeometrySha256': original, 'targetGeometrySha256': edited, 'adapted': original != edited})
refs.remove_references()
report = {'adaptedMeshes': sum(o['adapted'] for o in objects), 'objects': objects}
with open(${JSON.stringify(evidence)}, 'w') as file:
    json.dump(report, file, indent=2)
print(json.dumps({'adaptedMeshes': report['adaptedMeshes']}))`;
}
