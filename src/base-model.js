import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';
import { fileHash } from './workflow.js';
const runtime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../blender');
export function editScope(value) {
  if (!value || !Array.isArray(value.editableObjects) || !value.editableObjects.length || value.editableObjects.length > 100
    || value.editableObjects.some(x => typeof x !== 'string' || !x.trim() || x.length > 200)
    || new Set(value.editableObjects).size !== value.editableObjects.length
    || !Array.isArray(value.allowChanges || []) || (value.allowChanges || []).some(x => !['armature', 'weights', 'shapeKeys', 'uvs', 'materials'].includes(x))
    || (value.allowNewObjects !== undefined && typeof value.allowNewObjects !== 'boolean')) throw new AppError('Specify editable mesh object names and optional explicit feature exceptions');
  return { editableObjects: value.editableObjects, allowChanges: value.allowChanges || [], allowNewObjects: value.allowNewObjects || false };
}
export async function authorizeBase(store, id, input, actor) {
  const release = store.beginOperation(id);
  try {
    const p = store.get(id); store.idle(p);
    if (actor !== 'web') throw new AppError('Editable base authorization requires a human in the web UI', 403);
    if (p.workflowRuns?.some(r => r.status === 'waiting-review')) throw new AppError('Resolve pending workflow review before changing the editable base', 409);
    const scope = editScope(input.scope), a = await store.library.inspected(input.assetId);
    if (input.sha256 !== undefined && input.sha256 !== a.sha256) throw new AppError('Model changed; choose it again', 409);
    const meshes = a.inspection.objects.filter(o => o.type === 'MESH').map(o => o.name);
    if (scope.editableObjects.some(name => !meshes.includes(name))) throw new AppError('Choose parts present in this model');
    store.idle(p);
    p.editableBase = { assetId: a.id, name: a.name, sha256: a.sha256, format: a.format, scope, review: 'approved', authorizedAt: new Date().toISOString() };
    store.event(p, actor, 'editable_base_authorized', { assetId: a.id, sha256: a.sha256, scope }); store.save(p); return p;
  } finally { release(); }
}
export async function prepareBase(store, runner, p, base, dir) {
  const a = store.library.get(base.assetId), source = store.library.resolve(a);
  if (base.review !== 'approved' || fileHash(source) !== base.sha256) throw new AppError('Editable base changed or lacks human authorization', 409);
  const copy = path.join(dir, 'source.' + base.format); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  await runner.blender('execute_code', { code: `import sys, json\nsys.path.insert(0, ${JSON.stringify(runtime)})\nimport preservation\npreservation.prepare(${JSON.stringify(copy)}, ${JSON.stringify(dir)}, json.loads(${JSON.stringify(JSON.stringify(base.scope))}))` }, { port: Number(runner.env.GEN3D_BLENDER_PORT || 9877) });
  if (fileHash(source) !== base.sha256) throw new Error('Library base source hash changed during preparation');
  const relative = file => path.relative(store.dir(p.id), path.join(dir, file)).split(path.sep).join('/');
  return { ...base, blend: relative('base.blend'), baseline: relative('baseline.json'), validation: relative('base-validation.json'), source: relative('source.' + base.format), glb: relative('base.glb') };
}
export async function validateBaseEdit(store, runner, p, v, dir) {
  if (!v.editableBase) return;
  const base = v.editableBase;
  const a = store.library.get(base.assetId);
  if (store.library.verify(a).sha256 !== base.sha256) throw new Error('Library base changed during modeling');
  const report = path.join(dir, 'preservation.json');
  await runner.blender('execute_code', { code: `import sys, json\nsys.path.insert(0, ${JSON.stringify(runtime)})\nimport preservation\npreservation.validate(${JSON.stringify(store.artifact(p.id, base.baseline))}, json.loads(${JSON.stringify(JSON.stringify(base.scope))}), ${JSON.stringify(path.join(dir, 'scene.blend'))}, ${JSON.stringify(path.join(dir, 'model.glb'))}, ${JSON.stringify(report)})` }, { port: Number(runner.env.GEN3D_BLENDER_PORT || 9877) });
  const evidence = JSON.parse(fs.readFileSync(report, 'utf8'));
  if (evidence.passed !== true || evidence.roundtrip?.passed !== true) throw new Error('Missing complete scene/GLB preservation evidence');
  v.preservation = evidence;
  v.artifacts.preservation = path.relative(store.dir(p.id), report).split(path.sep).join('/');
}
