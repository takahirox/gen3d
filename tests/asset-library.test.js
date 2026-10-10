import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '../src/store.js';
import { validateModel } from '../src/asset-library.js';
import { Runner, taskPrompt, exportCode } from '../src/runner.js';
import { categories } from '../src/refinement.js';
import { createApp } from '../src/server.js';

const fixture = 'docs/validation/issue10/prop/model-1';
const glb = fs.readFileSync(fixture + '/model.glb'), blend = fs.readFileSync(fixture + '/scene.blend');
const png = fs.readFileSync(fixture + '/preview.png');
const image = 'data:image/png;base64,' + png.toString('base64');
const settings = { input: false, concept: false, multiView: false, preview: false };
const input = { name: 'Models', mode: 'image', image, checkpoints: settings };
// These tests simulate Blender inspection; scripts/library-blender-check.js uses real Blender.
const inspect = async () => ({ meshes: 19, vertices: 5702, objects: [{ name: 'test mesh', type: 'MESH' }] });
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen3d-library-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const model = (asset, permission = 'reference-only', role = '') => ({ assetId: asset.id, permission, role });
async function imports(store) { return Promise.all([store.library.import({ name: 'style.glb', data: glb.toString('base64') }), store.library.import({ name: 'parts.blend', data: blend.toString('base64') })]); }
function artifacts(dir) { for (const file of ['model.glb', 'scene.blend', 'preview.png', 'mcp-audit.jsonl']) fs.copyFileSync(path.join(fixture, file), path.join(dir, file)); }

test('managed models imported once are shared across projects, persisted and selectable as 0/1/multiple', async t => {
  const dir = temporary(t), store = new Store(dir, { inspect });
  const [a, b] = await imports(store);
  const p = store.create(input, 'web'), q = store.create({ ...input, name: 'Other', mode: 'text', prompt: 'A stylized character' }, 'web');
  await store.selectModels(p.id, { models: [model(a), model(b, 'reuse-edit', 'Hair and face')] }, 'web');
  await store.selectModels(q.id, { models: [model(a)] }, 'mcp');
  assert.equal(p.modelReferences.length, 2); assert.equal(q.modelReferences[0].review, 'pending');
  const restarted = new Store(dir, { inspect });
  assert.deepEqual(restarted.get(p.id).modelReferences, p.modelReferences);
  assert.equal(restarted.library.list().total, 2);
  assert.ok(!fs.existsSync(path.join(store.dir(p.id), 'model.glb')));
  assert.ok(!fs.existsSync(path.join(store.dir(q.id), 'style.glb')));
  await restarted.selectModels(q.id, { models: [] }, 'web');
  assert.deepEqual(restarted.get(q.id).modelReferences, []);
  assert.equal(restarted.library.list().total, 2);
});

test('folder sources are explicitly human-configured, recursively scanned, paginated and never copied/modified', async t => {
  const store = new Store(temporary(t), { inspect }), folder = temporary(t);
  fs.mkdirSync(path.join(folder, 'nested'));
  for (let i = 0; i < 95; i++) fs.writeFileSync(path.join(folder, 'nested', `model-${i}.glb`), glb);
  fs.writeFileSync(path.join(folder, 'bad.blend'), 'corrupt');
  fs.writeFileSync(path.join(folder, 'ignored.fbx'), 'ignored');
  fs.symlinkSync(path.join(folder, 'nested/model-0.glb'), path.join(folder, 'symlink.glb'));
  assert.throws(() => store.library.addSource({ directory: folder }, 'mcp'), /web UI/);
  assert.throws(() => store.library.addSource({ directory: '../outside' }, 'web'), /absolute/);
  const source = store.library.addSource({ directory: folder }, 'web');
  assert.equal(store.library.list().total, 96);
  assert.equal(store.library.list().assets.length, 40);
  assert.equal(store.library.list({ offset: 80 }).assets.length, 16);
  assert.equal(store.library.list({ search: 'MODEL-94' }).total, 1);
  assert.equal(store.library.list({ sourceId: 'managed' }).total, 0);
  assert.ok(store.library.list().assets.find(a => a.name === 'bad.blend').error);
  assert.throws(() => store.library.list({ offset: -1 }), /query/);
  assert.throws(() => store.library.list({ limit: 101 }), /query/);
  const a = store.library.list({ search: 'model-94' }).assets[0];
  await store.library.inspected(a.id);
  assert.equal(store.library.get(a.id).sourceId, source.id);
  assert.equal(fs.existsSync(path.join(store.library.root, a.id, 'model.glb')), false);
  assert.deepEqual(fs.readFileSync(path.join(folder, a.file)), glb);
  fs.unlinkSync(path.join(folder, a.file));
  assert.match(store.library.list({ search: 'model-94' }).assets[0].error, /unavailable/);
  assert.throws(() => store.library.verify(store.library.get(a.id)), /unavailable/);
  fs.renameSync(folder, folder + '-moved'); t.after(() => fs.rmSync(folder + '-moved', { recursive: true, force: true }));
  assert.match(store.library.scan(source.id).sources[0].error, /unavailable/);
});

