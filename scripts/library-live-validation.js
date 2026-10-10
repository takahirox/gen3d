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
  const glb = await store.library.import({ name: 'stylized-cabinet.glb', data: fs.readFileSync(path.join(assets, 'model.glb')).toString('base64') });
  store.library.addSource({ directory: assets }, 'web');
  const blend = store.library.list({ search: 'scene.blend' }).assets[0];
  p = store.create({ name: 'Live 3D library trial', mode: 'image', image: 'data:image/png;base64,' + fs.readFileSync(path.resolve('docs/validation/issue10/prop/concept-1/concept.png')).toString('base64'),
    profile: 'object', prompt: 'Reconstruct the stylized teal cabinet with orange feet and round knobs from the input image. The GLB is explicitly authorized as reusable starting geometry: copy its appropriate parts via reuse_reference_mesh and arrange/adapt them to match the image. The .blend is inspection-only; use it to understand the intended style and materials. Preserve the clean stylized proportions. Keep this small validation task bounded, inspect both references, reuse the permitted geometry, and finish with a useful cabinet model.',
    checkpoints: { input: false, concept: false, multiView: false, preview: true } }, 'web');
  await store.selectModels(p.id, { models: [{ assetId: glb.id, role: 'Reusable stylized cabinet body, doors, knobs and feet', permission: 'reuse-edit' }, { assetId: blend.id, role: 'Inspect stylized proportions and materials; no geometry incorporation', permission: 'reference-only' }] }, 'web');
  for (const r of p.modelReferences) store.reviewModelReference(p.id, r.assetId, 'approved', 'web');
  const sources = store.library.jobFiles(store.library.snapshot(p.modelReferences));
  const before = Object.fromEntries(sources.map(s => [s.assetId, hash(s.path)]));
  runner = new Runner(store, { env });
  const started = Date.now();
  const timer = setInterval(() => console.log(JSON.stringify({ status: p.versions.at(-1)?.status, operations: p.activity.filter(e => e.type === 'blender_operation').length, usageLimited: runner.usageLimited })), 15000);
  try { runner.start(p.id, {}, 'web'); await runner.pending; } finally { clearInterval(timer); }
  const v = p.versions[0];
  const unchangedSources = sources.every(s => before[s.assetId] === hash(s.path));
  let isolation;
  if (v.status === 'ready') {
    const result = await blenderCall('execute_code', { code: "import bpy, json\nprint(json.dumps({'scenes': len(bpy.data.scenes), 'referenceObjects': sum(1 for o in bpy.data.objects if o.get('gen3d_reference_asset')), 'reusedMeshes': sum(1 for o in bpy.context.scene.objects if o.type == 'MESH' and o.get('gen3d_reused_from')), 'meshes': sum(1 for o in bpy.context.scene.objects if o.type == 'MESH')}))" }, { port });
    isolation = JSON.parse(result.output.trim());
    assert.equal(isolation.referenceObjects, 0); assert.equal(isolation.scenes, 1); assert.ok(isolation.reusedMeshes > 0);
  }
  assert.equal(unchangedSources, true);
  const report = { live: true, realBlender: true, codexUsed: true, status: v.status, error: v.error, usageLimited: runner.usageLimited, elapsedMs: Date.now() - started, sourceHashes: before, unchangedSources, modelReferences: v.modelReferences, isolation, artifacts: v.artifacts, summary: v.summary, limitation: 'Real image-input cabinet trial with two local references; not an anime character aesthetic comparison or live text image-generation trial. Human final preview remains pending.' };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: v.status, error: v.error, isolation, unchangedSources, usageLimited: runner.usageLimited }));
  if (v.status !== 'ready') process.exitCode = 1;
} finally {
  if (bridge.exitCode === null) { bridge.kill(); await once(bridge, 'exit'); }
}