test('unsupported, corrupt, external-resource and unsafe filename/path content fails clearly', async t => {
  const store = new Store(temporary(t), { inspect });
  for (const name of ['../model.glb', 'path/model.glb', 'path\\model.blend', 'a\0.glb', 'file.fbx', 'file.gltf']) await assert.rejects(store.library.import({ name, data: glb.toString('base64') }));
  for (const bytes of [glb.subarray(0, -1), Buffer.from('invalid glb')]) assert.throws(() => validateModel(bytes, 'bad.glb'), /Invalid/);
  assert.throws(() => validateModel(Buffer.from('BLENDERinvalid'), 'bad.blend'), /header/);
  const json = JSON.stringify({ asset: { version: '2.0' }, meshes: [{}], buffers: [{ uri: '../../secret.bin', byteLength: 4 }] });
  const chunk = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const external = Buffer.alloc(20 + chunk.length); external.write('glTF'); external.writeUInt32LE(2, 4); external.writeUInt32LE(external.length, 8); external.writeUInt32LE(chunk.length, 12); external.writeUInt32LE(0x4e4f534a, 16); chunk.copy(external, 20);
  assert.throws(() => validateModel(external, 'external.glb'), /external resources/);
  const a = (await imports(store))[0], original = a.file;
  a.file = '../../outside.glb'; assert.throws(() => store.library.resolve(a), /unsafe/); a.file = original;
  fs.unlinkSync(store.library.resolve(a)); fs.symlinkSync(path.resolve(fixture, 'model.glb'), path.join(store.library.root, a.file));
  assert.throws(() => store.library.resolve(a), /unsafe/);
});

test('failed inspection leaves no managed entry; changed folder files require fresh inspection and human approval', async t => {
  const store = new Store(temporary(t), { inspect: async () => { throw new Error('corrupt meshes'); } });
  await assert.rejects(store.library.import({ name: 'bad.blend', data: blend.toString('base64') }), /corrupt meshes/);
  assert.equal(store.library.list().total, 0);
  assert.deepEqual(fs.readdirSync(store.library.root), []);
  store.library.inspect = inspect;
  const folder = temporary(t); fs.writeFileSync(path.join(folder, 'model.glb'), glb);
  store.library.addSource({ directory: folder }, 'web');
  const a = store.library.list().assets[0], p = store.create(input, 'web');
  await store.selectModels(p.id, { models: [model(a)] }, 'web'); store.reviewModelReference(p.id, a.id, 'approved', 'web');
  const snapshot = store.library.snapshot(p.modelReferences);
  const changed = Buffer.from(glb); const position = changed.indexOf(Buffer.from('Teal')); assert.ok(position > 0); changed[position] = 83;
  fs.writeFileSync(path.join(folder, 'model.glb'), changed);
  assert.throws(() => store.library.snapshot(p.modelReferences), /content changed/);
  assert.throws(() => store.library.jobFiles(snapshot), /source changed/);
  await store.selectModels(p.id, { models: [model(a)] }, 'web'); assert.equal(p.modelReferences[0].review, 'pending');
});

test('MCP cannot approve references; role and permission edits invalidate approval, and running projects cannot change', async t => {
  const store = new Store(temporary(t), { inspect }), [a] = await imports(store), p = store.create(input, 'web');
  await store.selectModels(p.id, { models: [model(a)] }, 'mcp');
  assert.throws(() => store.reviewModelReference(p.id, a.id, 'approved', 'mcp'), /web UI/);
  store.reviewModelReference(p.id, a.id, 'approved', 'web');
  await store.selectModels(p.id, { models: [model(a)] }, 'mcp'); assert.equal(p.modelReferences[0].review, 'approved');
  await store.selectModels(p.id, { models: [model(a, 'reuse-edit', 'face')] }, 'mcp'); assert.equal(p.modelReferences[0].review, 'pending');
  assert.equal(store.library.snapshot(p.modelReferences).length, 0);
  assert.throws(() => new Runner(store).start(p.id, {}, 'mcp'), /pending 3D/);
  await assert.rejects(store.selectModels(p.id, { models: [model(a), model(a)] }, 'web'), /unique/);
  await assert.rejects(store.selectModels(p.id, { models: [model(a, 'invalid')] }, 'web'), /permission/);
  await assert.rejects(store.selectModels(p.id, { models: Array(33).fill(model(a)) }, 'web'), /32/);
  p.versions.push({ status: 'running' }); await assert.rejects(store.selectModels(p.id, { models: [] }, 'web'), /finish/);
});

test('text and image job snapshots keep all selected provenance through retry/revision/refinement without changing visual input', async t => {
  const store = new Store(temporary(t), { inspect }), [a, b] = await imports(store);
  for (const mode of ['image', 'text']) {
    const p = store.create({ ...input, mode, prompt: 'A stylized anime figure' }, 'web');
    await store.selectModels(p.id, { models: [model(a, 'reference-only', 'face style'), model(b, 'reuse-edit', 'hair')] }, 'mcp');
    for (const r of p.modelReferences) store.reviewModelReference(p.id, r.assetId, 'approved', 'web');
    const runner = new Runner(store, { conceptGenerator: { generate: async () => ({ bytes: png, ext: 'png' }), generateViews: async ({ onImage }) => { for (const view of ['front', 'side', 'back', 'three-quarter']) await onImage({ view, side: view === 'side' ? 'left' : undefined, bytes: png, ext: 'png' }); } }, inspectReferences: async () => ({ consistent: true, issues: [] }), generate: async (p, v, dir) => { assert.equal(v.modelReferences.length, 2); artifacts(dir); } });
    runner.start(p.id, {}, 'web'); await runner.pending;
    assert.equal(p.versions[0].status, 'ready');
    const first = p.versions[0];
    assert.equal(first.imageInputs.length, mode === 'text' ? 5 : 1);
    runner.start(p.id, { kind: 'retry' }, 'web'); await runner.pending;
    runner.start(p.id, { kind: 'revision', sourceVersionId: first.id, feedback: 'Adjust face' }, 'web'); await runner.pending;
    for (const v of p.versions) { assert.deepEqual(v.modelReferences, first.modelReferences); assert.equal(v.visualInput, first.visualInput); }
    const prompt = taskPrompt(p, first); assert.match(prompt, /inspect_reference_model for EVERY/); assert.match(prompt, /reuse_reference_mesh/); assert.match(prompt, /reference-only/);
    const exporter = exportCode('/fixture', first); assert.ok(exporter.indexOf('refs.remove_references()') < exporter.indexOf('meshes =')); assert.match(exporter, /Unapproved reference reuse/);
    await store.selectModels(p.id, { models: [] }, 'web'); assert.equal(first.modelReferences.length, 2);
    runner.start(p.id, { kind: 'revision', sourceVersionId: first.id, feedback: 'Keep original reference lineage' }, 'web'); await runner.pending;
    assert.deepEqual(p.versions.at(-1).modelReferences, first.modelReferences);
    assert.equal(p.activity.find(e => e.type === 'generation_started').modelReferences.length, 2);
  }
});

test('bounded refinement with multiple models retains original per-asset permissions and required images in every cycle', async t => {
  const store = new Store(temporary(t), { inspect }), [a, b] = await imports(store);
  for (const mode of ['text', 'image']) {
    const p = store.create({ ...input, mode, prompt: 'Stylized cabinet', profile: 'object', refinementSettings: { enabled: true, maxIterations: 1 } }, 'web');
    await store.selectModels(p.id, { models: [model(a), model(b, 'reuse-edit', 'knobs')] }, 'web');
    for (const r of p.modelReferences) store.reviewModelReference(p.id, r.assetId, 'approved', 'web');
    const snapshots = store.library.snapshot(p.modelReferences), jobs = [];
    const runner = new Runner(store, { conceptGenerator: { generate: async () => ({ bytes: png, ext: 'png' }), generateViews: async ({ onImage }) => { for (const view of ['front', 'side', 'back', 'three-quarter']) await onImage({ view, side: view === 'side' ? 'left' : undefined, bytes: png, ext: 'png' }); } },
      inspectReferences: async () => ({ consistent: true, issues: [] }),
      inspectModel: async ({ dir, renders }) => {
        const acceptable = path.basename(dir) === '1';
        return { acceptable, summary: 'Synthetic reference-aware refinement fixture', revisionTargets: acceptable ? [] : ['geometry'], revisionInstructions: acceptable ? [] : ['Adjust the body proportions'], views: renders.map(r => ({ view: r.view, observations: categories.map(category => ({ category, status: acceptable ? 'acceptable' : 'discrepancy', detail: 'Synthetic observation' })) })) };
      },
      generate: async (p, v, dir) => {
        assert.deepEqual(v.modelReferences, snapshots); jobs.push(structuredClone(v)); artifacts(dir);
        fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify({ sha256: (v.refinementCycle ? 'b' : 'a').repeat(64) }));
        for (const label of ['input', 'front', 'side', 'back', 'three-quarter']) fs.writeFileSync(path.join(dir, label + '.png'), png);
      }
    });
    runner.start(p.id, {}, 'web'); await runner.pending;
    const v = p.versions[0]; assert.equal(v.status, 'ready'); assert.equal(v.refinement.status, 'passed'); assert.equal(jobs.length, 2);
    assert.deepEqual(jobs[0].imageInputs, jobs[1].imageInputs);
    assert.equal(jobs[0].imageInputs.length, mode === 'text' ? 5 : 1);
    assert.equal(v.refinement.iterations.length, 2);
  }
});

test('real modeling path loads every approved reference before Codex and records Blender load evidence', async t => {
  const store = new Store(temporary(t), { inspect }), [a, b] = await imports(store), p = store.create(input, 'web');
  await store.selectModels(p.id, { models: [model(a), model(b, 'reuse-edit')] }, 'web');
  for (const r of p.modelReferences) store.reviewModelReference(p.id, r.assetId, 'approved', 'web');
  const calls = []; let inspectAll = true;
  const runner = new Runner(store, { processRunner: async (command, args) => { if (args[0] === 'login') return 'Logged in using ChatGPT'; calls.push('codex'); fs.writeFileSync(path.join(dir, 'mcp-audit.jsonl'), (inspectAll ? [a, b] : [a]).map(a => JSON.stringify({ tool: 'inspect_reference_model', assetId: a.id })).join('\n')); assert.ok(calls.some(c => c.includes('load_references'))); }, blender: async (type, params) => { if (type === 'execute_code') { calls.push(params.code); return { output: 'import diagnostics\nGEN3D_REFERENCES=[]\n' }; } return {}; } });
  const v = { kind: 'generate', modelReferences: store.library.snapshot(p.modelReferences), visualInput: p.inputImage, imageInputs: [p.inputImage], modelingImages: [], referenceIds: [] }, dir = temporary(t);
  await runner.realGenerate(p, v, dir);
  const load = calls.find(c => c.includes('load_references'));
  assert.ok(load.includes(a.id) && load.includes(b.id)); assert.ok(load.includes('reference-only') && load.includes('reuse-edit'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'model-references.json'))).models.length, 2);
  assert.equal(calls.at(-1).includes('refs.remove_references()'), true);
  inspectAll = false; calls.length = 0;
  await assert.rejects(runner.realGenerate(p, v, dir), /did not inspect every selected/);
  assert.ok(!calls.some(c => c.includes('allowed_reuse')));
});

test('HTTP and real MCP clients see the same library and selections, but only Web UI grants folder access and approval', async t => {
  const app = createApp({ dataDir: temporary(t), inspectAsset: inspect, generate: async (p, v, dir) => artifacts(dir) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const client = new Client({ name: 'library-test', version: '1' });
  t.after(async () => { await client.close(); await app.runner.pending; await new Promise(resolve => app.server.close(resolve)); await app.closed; });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.js')], env: { ...process.env, GEN3D_URL: url }, stderr: 'pipe' }));
  const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, result.content[0].text); return JSON.parse(result.content[0].text); };
  const a = await call('import_library_model', { name: 'model.glb', data: glb.toString('base64') });
  assert.equal((await call('list_model_library', { search: 'model' })).assets[0].id, a.id);
  const p = await call('create_project', input);
  await call('select_model_references', { projectId: p.id, models: [model(a, 'reuse-edit', 'hair')] });
  const shared = await (await fetch(url + `/api/projects/${p.id}`)).json(); assert.equal(shared.modelReferences[0].permission, 'reuse-edit'); assert.equal(shared.modelReferences[0].review, 'pending');
  const post = async (route, data, mcp = true) => fetch(url + '/api' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(mcp ? { 'X-Gen3d-Client': 'mcp' } : {}) }, body: JSON.stringify(data) });
  assert.equal((await post('/library/sources', { directory: temporary(t) })).status, 403);
  assert.equal((await post(`/projects/${p.id}/model-references/${a.id}/review`, { decision: 'approved' })).status, 403);
  assert.equal((await post(`/projects/${p.id}/model-references/${a.id}/review`, { decision: 'approved' }, false)).status, 200);
  assert.equal((await call('get_project', { projectId: p.id })).modelReferences[0].review, 'approved');
  assert.equal((await client.readResource({ uri: 'gen3d://library' })).contents.length, 1);
});
