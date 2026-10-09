import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import http from 'node:http';
import { zstdCompressSync, gzipSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import { CodexReferenceInspector, requiredViews } from '../src/reference-set.js';
import { CodexConceptGenerator } from '../src/concept.js';
import { Runner, subscriptionEnv, codexArgs, validateArtifacts, runProcess } from '../src/runner.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
const image = 'data:image/png;base64,' + png.toString('base64');
const generateViews = async ({ onImage }) => { for (const view of requiredViews) await onImage({ view, side: view === 'side' ? 'left' : undefined, bytes: png, ext: 'png' }); };
const inspectReferences = async () => ({ consistent: true, issues: [] });
const conceptGenerator = { generate: async () => ({ bytes: png, ext: 'png' }), generateViews };
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen3d-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
// Synthetic artifacts are ONLY a unit-test fixture; production uses Codex/Blender.
function artifacts(dir) {
  const scene = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] }).padEnd(128, ' '));
  const glb = Buffer.alloc(20 + scene.length); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(scene.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); scene.copy(glb, 20);
  fs.writeFileSync(path.join(dir, 'model.glb'), glb);
  fs.writeFileSync(path.join(dir, 'scene.blend'), 'BLENDER-test-fixture');
  fs.writeFileSync(path.join(dir, 'preview.png'), png);
  fs.writeFileSync(path.join(dir, 'mcp-audit.jsonl'), '{"tool":"execute_blender_code"}\n');
}
async function app(t, generate = async (p, v, dir) => artifacts(dir)) {
  const dataDir = temporary(t);
  const instance = createApp({ dataDir, generate, conceptGenerator, inspectReferences });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  t.after(async () => { await instance.runner.pending; await new Promise(resolve => instance.server.close(resolve)); await instance.closed; });
  const url = `http://127.0.0.1:${instance.server.address().port}`;
  async function request(route, method = 'GET', data, headers = {}) {
    const res = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, data: await res.json() };
  }
  return { ...instance, url, request, dataDir };
}
const input = { name: 'Robot', mode: 'text', prompt: 'A teal robot', checkpoints: { input: false, concept: false, multiView: false, preview: false } };

test('text and image inputs persist and invalid images leave no project', t => {
  const dir = temporary(t), store = new Store(dir);
  const a = store.create(input, 'web'), b = store.create({ name: 'Image', mode: 'image', image }, 'mcp');
  assert.equal(b.mode, 'image'); assert.deepEqual(fs.readFileSync(store.artifact(b.id, b.inputImage)), png);
  assert.throws(() => store.create({ name: 'bad', mode: 'image', image: 'data:image/png;base64,YmFk' }, 'web'), /Invalid/);
  assert.equal(store.list().length, 2);
  const reloaded = new Store(dir); assert.equal(reloaded.get(a.id).prompt, input.prompt); assert.equal(reloaded.get(b.id).activity[0].actor, 'mcp');
});

test('pending concepts gate generation and only human-reviewed references enter snapshots', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  store.addReference(p.id, { label: 'AI concept', image }, 'mcp');
  const runner = new Runner(store, { inspectReferences, conceptGenerator, generate: async (p, v, dir) => artifacts(dir) });
  assert.throws(() => runner.start(p.id, {}, 'web'), /Review all pending/);
  assert.throws(() => store.reviewReference(p.id, p.references[0].id, 'approved', 'mcp'), /web UI/);
  store.reviewReference(p.id, p.references[0].id, 'approved', 'web');
  store.addReference(p.id, { label: 'Unused concept', image }, 'mcp');
  store.reviewReference(p.id, p.references[1].id, 'rejected', 'web');
  runner.start(p.id, {}, 'web'); await runner.pending;
  assert.equal(p.versions[0].status, 'ready'); assert.deepEqual(p.versions[0].referenceIds, [p.references[0].id]);
});

test('revision copies source scene, preserves artifacts, snapshots prompt and branches from any ready version', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  const runner = new Runner(store, { inspectReferences, conceptGenerator, generate: async (p, v, dir) => { if (v.kind === 'revision') assert.equal(fs.readFileSync(path.join(dir, 'source.blend'), 'utf8'), 'BLENDER-test-fixture'); artifacts(dir); } });
  runner.start(p.id, {}, 'web'); await runner.pending;
  const first = p.versions[0], old = fs.readFileSync(store.artifact(p.id, first.artifacts.glb));
  store.reviewVersion(p.id, first.id, 'approved', 'web');
  store.update(p.id, { prompt: 'A larger robot' }, 'mcp');
  runner.start(p.id, { kind: 'revision', sourceVersionId: first.id, feedback: 'Longer arms' }, 'web'); await runner.pending;
  runner.start(p.id, { kind: 'revision', sourceVersionId: first.id, feedback: 'Orange eyes' }, 'mcp'); await runner.pending;
  assert.equal(p.versions.length, 3); assert.equal(first.prompt, input.prompt); assert.equal(first.review, 'approved');
  assert.equal(p.versions[1].feedback, 'Longer arms'); assert.equal(p.versions[2].sourceVersionId, first.id);
  assert.deepEqual(fs.readFileSync(store.artifact(p.id, first.artifacts.glb)), old);
  assert.equal(new Store(store.root).get(p.id).versions.length, 3);
});

test('Blender is serialized globally and edits cannot race a job', async t => {
  let release; const barrier = new Promise(resolve => { release = resolve; });
  const store = new Store(temporary(t)), p = store.create(input, 'web'), p2 = store.create(input, 'web');
  const runner = new Runner(store, { inspectReferences, conceptGenerator, generate: async (p, v, dir) => { await barrier; artifacts(dir); } });
  runner.start(p.id, {}, 'web');
  assert.throws(() => runner.start(p2.id, {}, 'mcp'), /another version/);
  assert.throws(() => store.update(p.id, { prompt: 'changed' }, 'mcp'), /Wait/);
  assert.throws(() => store.addReference(p.id, { label: 'late', image }, 'web'), /Wait/);
  release(); await runner.pending; assert.equal(runner.active, false);
});

test('failures retain useful history, retry gets a new folder and usage limits stop subsequent jobs', async t => {
  let calls = 0;
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  const runner = new Runner(store, { inspectReferences, conceptGenerator, generate: async (p, v, dir) => { if (++calls === 1) throw new Error('Blender disconnected'); artifacts(dir); } });
  runner.start(p.id, {}, 'web'); await runner.pending;
  assert.equal(p.versions[0].status, 'failed');
  runner.start(p.id, { kind: 'retry' }, 'web'); await runner.pending;
  assert.equal(p.versions[1].status, 'ready'); assert.notEqual(p.versions[0].id, p.versions[1].id);
  runner.generate = async () => { const e = new Error('Codex usage limit reached'); e.usageLimited = true; throw e; };
  runner.start(p.id, {}, 'web'); await runner.pending;
  assert.throws(() => runner.start(p.id, {}, 'web'), /usage limit/); assert.equal(p.versions.length, 3);
});

test('interrupted jobs recover as failed, and a second server cannot alter active state', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  p.versions.push({ id: 'interrupted', status: 'running' }); store.save(p);
  const recovered = new Store(store.root).get(p.id); assert.equal(recovered.versions[0].status, 'failed'); assert.equal(recovered.activity.at(-1).type, 'generation_interrupted');
  const a = await app(t); const project = a.store.create(input, 'web'); project.versions.push({ id: 'active', status: 'running' }); a.store.save(project);
  assert.throws(() => createApp({ dataDir: a.dataDir }), /already has/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.dataDir, project.id, 'project.json'))).versions[0].status, 'running');
});

test('shutdown retains store ownership through generation and final persistence', async t => {
  let release; const barrier = new Promise(resolve => { release = resolve; });
  const a = await app(t, async (p, v, dir) => { await barrier; artifacts(dir); });
  const p = a.store.create(input, 'web');
  a.runner.start(p.id, {}, 'web');
  const lockFile = path.join(a.dataDir, 'server.lock');
  const projectFile = path.join(a.dataDir, p.id, 'project.json');
  const save = a.store.save.bind(a.store);
  let persisted = false;
  a.store.save = project => {
    assert.equal(fs.existsSync(lockFile), true);
    assert.throws(() => createApp({ dataDir: a.dataDir }), /already has/);
    save(project);
    persisted = true;
  };
  try {
    await new Promise(resolve => a.server.close(resolve));
    assert.equal(a.runner.active, true);
    assert.equal(fs.existsSync(lockFile), true);
    assert.throws(() => createApp({ dataDir: a.dataDir }), /already has/);
    assert.equal(JSON.parse(fs.readFileSync(projectFile)).versions[0].status, 'running');
  } catch (e) {
    a.store.save = save;
    throw e;
  } finally { release(); }
  await a.closed;
  assert.equal(persisted, true);
  assert.equal(a.runner.active, false);
  assert.equal(fs.existsSync(lockFile), false);
  assert.equal(JSON.parse(fs.readFileSync(projectFile)).versions[0].status, 'ready');
  const restarted = createApp({ dataDir: a.dataDir });
  restarted.server.listen(0, '127.0.0.1'); await once(restarted.server, 'listening');
  t.after(async () => { restarted.server.close(); await restarted.closed; });
  assert.equal(restarted.store.get(p.id).versions[0].status, 'ready');
  restarted.store.update(p.id, { name: 'Edited after shutdown' }, 'web');
  assert.equal(JSON.parse(fs.readFileSync(projectFile)).name, 'Edited after shutdown');
});

test('API validates inputs, rejects cross-origin calls and restricts artifacts to the manifest', async t => {
  const a = await app(t);
  assert.equal((await a.request('/api/projects', 'POST', input, { Origin: 'https://untrusted.example' })).status, 403);
  // fetch controls Host itself; use a raw HTTP client to exercise rebinding checks.
  const badHost = await new Promise((resolve, reject) => {
    const request = http.request(a.url + '/api/projects', { method: 'POST', headers: { Host: 'untrusted.example', 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end(JSON.stringify(input));
  });
  assert.equal(badHost, 403);
  assert.equal((await a.request('/api/projects', 'POST', null)).status, 400);
  assert.equal((await a.request('/api/projects', 'POST', { ...input, mode: 'invalid' })).status, 400);
  const p = (await a.request('/api/projects', 'POST', input)).data;
  assert.equal((await a.request(`/api/projects/${p.id}/generate`, 'POST', { kind: 'revision', feedback: 'change' })).status, 400);
  assert.equal((await a.request(`/api/projects/${p.id}/artifacts/project.json`)).status, 404);
  assert.equal((await a.request(`/api/projects/${p.id}/artifacts/%2e%2e%2fserver.lock`)).status, 404);
  await a.request(`/api/projects/${p.id}/generate`, 'POST', {}); await a.runner.pending;
  const v = a.store.get(p.id).versions[0];
  const response = await fetch(a.url + `/api/projects/${p.id}/artifacts/${v.artifacts.glb}?download=1`);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /model.glb/); assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString(), 'glTF');
  const original = a.store.artifact(p.id, v.artifacts.glb), external = path.join(a.dataDir, 'external-test-file');
  fs.writeFileSync(external, 'outside the project'); fs.unlinkSync(original); fs.symlinkSync(external, original);
  assert.equal((await a.request(`/api/projects/${p.id}/artifacts/${v.artifacts.glb}`)).status, 400);
});

test('real MCP stdio client and HTTP UI share project updates, review history, resources and export', async t => {
  const a = await app(t), client = new Client({ name: 'gen3d-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.js')], env: { ...process.env, GEN3D_URL: a.url }, stderr: 'pipe' });
  await client.connect(transport); t.after(() => client.close());
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, result.content[0].text); return JSON.parse(result.content[0].text);
  };
  const p = await call('create_project', input);
  await call('update_project', { projectId: p.id, name: 'Changed through MCP' });
  assert.equal((await a.request(`/api/projects/${p.id}`)).data.name, 'Changed through MCP');
  await a.request(`/api/projects/${p.id}`, 'PATCH', { prompt: 'Changed through web' });
  assert.equal((await call('get_project', { projectId: p.id })).prompt, 'Changed through web');
  assert.equal((await call('list_projects')).length, 1);
  await call('generate_model', { projectId: p.id }); await a.runner.pending;
  const v = a.store.get(p.id).versions[0];
  await call('review_model', { projectId: p.id, versionId: v.id, decision: 'approved' });
  const current = (await a.request(`/api/projects/${p.id}`)).data;
  assert.equal(current.versions[0].review, 'approved'); assert.equal(current.activity.at(-1).actor, 'mcp');
  const refs = await client.readResource({ uri: `gen3d://projects/${p.id}` }); assert.equal(JSON.parse(refs.contents[0].text).name, current.name);
  const download = await call('export_model', { projectId: p.id, versionId: v.id }); assert.equal((await fetch(download.glb)).status, 200);
  await call('add_reference', { projectId: p.id, label: 'AI supplied', image });
  const blocked = await client.callTool({ name: 'generate_model', arguments: { projectId: p.id } }); assert.equal(blocked.isError, true);
});

test('CLI invocation uses image attachments, ChatGPT auth, workspace sandbox and no API keys', () => {
  const env = subscriptionEnv({ OPENAI_API_KEY: 'test', CODEX_API_KEY: 'test', PATH: '/bin' }); assert.deepEqual(env, { PATH: '/bin' });
  const args = codexArgs('/job', ['/input.png', '/ref.jpg']);
  assert.ok(args.includes('workspace-write')); assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('forced_login_method="chatgpt"'));
  assert.equal(args.filter(a => a === '--image').length, 2); assert.ok(!args.includes('--model')); assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(args.includes('mcp_servers.gen3d_blender.tools.execute_blender_code.approval_mode="approve"'));
  assert.equal(args.at(-2), '--');
});

test('Codex usage errors terminate the child and block completion', async () => {
  const code = `console.log(JSON.stringify({type:'turn.failed',error:{message:'Usage limit reached'}})); setTimeout(() => process.exit(0),10000);`;
  await assert.rejects(runProcess(process.execPath, ['-e', code], { timeout: 1000 }), e => e.usageLimited === true && /usage limit/.test(e.message));
  await assert.rejects(runProcess(process.execPath, ['-e', "console.error('insufficient_quota'); process.exit(1);"]), e => e.usageLimited === true);
  await assert.rejects(runProcess(process.execPath, ['-e', "console.log(JSON.stringify({type:'error',message:'Usage limit reached'})); process.exit(0);"]), e => e.usageLimited === true);
  await assert.rejects(runProcess(process.execPath, ['-e', "process.stdout.write(JSON.stringify({type:'turn.failed',error:{message:'Usage limit reached'}})); process.exit(0);"]), e => e.usageLimited === true);
  await assert.rejects(runProcess(process.execPath, ['-e', "console.error('ERROR: usage limit reached'); setTimeout(() => process.exit(0),10000);"], { timeout: 1000 }), e => e.usageLimited === true);
});

test('missing, malformed or empty geometry artifacts cannot be published as ready', t => {
  const dir = temporary(t); artifacts(dir); assert.deepEqual(validateArtifacts(dir), { meshes: 1 });
  const blend = fs.readFileSync(path.join(dir, 'scene.blend'));
  for (const compress of [zstdCompressSync, gzipSync]) { fs.writeFileSync(path.join(dir, 'scene.blend'), compress(blend)); assert.deepEqual(validateArtifacts(dir), { meshes: 1 }); }
  fs.writeFileSync(path.join(dir, 'model.glb'), 'not an actual model'); assert.throws(() => validateArtifacts(dir), /valid GLB/);
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  const runner = new Runner(store, { inspectReferences, conceptGenerator, generate: async (p, v, dir) => { artifacts(dir); fs.writeFileSync(path.join(dir, 'mcp-audit.jsonl'), '{"tool":"get_scene_info"}\n'); } });
  runner.start(p.id, {}, 'web'); return runner.pending.then(() => { assert.equal(p.versions[0].status, 'failed'); assert.match(p.versions[0].error, /No successful/); });
});

test('text workflow generates a concept first, waits for explicit acceptance, and models the selected image', async t => {
  const store = new Store(temporary(t)), p = store.create({ ...input, checkpoints: { input: true, concept: true, multiView: false, preview: true } }, 'web');
  const calls = [];
  const runner = new Runner(store, { inspectReferences, conceptGenerator: { generateViews, generate: async task => { calls.push('concept'); assert.equal(task.prompt, p.prompt); return { bytes: png, ext: 'png' }; } }, generate: async (project, v, dir) => {
    calls.push('model'); assert.equal(v.conceptId, project.selectedConceptId);
    assert.deepEqual(fs.readFileSync(store.artifact(p.id, v.visualInput)), png); artifacts(dir);
  } });
  assert.throws(() => runner.start(p.id, {}, 'web'), /Review the input/);
  store.update(p.id, { checkpoints: { input: false } }, 'web');
  assert.throws(() => runner.start(p.id, {}, 'mcp'), /Review the input/);
  store.reviewInput(p.id, 'approved', 'web');
  runner.start(p.id, {}, 'mcp'); await runner.pending;
  const c = p.concepts[0];
  assert.equal(c.status, 'ready'); assert.equal(c.review, 'pending'); assert.equal(p.versions.length, 0);
  assert.deepEqual(calls, ['concept']);
  assert.throws(() => runner.start(p.id, { kind: 'retry' }, 'mcp'), /Review the concept/);
  assert.throws(() => runner.reviewConcept(p.id, c.id, 'approved', 'mcp'), /web UI/);
  store.update(p.id, { checkpoints: { concept: false } }, 'web');
  assert.throws(() => runner.start(p.id, {}, 'web'), /Review the concept/);
  runner.reviewConcept(p.id, c.id, 'approved', 'web'); await runner.pending;
  assert.deepEqual(calls, ['concept', 'model']); assert.equal(p.versions[0].review, 'pending');
  assert.throws(() => runner.start(p.id, { kind: 'retry' }, 'mcp'), /Review the 3D preview/);
  assert.throws(() => store.reviewVersion(p.id, p.versions[0].id, 'approved', 'mcp'), /web UI/);
  assert.throws(() => store.canExport(p.id, p.versions[0].id), /Approve/);
  store.update(p.id, { checkpoints: { preview: false } }, 'web');
  assert.throws(() => runner.start(p.id, {}, 'web'), /Review the 3D preview/);
  store.reviewVersion(p.id, p.versions[0].id, 'approved', 'web');
  assert.ok(store.canExport(p.id, p.versions[0].id).artifacts.glb);
  const reloaded = new Store(store.root).get(p.id);
  assert.equal(reloaded.selectedConceptId, c.id); assert.equal(reloaded.versions[0].conceptId, c.id);
  assert.ok(reloaded.activity.some(e => e.type === 'concept_reviewed' && e.decision === 'approved'));
});

test('rejection and regeneration preserve concepts and never model a rejected design', async t => {
  const store = new Store(temporary(t)), p = store.create({ ...input, checkpoints: { concept: true, multiView: false, preview: false } }, 'web');
  let modeled = 0;
  const runner = new Runner(store, { inspectReferences, conceptGenerator, generate: async (p, v, dir) => { modeled++; artifacts(dir); } });
  runner.start(p.id, {}, 'web'); await runner.pending;
  const first = p.concepts[0], old = fs.readFileSync(store.artifact(p.id, first.artifacts.image));
  assert.throws(() => runner.regenerateConcept(p.id, {}, 'mcp'), /Reject pending/);
  runner.regenerateConcept(p.id, { feedback: 'Make it orange' }, 'web'); await runner.pending;
  assert.equal(first.review, 'rejected'); assert.equal(modeled, 0); assert.equal(p.concepts[1].feedback, 'Make it orange');
  assert.deepEqual(fs.readFileSync(store.artifact(p.id, first.artifacts.image)), old);
  runner.reviewConcept(p.id, p.concepts[1].id, 'rejected', 'web');
  assert.throws(() => runner.start(p.id, {}, 'web'), /Regenerate/);
  runner.regenerateConcept(p.id, {}, 'web'); await runner.pending;
  runner.reviewConcept(p.id, p.concepts[2].id, 'approved', 'web'); await runner.pending;
  assert.equal(modeled, 1); assert.equal(p.versions[0].conceptId, p.concepts[2].id);
});

test('profile changes scope pending and rejected concepts to the current design without rewriting history', async t => {
  for (const regenerate of [false, true]) {
    const store = new Store(temporary(t)), p = store.create({ ...input, profile: 'character', checkpoints: { ...input.checkpoints, concept: true } }, 'web');
    const runner = new Runner(store, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
    runner.start(p.id, {}, 'web'); await runner.pending;
    const old = structuredClone(p.concepts[0]);
    store.update(p.id, { profile: 'object' }, 'web');
    assert.throws(() => runner.reviewConcept(p.id, old.id, 'rejected', 'web'), /current input/);
    if (regenerate) runner.regenerateConcept(p.id, {}, 'mcp');
    else runner.start(p.id, {}, 'web');
    await runner.pending;
    const current = p.concepts[1];
    assert.deepEqual(p.concepts[0], old); assert.equal(current.profile, 'object'); assert.equal(current.review, 'pending');
    assert.throws(() => runner.start(p.id, {}, 'web'), /Review the concept/);
    assert.throws(() => runner.regenerateConcept(p.id, {}, 'mcp'), /Reject pending/);
    runner.reviewConcept(p.id, current.id, 'approved', 'web'); await runner.pending;
    assert.equal(p.versions[0].status, 'ready'); assert.equal(p.versions[0].conceptId, current.id);
    assert.equal(p.referenceSets[0].profile, 'object');
    assert.deepEqual(new Store(store.root).get(p.id).concepts[0], JSON.parse(JSON.stringify(old)));
    // A rejected design from the other profile must not force regeneration.
    store.update(p.id, { profile: 'character' }, 'web');
    runner.reviewConcept(p.id, old.id, 'rejected', 'web');
    const rejected = structuredClone(p.concepts[0]);
    store.update(p.id, { profile: 'object' }, 'web');
    runner.start(p.id, {}, 'web'); await runner.pending;
    assert.equal(p.concepts[2].profile, 'object'); assert.equal(p.concepts[2].review, 'pending');
    assert.deepEqual(p.concepts[0], rejected);
  }
});

test('legacy model revisions retain their own concept, review request and all images across project edits and restart', async t => {
  for (const multiView of [true, false]) {
    const dir = temporary(t), store = new Store(dir), p = store.create(input, 'web');
    const runner = new Runner(store, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
    runner.start(p.id, {}, 'web'); await runner.pending;
    const source = p.versions[0];
    const sourceBytes = fs.readFileSync(store.artifact(p.id, source.artifacts.blend));
    // Persist a pre-multi-view project: completed concept/model, no typed views.
    delete source.referenceSetId; delete source.modelingImages; delete source.imageInputs;
    delete p.concepts[0].profile; delete p.profile; delete p.referenceSets; delete p.selectedReferenceSetId;
    delete p.checkpoints.multiView; store.save(p);
    const legacy = structuredClone(source);
    const loaded = new Store(dir), current = loaded.get(p.id);
    const resumed = new Runner(loaded, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
    loaded.update(p.id, { prompt: 'A brass teapot', profile: 'object', checkpoints: { multiView: false } }, 'web');
    resumed.start(p.id, {}, 'web'); await resumed.pending;
    const selectedConceptId = current.selectedConceptId, selectedReferenceSetId = current.selectedReferenceSetId;
    loaded.update(p.id, { checkpoints: { multiView } }, 'web');
    const request = { kind: 'revision', sourceVersionId: source.id, feedback: 'Lengthen the original robot arms' };
    resumed.start(p.id, request, 'web'); await resumed.pending;
    const set = current.referenceSets.at(-1);
    assert.equal(set.prompt, input.prompt); assert.equal(set.profile, 'character'); assert.equal(set.conceptId, source.conceptId);
    assert.deepEqual(set.request, request); assert.equal(set.images.length, 4);
    assert.equal(current.selectedConceptId, selectedConceptId); assert.equal(current.selectedReferenceSetId, selectedReferenceSetId);
    if (multiView) {
      assert.equal(current.versions.length, 2); assert.equal(set.review, 'pending');
      assert.throws(() => resumed.start(p.id, request, 'web'), /reviewed, consistent/);
      assert.throws(() => resumed.reviewReferenceSet(p.id, set.id, 'approved', 'mcp'), /web UI/);
      loaded.update(p.id, { prompt: 'A silver teapot', checkpoints: { multiView: false } }, 'web');
      const reloaded = new Store(dir), restored = reloaded.get(p.id);
      const pending = restored.referenceSets.at(-1);
      const continued = new Runner(reloaded, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => {
        assert.deepEqual(fs.readFileSync(path.join(dir, 'source.blend')), sourceBytes); artifacts(dir);
      } });
      assert.equal(pending.review, 'pending'); assert.equal(pending.checkpoints.multiView, true);
      assert.throws(() => continued.start(p.id, request, 'web'), /reviewed, consistent/);
      const savedSource = pending.request.sourceVersionId;
      pending.request.sourceVersionId = 'missing-source';
      assert.throws(() => continued.reviewReferenceSet(p.id, pending.id, 'approved', 'web'), /selected concept or source revision/);
      pending.request.sourceVersionId = savedSource;
      const back = pending.images.pop();
      assert.throws(() => continued.reviewReferenceSet(p.id, pending.id, 'approved', 'web'), /complete reference set/);
      pending.images.push(back);
      continued.reviewReferenceSet(p.id, pending.id, 'rejected', 'web');
      assert.equal(restored.versions.length, 2); assert.equal(pending.review, 'rejected');
      continued.reviewReferenceSet(p.id, pending.id, 'approved', 'web'); await continued.pending;
      assert.equal(restored.versions.length, 3); assert.equal(restored.versions[2].status, 'ready');
      assert.equal(restored.selectedConceptId, null); assert.equal(restored.selectedReferenceSetId, null);
      assert.deepEqual(restored.versions[0], legacy);
      assert.ok(restored.activity.some(e => e.referenceSetId === set.id && e.decision === 'rejected'));
    } else {
      assert.equal(current.versions.length, 3); assert.equal(set.review, 'approved');
    }
    const saved = new Store(dir).get(p.id), revision = saved.versions[2], savedSet = saved.referenceSets.at(-1);
    assert.deepEqual(saved.versions[0], legacy); assert.equal(revision.sourceVersionId, source.id);
    assert.equal(revision.prompt, input.prompt); assert.equal(revision.feedback, request.feedback);
    assert.equal(revision.referenceSetId, set.id); assert.deepEqual(revision.modelingImages, savedSet.images);
    assert.deepEqual(revision.imageInputs, [saved.concepts[0].artifacts.image, ...savedSet.images.map(i => i.file)]);
    for (const file of revision.imageInputs) assert.deepEqual(fs.readFileSync(new Store(dir).artifact(p.id, file)), png);
  }
});

test('regenerating legacy revision views retains the source, modeling feedback and history across edits and restart', async t => {
  for (const edit of ['none', 'before revision', 'after views']) for (const outcome of ['pending', 'inconsistent', 'failed']) for (const multiView of [true, false]) {
    await t.test(`${edit}, ${outcome}, replacement review ${multiView}`, async t => {
      const dir = temporary(t), initialStore = new Store(dir), p = initialStore.create(input, 'web');
      const initialRunner = new Runner(initialStore, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
      initialRunner.start(p.id, {}, 'web'); await initialRunner.pending;
      const source = p.versions[0], conceptId = source.conceptId;
      const sourceBytes = fs.readFileSync(initialStore.artifact(p.id, source.artifacts.blend));
      delete source.referenceSetId; delete source.modelingImages; delete source.imageInputs;
      delete p.concepts[0].profile; p.referenceSets = []; p.selectedReferenceSetId = null; initialStore.save(p);
      const legacy = structuredClone(source), store = new Store(dir), current = store.get(p.id);
      const viewCalls = [], runner = new Runner(store, {
        conceptGenerator: { ...conceptGenerator, generateViews: async task => {
          viewCalls.push({ conceptId: task.conceptId, conceptFile: task.conceptFile, prompt: task.prompt, profile: task.profile, feedback: task.feedback });
          if (outcome === 'failed') {
            await task.onImage({ view: 'front', bytes: png, ext: 'png' });
            throw new Error('View provider unavailable');
          }
          await generateViews(task);
        } },
        inspectReferences: outcome === 'inconsistent' ? async () => ({ consistent: false, issues: ['Rear arms changed color'] }) : inspectReferences,
        generate: async (p, v, dir) => artifacts(dir)
      });
      if (edit === 'before revision') {
        store.update(p.id, { prompt: 'A brass teapot', profile: 'object' }, 'web');
        const currentDesignRunner = new Runner(store, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
        currentDesignRunner.start(p.id, {}, 'web'); await currentDesignRunner.pending;
      }
      store.update(p.id, { checkpoints: { multiView: true } }, 'web');
      const request = { kind: 'revision', sourceVersionId: source.id, feedback: 'Lengthen the original robot arms' };
      runner.start(p.id, request, 'web'); await runner.pending;
      const oldSet = current.referenceSets.at(-1), modelCount = current.versions.length;
      assert.equal(oldSet.status, outcome === 'failed' ? 'failed' : 'ready');
      assert.equal(oldSet.consistency.status, outcome === 'inconsistent' ? 'failed' : outcome === 'failed' ? 'pending' : 'passed');
      assert.equal(modelCount, edit === 'before revision' ? 2 : 1);
      if (edit === 'after views') store.update(p.id, { prompt: 'A silver teapot', profile: 'object' }, 'web');
      const selectedConceptId = current.selectedConceptId, selectedReferenceSetId = current.selectedReferenceSetId;
      store.update(p.id, { checkpoints: { multiView } }, 'web');
      // Reload both before regeneration and while the replacement awaits review.
      const resumedStore = new Store(dir), resumedProject = resumedStore.get(p.id), replacementCalls = [];
      const model = async (p, v, dir) => {
        assert.equal(v.kind, 'revision'); assert.equal(v.sourceVersionId, source.id);
        assert.equal(v.prompt, input.prompt); assert.equal(v.feedback, request.feedback);
        assert.equal(v.conceptId, conceptId);
        assert.deepEqual(fs.readFileSync(path.join(dir, 'source.blend')), sourceBytes);
        const task = fs.readFileSync(path.join(dir, 'TASK.md'), 'utf8');
        assert.match(task, /Revise the existing geometry/); assert.ok(task.includes(request.feedback));
        assert.ok(!task.includes('Restore teal rear arms')); artifacts(dir);
      };
      const resumed = new Runner(resumedStore, { conceptGenerator: { ...conceptGenerator, generateViews: async task => {
        replacementCalls.push({ conceptId: task.conceptId, conceptFile: task.conceptFile, prompt: task.prompt, profile: task.profile, feedback: task.feedback });
        await generateViews(task);
      } }, inspectReferences, generate: model });
      assert.throws(() => resumed.regenerateReferenceSet(p.id, { referenceSetId: 'missing' }, 'web'), /Reference set not found/);
      if (outcome !== 'failed') assert.throws(() => resumed.regenerateReferenceSet(p.id, { referenceSetId: oldSet.id }, 'mcp'), /Reject pending/);
      resumed.regenerateReferenceSet(p.id, { ...(edit === 'none' ? {} : { referenceSetId: oldSet.id }), feedback: 'Restore teal rear arms' }, 'web'); await resumed.pending;
      const replacement = resumedProject.referenceSets.at(-1), savedOldSet = structuredClone(resumedProject.referenceSets.find(s => s.id === oldSet.id));
      assert.equal(replacement.parentReferenceSetId, oldSet.id);
      assert.deepEqual(replacement.request, request); assert.equal(replacement.feedback, 'Restore teal rear arms');
      assert.notEqual(replacement.request, resumedProject.referenceSets.find(s => s.id === oldSet.id).request);
      assert.equal(replacement.conceptId, conceptId); assert.equal(replacement.images.length, 4);
      assert.equal(resumedProject.selectedConceptId, selectedConceptId);
      // A replacement for the current design may become selected; a historical
      // revision must leave the new project's selection unchanged.
      if (edit !== 'none') assert.equal(resumedProject.selectedReferenceSetId, selectedReferenceSetId);
      assert.deepEqual(viewCalls, [{ conceptId, conceptFile: store.artifact(p.id, current.concepts[0].artifacts.image), prompt: input.prompt, profile: 'character', feedback: '' }]);
      assert.deepEqual(replacementCalls, [{ ...viewCalls[0], feedback: 'Restore teal rear arms' }]);
      assert.equal(savedOldSet.review, outcome === 'failed' ? 'pending' : 'rejected');
      assert.deepEqual(resumedProject.versions[0], legacy);
      const finalStore = new Store(dir), finalProject = finalStore.get(p.id);
      const continued = new Runner(finalStore, { conceptGenerator, inspectReferences, generate: model });
      if (multiView) {
        assert.equal(finalProject.versions.length, modelCount); assert.equal(finalProject.referenceSets.at(-1).review, 'pending');
        assert.throws(() => continued.start(p.id, request, 'web'), /Review the multi-view|reviewed, consistent/);
        assert.throws(() => continued.reviewReferenceSet(p.id, replacement.id, 'approved', 'mcp'), /web UI/);
        continued.reviewReferenceSet(p.id, replacement.id, 'approved', 'web'); await continued.pending;
      }
      assert.equal(finalProject.versions.length, modelCount + 1);
      const revision = finalProject.versions.at(-1);
      assert.equal(revision.status, 'ready'); assert.equal(revision.referenceSetId, replacement.id);
      assert.deepEqual(revision.modelingImages, JSON.parse(JSON.stringify(replacement.images)));
      assert.deepEqual(revision.imageInputs, [finalProject.concepts[0].artifacts.image, ...replacement.images.map(i => i.file)]);
      assert.deepEqual(finalProject.referenceSets.find(s => s.id === oldSet.id), savedOldSet);
      assert.deepEqual(finalProject.versions[0], legacy);
      for (const img of oldSet.images) assert.deepEqual(fs.readFileSync(finalStore.artifact(p.id, img.file)), png);
      assert.deepEqual(new Store(dir).get(p.id).versions.at(-1), JSON.parse(JSON.stringify(revision)));
    });
  }
});

test('approving older legacy revision views models their exact images after replacement decisions and restart', async t => {
  for (const replacementDecision of ['rejected', 'approved']) for (const restart of [false, true]) for (const historical of [false, true]) {
    await t.test(`replacement ${replacementDecision}, restart ${restart}, historical design ${historical}`, async t => {
      const dir = temporary(t), store = new Store(dir), p = store.create(input, 'web');
      const runner = new Runner(store, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
      runner.start(p.id, {}, 'web'); await runner.pending;
      const source = p.versions[0];
      delete source.referenceSetId; delete source.modelingImages; delete source.imageInputs;
      p.referenceSets = []; p.selectedReferenceSetId = null; store.save(p);
      const legacy = structuredClone(source);
      if (historical) {
        store.update(p.id, { prompt: 'A brass teapot', profile: 'object' }, 'web');
        runner.start(p.id, {}, 'web'); await runner.pending;
      }
      const selectedConceptId = p.selectedConceptId, selectedReferenceSetId = p.selectedReferenceSetId;
      store.update(p.id, { checkpoints: { multiView: true } }, 'web');
      const request = { kind: 'revision', sourceVersionId: source.id, feedback: 'Lengthen the original robot arms' };
      runner.start(p.id, request, 'web'); await runner.pending;
      const older = p.referenceSets.at(-1);
      runner.regenerateReferenceSet(p.id, { referenceSetId: older.id, feedback: 'Restore rear arm colors' }, 'web'); await runner.pending;
      const replacement = p.referenceSets.at(-1);
      assert.equal(older.review, 'rejected'); assert.equal(older.consistency.status, 'passed');
      assert.deepEqual(replacement.request, older.request);
      runner.reviewReferenceSet(p.id, replacement.id, replacementDecision, 'web'); await runner.pending;
      if (replacementDecision === 'approved') assert.equal(p.versions.at(-1).referenceSetId, replacement.id);
      const continuedStore = restart ? new Store(dir) : store, continuedProject = continuedStore.get(p.id);
      const replacementSnapshot = structuredClone(continuedProject.referenceSets.find(s => s.id === replacement.id));
      const versionsSnapshot = structuredClone(continuedProject.versions);
      let modelCalls = 0;
      const continued = new Runner(continuedStore, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => {
        modelCalls++;
        assert.equal(v.referenceSetId, older.id); assert.equal(v.sourceVersionId, source.id);
        assert.equal(v.prompt, input.prompt); assert.equal(v.feedback, request.feedback);
        assert.deepEqual(v.modelingImages, p.referenceSets.find(s => s.id === older.id).images);
        assert.deepEqual(v.imageInputs, [p.concepts[0].artifacts.image, ...older.images.map(i => i.file)]);
        assert.ok(!v.imageInputs.some(file => replacement.images.some(i => i.file === file)));
        assert.equal(fs.readFileSync(path.join(dir, 'source.blend'), 'utf8'), 'BLENDER-test-fixture');
        artifacts(dir);
      } });
      // Explicit IDs cannot be used to bypass request association or approval.
      assert.throws(() => continued.start(p.id, { ...request, referenceSetId: 'missing' }, 'web'), /Reference set not found/);
      assert.throws(() => continued.start(p.id, { ...request, referenceSetId: older.id, feedback: 'Different revision' }, 'web'), /does not match the modeling request/);
      assert.throws(() => continued.start(p.id, { ...request, referenceSetId: older.id, kind: 'generate' }, 'web'), /does not match the modeling request/);
      if (historical) assert.throws(() => continued.start(p.id, { ...request, referenceSetId: older.id, sourceVersionId: p.versions[1].id }, 'web'), /does not match the modeling request/);
      assert.throws(() => continued.start(p.id, { ...request, referenceSetId: older.id }, 'web'), /reviewed, consistent/);
      assert.equal(modelCalls, 0); assert.equal(continuedProject.versions.length, versionsSnapshot.length);
      continued.reviewReferenceSet(p.id, older.id, 'approved', 'web'); await continued.pending;
      assert.equal(modelCalls, 1); assert.equal(continuedProject.versions.at(-1).status, 'ready');
      assert.equal(continuedProject.versions.length, versionsSnapshot.length + 1);
      assert.deepEqual(continuedProject.versions.slice(0, -1), versionsSnapshot);
      assert.deepEqual(continuedProject.versions[0], legacy);
      assert.deepEqual(continuedProject.referenceSets.find(s => s.id === replacement.id), replacementSnapshot);
      if (historical) {
        assert.equal(continuedProject.selectedConceptId, selectedConceptId);
        assert.equal(continuedProject.selectedReferenceSetId, selectedReferenceSetId);
      }
      const saved = new Store(dir).get(p.id), revision = saved.versions.at(-1);
      assert.equal(revision.referenceSetId, older.id); assert.deepEqual(revision.modelingImages, saved.referenceSets.find(s => s.id === older.id).images);
      assert.deepEqual(revision.imageInputs, [saved.concepts[0].artifacts.image, ...older.images.map(i => i.file)]);
      assert.ok(saved.activity.some(e => e.referenceSetId === older.id && e.decision === 'approved'));
    });
  }
});

test('disabled checkpoints auto-continue and a replaceable generator needs no Blender-flow changes', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  let generated = 0;
  const runner = new Runner(store, { inspectReferences, conceptGenerator: { generateViews, generate: async () => { generated++; return { bytes: png, ext: 'png' }; } }, generate: async (p, v, dir) => artifacts(dir) });
  runner.start(p.id, {}, 'web'); await runner.pending;
  const first = p.versions[0]; assert.equal(first.status, 'ready'); assert.equal(first.review, 'approved');
  assert.equal(p.concepts[0].review, 'approved'); assert.ok(p.activity.some(e => e.type === 'concept_auto_accepted'));
  runner.start(p.id, { kind: 'retry' }, 'web'); await runner.pending;
  assert.equal(generated, 1); assert.equal(p.versions[1].conceptId, first.conceptId);
  store.update(p.id, { prompt: 'Different design' }, 'web');
  runner.start(p.id, {}, 'web'); await runner.pending;
  assert.equal(generated, 2); assert.notEqual(p.versions[2].conceptId, first.conceptId);
  runner.start(p.id, { kind: 'revision', sourceVersionId: first.id, feedback: 'Long arms' }, 'web'); await runner.pending;
  assert.equal(p.versions[3].conceptId, first.conceptId); assert.equal(generated, 2);
});

test('image workflow skips concept generation entirely and still respects input and preview reviews', async t => {
  const store = new Store(temporary(t)), p = store.create({ name: 'Image', mode: 'image', image, checkpoints: { input: true, concept: true, multiView: false, preview: true } }, 'web');
  const runner = new Runner(store, { inspectReferences, conceptGenerator: { generate: () => { throw new Error('Must never generate concept for image input'); } }, generate: async (p, v, dir) => { assert.equal(v.visualInput, p.inputImage); artifacts(dir); } });
  assert.throws(() => runner.start(p.id, {}, 'web'), /Review the input/);
  store.reviewInput(p.id, 'rejected', 'web'); assert.throws(() => runner.start(p.id, {}, 'web'), /Review the input/);
  store.reviewInput(p.id, 'approved', 'web'); runner.start(p.id, {}, 'web'); await runner.pending;
  assert.equal(p.concepts.length, 0); assert.equal(p.versions[0].status, 'ready'); assert.equal(p.versions[0].conceptId, null);
  assert.throws(() => runner.start(p.id, { kind: 'revision', sourceVersionId: p.versions[0].id, feedback: 'Change' }, 'web'), /Review the 3D/);
  store.reviewVersion(p.id, p.versions[0].id, 'rejected', 'web');
  runner.start(p.id, { kind: 'revision', sourceVersionId: p.versions[0].id, feedback: 'Change' }, 'web'); await runner.pending;
  assert.equal(p.versions.length, 2); assert.equal(p.concepts.length, 0);
});

test('unavailable, invalid and usage-limited concept providers never invoke modeling', async t => {
  for (const fail of [() => { throw new Error('Native image tool unavailable'); }, () => ({ bytes: Buffer.from('invalid'), ext: 'png' }), () => { const e = new Error('Usage limit reached'); e.usageLimited = true; throw e; }]) {
    const store = new Store(temporary(t)), p = store.create(input, 'web');
    const runner = new Runner(store, { inspectReferences, conceptGenerator: { generate: fail }, generate: () => assert.fail('Modeling must not run') });
    runner.start(p.id, {}, 'web'); await runner.pending;
    assert.equal(p.versions.length, 0); assert.equal(p.concepts[0].status, 'failed'); assert.ok(p.concepts[0].error);
    if (runner.usageLimited) assert.throws(() => runner.regenerateConcept(p.id, {}, 'web'), /usage limit/);
  }
});

test('legacy text projects cannot bypass mandatory concepts and interrupted concepts recover', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  p.versions.push({ id: 'legacy', status: 'ready', artifacts: {}, review: 'approved' });
  delete p.concepts; delete p.checkpoints; delete p.inputReview; store.save(p);
  const loaded = new Store(store.root), current = loaded.get(p.id);
  const runner = new Runner(loaded, { conceptGenerator, generate: () => assert.fail('Must wait for concept review') });
  runner.start(p.id, {}, 'web'); await runner.pending;
  assert.equal(current.concepts.length, 1); assert.equal(current.versions.length, 1);
  current.concepts.push({ id: 'interrupted', status: 'running' }); loaded.save(current);
  const recovered = new Store(store.root).get(p.id);
  assert.equal(recovered.concepts[1].status, 'failed'); assert.equal(recovered.activity.at(-1).type, 'concept_interrupted');
});

test('HTTP and MCP expose the same concept state and cannot approve enabled human checkpoints', async t => {
  const a = await app(t), client = new Client({ name: 'concept-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.js')], env: { ...process.env, GEN3D_URL: a.url }, stderr: 'pipe' })); t.after(() => client.close());
  const p = (await a.request('/api/projects', 'POST', { ...input, checkpoints: { concept: true, multiView: false, preview: true } })).data;
  await client.callTool({ name: 'generate_model', arguments: { projectId: p.id } }); await a.runner.pending;
  const c = a.store.get(p.id).concepts[0];
  const state = await client.readResource({ uri: `gen3d://projects/${p.id}` });
  assert.equal(JSON.parse(state.contents[0].text).concepts[0].id, c.id);
  assert.equal((await fetch(a.url + `/api/projects/${p.id}/artifacts/${c.artifacts.image}`)).status, 200);
  assert.equal((await a.request(`/api/projects/${p.id}/concepts/${c.id}/review`, 'POST', { decision: 'approved' }, { 'X-Gen3d-Client': 'mcp' })).status, 403);
  assert.equal((await a.request(`/api/projects/${p.id}`, 'PATCH', { checkpoints: { concept: false } }, { 'X-Gen3d-Client': 'mcp' })).status, 403);
  await a.request(`/api/projects/${p.id}/concepts/${c.id}/review`, 'POST', { decision: 'approved' }); await a.runner.pending;
  const v = a.store.get(p.id).versions[0];
  const blocked = await client.callTool({ name: 'export_model', arguments: { projectId: p.id, versionId: v.id } }); assert.equal(blocked.isError, true);
  assert.equal((await fetch(a.url + `/api/projects/${p.id}/artifacts/${v.artifacts.glb}`)).status, 200); // Viewer remains inspectable.
  assert.equal((await fetch(a.url + `/api/projects/${p.id}/artifacts/${v.artifacts.glb}?download=1`)).status, 409);
  await a.request(`/api/projects/${p.id}/versions/${v.id}/review`, 'POST', { decision: 'approved' });
  const exported = await client.callTool({ name: 'export_model', arguments: { projectId: p.id, versionId: v.id } }); assert.ok(!exported.isError);
  const shared = await client.callTool({ name: 'get_project', arguments: { projectId: p.id } });
  assert.equal(JSON.parse(shared.content[0].text).versions[0].conceptId, c.id);
});

test('Codex concept provider requires an actual image artifact and subscription login, without a paid fallback', async t => {
  const dir = temporary(t), calls = [];
  const generator = new CodexConceptGenerator({ env: { PATH: '/bin', OPENAI_API_KEY: 'test', CODEX_API_KEY: 'test' }, processRunner: async (command, args, options) => {
    calls.push(args); assert.equal(options.env.OPENAI_API_KEY, undefined); assert.equal(options.env.CODEX_API_KEY, undefined);
    if (args[0] === 'login') return 'Logged in using ChatGPT';
    assert.ok(args.includes('forced_login_method="chatgpt"')); assert.ok(args.includes('--ignore-user-config'));
    assert.ok(!args.includes('--model')); assert.ok(!args.some(a => a.includes('mcp_servers')));
    return 'I generated the image'; // A success claim with no file must fail.
  } });
  await assert.rejects(generator.generate({ prompt: 'Robot', dir }), /no successful native image-generation output/);
  fs.writeFileSync(path.join(dir, 'concept.png'), png);
  const result = await generator.generate({ prompt: 'Robot', dir }); assert.deepEqual(result.bytes, png);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'image-generation.json'))).authentication, 'chatgpt');
  fs.unlinkSync(path.join(dir, 'concept.png')); fs.symlinkSync(path.join(dir, 'TASK.md'), path.join(dir, 'concept.png'));
  await assert.rejects(generator.generate({ prompt: 'Robot', dir }), /unavailable/);
  const paid = new CodexConceptGenerator({ processRunner: async () => 'Logged in using an API key' });
  await assert.rejects(paid.generate({ prompt: 'Robot', dir }), /ChatGPT login/);
});

test('final Blender boundary rejects a text-only or mismatched visual job before any process/Blender call', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web'), runner = new Runner(store);
  await assert.rejects(runner.realGenerate(p, { visualInput: null }, store.dir(p.id)), /visual input/);
  p.concepts.push({ id: 'concept', status: 'ready', review: 'approved', artifacts: { image: 'concept.png' } });
  await assert.rejects(runner.realGenerate(p, { conceptId: 'concept', visualInput: 'different.png' }, store.dir(p.id)), /visual input/);
});

test('native image-tool allowance failures reported in the final message stop further jobs', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  const generator = new CodexConceptGenerator({ processRunner: async (command, args, options) => {
    if (args[0] === 'login') return 'Logged in using ChatGPT';
    fs.writeFileSync(path.join(options.cwd, 'summary.txt'), 'Image generation failed: usage limit reached.'); return 'Turn completed';
  } });
  const runner = new Runner(store, { inspectReferences, conceptGenerator: generator, generate: () => assert.fail('No modeling after a usage limit') });
  runner.start(p.id, {}, 'web'); await runner.pending;
  assert.equal(runner.usageLimited, true); assert.equal(p.versions.length, 0);
  assert.throws(() => runner.start(p.id, {}, 'web'), /usage limit/);
  assert.throws(() => runner.regenerateConcept(p.id, {}, 'web'), /usage limit/);
  await assert.rejects(runProcess(process.execPath, ['-e', `console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',exit_code:1,status:'completed',aggregated_output:'ERROR: quota exceeded'}}));`]), e => e.usageLimited === true);
});

test('multi-view checkpoint survives restart/settings changes and requires explicit web approval', async t => {
  const store = new Store(temporary(t)), p = store.create({ ...input, checkpoints: { ...input.checkpoints, multiView: true } }, 'web');
  const runner = new Runner(store, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
  runner.start(p.id, {}, 'mcp'); await runner.pending;
  const set = p.referenceSets[0];
  assert.equal(set.images.length, 4); assert.equal(set.review, 'pending'); assert.equal(p.versions.length, 0);
  assert.equal(set.consistency.status, 'passed'); assert.equal(set.conceptId, p.selectedConceptId);
  assert.throws(() => runner.start(p.id, {}, 'mcp'), /multi-view/);
  assert.throws(() => runner.reviewReferenceSet(p.id, set.id, 'approved', 'mcp'), /web UI/);
  assert.throws(() => runner.regenerateReferenceSet(p.id, {}, 'mcp'), /Reject pending/);
  store.update(p.id, { checkpoints: { multiView: false } }, 'web');
  const reloaded = new Store(store.root), current = reloaded.get(p.id);
  const resumed = new Runner(reloaded, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
  assert.equal(current.referenceSets[0].checkpoints.multiView, true);
  assert.throws(() => resumed.start(p.id, {}, 'web'), /multi-view/);
  resumed.reviewReferenceSet(p.id, set.id, 'approved', 'web'); await resumed.pending;
  assert.equal(current.versions[0].status, 'ready'); assert.equal(current.versions[0].referenceSetId, set.id);
  assert.deepEqual(current.versions[0].modelingImages, current.referenceSets[0].images);
  assert.equal(current.versions[0].imageInputs.length, 5);
  assert.ok(current.activity.some(e => e.type === 'reference_set_reviewed' && e.actor === 'web' && e.decision === 'approved'));
});

test('character and object providers receive the exact base design; all images persist with typed provenance', async t => {
  for (const profile of ['character', 'object']) {
    const store = new Store(temporary(t)), p = store.create({ ...input, profile }, 'web');
    const provider = { provider: 'replacement', generate: conceptGenerator.generate, generateViews: async task => {
      assert.equal(task.profile, profile); assert.equal(task.prompt, input.prompt);
      assert.equal(task.conceptId, p.concepts[0].id); assert.deepEqual(fs.readFileSync(task.conceptFile), png);
      await generateViews(task);
    } };
    const runner = new Runner(store, { conceptGenerator: provider, inspectReferences: async task => {
      assert.equal(task.images.length, 5); assert.deepEqual(task.images.slice(1).map(i => i.label), ['front', 'left side', 'back', 'three-quarter']);
      return inspectReferences();
    }, generate: async (p, v, dir) => artifacts(dir) });
    runner.start(p.id, {}, 'web'); await runner.pending;
    const set = p.referenceSets[0]; assert.equal(set.review, 'approved'); assert.equal(p.versions[0].status, 'ready');
    assert.equal(p.concepts[0].role, 'base-concept'); assert.equal(set.provider, 'replacement');
    assert.equal(new Set(set.images.map(i => i.file)).size, 4);
    for (const image of set.images) {
      assert.equal(image.role, 'modeling-view'); assert.equal(image.parentConceptId, p.concepts[0].id);
      assert.equal(image.parentImage, p.concepts[0].artifacts.image); assert.deepEqual(fs.readFileSync(store.artifact(p.id, image.file)), png);
    }
    const saved = new Store(store.root).get(p.id);
    assert.deepEqual(saved.referenceSets, JSON.parse(JSON.stringify(p.referenceSets))); assert.equal(saved.versions[0].referenceSetId, set.id);
  }
});

test('reference regeneration/rejection retains all earlier sets, decisions and linked model versions', async t => {
  const store = new Store(temporary(t)), p = store.create({ ...input, checkpoints: { ...input.checkpoints, multiView: true } }, 'web');
  const runner = new Runner(store, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
  runner.start(p.id, {}, 'web'); await runner.pending;
  const first = p.referenceSets[0], bytes = first.images.map(i => fs.readFileSync(store.artifact(p.id, i.file)));
  runner.regenerateReferenceSet(p.id, { feedback: 'Match the rear feet' }, 'web'); await runner.pending;
  assert.equal(first.review, 'rejected'); assert.equal(p.versions.length, 0);
  assert.equal(p.referenceSets[1].feedback, 'Match the rear feet'); assert.equal(p.concepts.length, 1);
  runner.reviewReferenceSet(p.id, p.referenceSets[1].id, 'approved', 'web'); await runner.pending;
  const model = p.versions[0];
  runner.regenerateReferenceSet(p.id, {}, 'web'); await runner.pending;
  runner.reviewReferenceSet(p.id, p.referenceSets[2].id, 'rejected', 'web');
  assert.throws(() => runner.start(p.id, {}, 'web'), /Regenerate or explicitly accept/);
  assert.equal(model.referenceSetId, p.referenceSets[1].id);
  // A historical revision uses its source set even after a later set is rejected.
  runner.start(p.id, { kind: 'revision', sourceVersionId: model.id, feedback: 'Taller' }, 'web'); await runner.pending;
  assert.equal(p.versions[1].referenceSetId, model.referenceSetId);
  first.images.forEach((i, n) => assert.deepEqual(fs.readFileSync(store.artifact(p.id, i.file)), bytes[n]));
  assert.ok(p.activity.some(e => e.referenceSetId === first.id && e.decision === 'rejected'));
});

test('missing/invalid/unavailable views and inspection failures block modeling without falling back to older sets', async t => {
  const badProviders = [
    {},
    { generateViews: async ({ onImage }) => onImage({ view: 'front', bytes: png, ext: 'png' }) },
    { generateViews: async ({ onImage }) => { await onImage({ view: 'front', bytes: png, ext: 'png' }); throw new Error('Unavailable'); } },
    { generateViews: async ({ onImage }) => onImage({ view: 'front', bytes: Buffer.from('invalid'), ext: 'png' }) },
    { generateViews: async ({ onImage }) => { await onImage({ view: 'front', bytes: png, ext: 'png' }); await onImage({ view: 'front', bytes: png, ext: 'png' }); } },
  ];
  for (const bad of badProviders) {
    const store = new Store(temporary(t)), p = store.create(input, 'web');
    const runner = new Runner(store, { conceptGenerator, inspectReferences, generate: async (p, v, dir) => artifacts(dir) });
    runner.start(p.id, {}, 'web'); await runner.pending;
    const oldModel = p.versions[0]; runner.conceptGenerator = { generate: conceptGenerator.generate, ...bad };
    runner.regenerateReferenceSet(p.id, {}, 'web'); await runner.pending;
    const failed = p.referenceSets[1]; assert.equal(failed.status, 'failed'); assert.ok(failed.error);
    assert.equal(p.versions.length, 1); assert.equal(oldModel.referenceSetId, p.referenceSets[0].id);
    assert.throws(() => runner.start(p.id, {}, 'web'), /Regenerate/);
    for (const image of failed.images) assert.deepEqual(fs.readFileSync(store.artifact(p.id, image.file)), png);
  }
  for (const inspect of [async () => { throw new Error('Inspection unavailable'); }, async () => ({ consistent: 'yes', issues: [] })]) {
    const store = new Store(temporary(t)), p = store.create(input, 'web');
    const runner = new Runner(store, { conceptGenerator, inspectReferences: inspect, generate: () => assert.fail('Never model without inspection') });
    runner.start(p.id, {}, 'web'); await runner.pending;
    assert.equal(p.referenceSets[0].images.length, 4); assert.equal(p.referenceSets[0].status, 'failed'); assert.equal(p.versions.length, 0);
  }
});

test('cross-view contradictions require regeneration from the same base and cannot be approved away', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  const runner = new Runner(store, { conceptGenerator, inspectReferences: async () => ({ consistent: false, issues: ['Back view is missing a leg'] }), generate: () => assert.fail('No modeling inconsistent views') });
  runner.start(p.id, {}, 'web'); await runner.pending;
  const set = p.referenceSets[0]; assert.equal(set.status, 'ready'); assert.equal(set.consistency.status, 'failed'); assert.equal(set.review, 'pending');
  assert.equal(p.versions.length, 0); assert.throws(() => runner.reviewReferenceSet(p.id, set.id, 'approved', 'web'), /contradictions/);
  assert.throws(() => runner.start(p.id, {}, 'web'), /multi-view/);
  runner.reviewReferenceSet(p.id, set.id, 'rejected', 'web');
  runner.inspectReferences = inspectReferences; runner.generate = async (p, v, dir) => artifacts(dir);
  runner.regenerateReferenceSet(p.id, { feedback: 'Restore all legs' }, 'web'); await runner.pending;
  assert.equal(p.referenceSets[1].conceptId, set.conceptId); assert.equal(p.concepts.length, 1);
  assert.equal(p.versions[0].referenceSetId, p.referenceSets[1].id);
});

test('interrupted reference sets preserve partial images and pending reviews persist across restart', async t => {
  const store = new Store(temporary(t)), p = store.create({ ...input, checkpoints: { ...input.checkpoints, multiView: true } }, 'web');
  const runner = new Runner(store, { conceptGenerator, inspectReferences, generate: () => assert.fail('Pending review blocks modeling') });
  runner.start(p.id, {}, 'web'); await runner.pending;
  const pending = p.referenceSets[0];
  p.referenceSets.push({ ...structuredClone(pending), id: 'interrupted', status: 'running', images: pending.images.slice(0, 1) }); store.save(p);
  const recovered = new Store(store.root).get(p.id);
  assert.equal(recovered.referenceSets[0].review, 'pending'); assert.equal(recovered.referenceSets[1].status, 'failed');
  assert.equal(recovered.referenceSets[1].images.length, 1); assert.equal(recovered.activity.at(-1).type, 'reference_set_interrupted');
});

test('HTTP/MCP share view artifacts, pending reviews, regeneration, consistency and derived-model linkage', async t => {
  const a = await app(t), client = new Client({ name: 'views-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.js')], env: { ...process.env, GEN3D_URL: a.url }, stderr: 'pipe' })); t.after(() => client.close());
  const result = await client.callTool({ name: 'create_project', arguments: { ...input, checkpoints: { ...input.checkpoints, multiView: true } } });
  const p = JSON.parse(result.content[0].text);
  await client.callTool({ name: 'generate_model', arguments: { projectId: p.id } }); await a.runner.pending;
  const state = JSON.parse((await client.readResource({ uri: `gen3d://projects/${p.id}` })).contents[0].text), set = state.referenceSets[0];
  assert.deepEqual(state.referenceSets, (await a.request(`/api/projects/${p.id}`)).data.referenceSets);
  assert.equal(state.versions.length, 0);
  for (const image of set.images) {
    const response = await fetch(a.url + `/api/projects/${p.id}/artifacts/${image.file}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    const read = await client.callTool({ name: 'get_reference_image', arguments: { projectId: p.id, imageId: image.id } });
    assert.equal(read.content[0].type, 'image'); assert.deepEqual(Buffer.from(read.content[0].data, 'base64'), png);
  }
  assert.equal((await a.request(`/api/projects/${p.id}/reference-sets/${set.id}/review`, 'POST', { decision: 'approved' }, { 'X-Gen3d-Client': 'mcp' })).status, 403);
  const denied = await client.callTool({ name: 'regenerate_reference_set', arguments: { projectId: p.id } }); assert.equal(denied.isError, true);
  await a.request(`/api/projects/${p.id}/reference-sets/${set.id}/review`, 'POST', { decision: 'rejected' });
  await client.callTool({ name: 'regenerate_reference_set', arguments: { projectId: p.id, feedback: 'Keep all components' } }); await a.runner.pending;
  const next = a.store.get(p.id).referenceSets[1];
  await a.request(`/api/projects/${p.id}/reference-sets/${next.id}/review`, 'POST', { decision: 'approved' }); await a.runner.pending;
  const shared = JSON.parse((await client.callTool({ name: 'get_project', arguments: { projectId: p.id } })).content[0].text);
  assert.equal(shared.referenceSets[0].review, 'rejected'); assert.equal(shared.versions[0].referenceSetId, next.id);
});

test('HTTP and MCP target historical revision sets without changing another revision request or the selected design', async t => {
  const a = await app(t), p = a.store.create(input, 'web');
  a.runner.start(p.id, {}, 'web'); await a.runner.pending;
  const source = p.versions[0]; delete source.referenceSetId; delete source.modelingImages; delete source.imageInputs;
  p.referenceSets = []; p.selectedReferenceSetId = null; a.store.save(p);
  a.store.update(p.id, { prompt: 'A brass teapot', profile: 'object' }, 'web');
  a.runner.start(p.id, {}, 'web'); await a.runner.pending;
  const selectedConceptId = p.selectedConceptId, selectedReferenceSetId = p.selectedReferenceSetId;
  a.store.update(p.id, { checkpoints: { multiView: true } }, 'web');
  const request = { kind: 'revision', sourceVersionId: source.id, feedback: 'Longer robot arms' };
  a.runner.start(p.id, request, 'web'); await a.runner.pending;
  const target = p.referenceSets.at(-1);
  a.runner.start(p.id, { ...request, feedback: 'Wider robot shoulders' }, 'web'); await a.runner.pending;
  const other = p.referenceSets.at(-1), otherSnapshot = structuredClone(other);
  const client = new Client({ name: 'revision-views-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.js')], env: { ...process.env, GEN3D_URL: a.url }, stderr: 'pipe' })); t.after(() => client.close());
  const denied = await client.callTool({ name: 'regenerate_reference_set', arguments: { projectId: p.id, referenceSetId: target.id } });
  assert.equal(denied.isError, true); assert.match(denied.content[0].text, /Reject pending/);
  await a.request(`/api/projects/${p.id}/reference-sets/${target.id}/review`, 'POST', { decision: 'rejected' });
  const result = await client.callTool({ name: 'regenerate_reference_set', arguments: { projectId: p.id, referenceSetId: target.id, feedback: 'Restore the rear panel' } });
  assert.ok(!result.isError); await a.runner.pending;
  const replacement = p.referenceSets.at(-1);
  assert.equal(replacement.parentReferenceSetId, target.id); assert.equal(replacement.conceptId, source.conceptId);
  assert.deepEqual(replacement.request, request); assert.equal(replacement.feedback, 'Restore the rear panel');
  assert.deepEqual(other, otherSnapshot); assert.equal(other.review, 'pending');
  assert.equal(p.selectedConceptId, selectedConceptId); assert.equal(p.selectedReferenceSetId, selectedReferenceSetId);
  assert.equal((await a.request(`/api/projects/${p.id}/reference-sets/${replacement.id}/review`, 'POST', { decision: 'approved' })).status, 200); await a.runner.pending;
  assert.equal(p.versions.at(-1).kind, 'revision'); assert.equal(p.versions.at(-1).sourceVersionId, source.id);
  assert.equal(p.versions.at(-1).feedback, request.feedback); assert.equal(p.versions.at(-1).referenceSetId, replacement.id);
  const shared = JSON.parse((await client.callTool({ name: 'get_project', arguments: { projectId: p.id } })).content[0].text);
  assert.deepEqual(shared, (await a.request(`/api/projects/${p.id}`)).data);
  // The web endpoint accepts the same explicit target and records its request.
  const webReplacement = await a.request(`/api/projects/${p.id}/reference-sets`, 'POST', { referenceSetId: other.id, feedback: 'Keep shoulder proportions' });
  assert.equal(webReplacement.status, 202); await a.runner.pending;
  assert.equal(p.referenceSets.at(-1).request.feedback, other.request.feedback);
  assert.equal(p.referenceSets.at(-1).parentReferenceSetId, other.id);
  assert.equal(other.review, 'rejected'); assert.equal(p.versions.length, 3);
});

test('real modeling boundary attaches all required images in order, rejects missing/tampered sets and retains image input', async t => {
  for (const mode of ['text', 'image']) {
    const store = new Store(temporary(t)), p = store.create(mode === 'text' ? input : { ...input, mode, image }, 'web');
    const calls = [];
    const runner = new Runner(store, { conceptGenerator, inspectReferences,
      processRunner: async (command, args) => { calls.push(args); return args[0] === 'login' ? 'Logged in using ChatGPT' : 'done'; },
      blender: async (type, { code }) => { if (code?.includes('export_scene.gltf')) artifacts(path.join(store.dir(p.id), 'versions', p.versions.at(-1).id)); } });
    runner.start(p.id, {}, 'web'); await runner.pending;
    const v = p.versions[0], cli = calls.find(args => args[0] === 'exec');
    const attachments = cli.flatMap((arg, n) => arg === '--image' ? [cli[n + 1]] : []);
    assert.deepEqual(attachments, v.imageInputs.map(file => store.artifact(p.id, file)));
    assert.equal(attachments.length, mode === 'text' ? 5 : 1); assert.equal(v.status, 'ready');
    if (mode === 'text') {
      const set = p.referenceSets[0]; assert.match(fs.readFileSync(store.artifact(p.id, v.artifacts.task), 'utf8'), /ALL required modeling views/);
      await assert.rejects(runner.realGenerate(p, { ...v, referenceSetId: null }, store.dir(p.id)), /reference set/);
      await assert.rejects(runner.realGenerate(p, { ...v, modelingImages: v.modelingImages.slice(0, 1) }, store.dir(p.id)), /do not match/);
      set.images.pop(); await assert.rejects(runner.realGenerate(p, v, store.dir(p.id)), /complete reference set/);
      assert.equal(calls.length, 2); // Rejections happened before CLI/Blender calls.
    }
  }
});

test('native multi-view provider uses the same concept and prior views as real image-generation inputs', async t => {
  const dir = temporary(t), conceptFile = path.join(dir, 'base.png'); fs.writeFileSync(conceptFile, png);
  const calls = [], received = [];
  const generator = new CodexConceptGenerator({ processRunner: async (command, args, { cwd, env }) => {
    assert.equal(env.OPENAI_API_KEY, undefined);
    if (args[0] === 'login') return 'Logged in using ChatGPT';
    calls.push(args);
    const view = path.basename(cwd); fs.writeFileSync(path.join(cwd, view + '.png'), png); return 'done';
  } });
  await generator.generateViews({ prompt: input.prompt, profile: 'character', conceptFile, feedback: 'Fix the back heels and left-side direction', dir, onImage: image => received.push(image) });
  assert.deepEqual(received.map(i => i.view), requiredViews); assert.equal(received[1].side, 'left');
  calls.forEach((args, n) => {
    const attachments = args.flatMap((arg, i) => arg === '--image' ? [args[i + 1]] : []);
    assert.equal(attachments[0], conceptFile); assert.equal(attachments.length, n + 1);
    assert.ok(args.includes('image_generation'));
    const task = fs.readFileSync(path.join(dir, requiredViews[n], 'TASK.md'), 'utf8');
    assert.match(task, /exact agreed base design/); assert.match(task, /neutral A-pose/); assert.match(task, /near-orthographic/); assert.match(task, /This view requirement takes precedence over feedback about another angle/); assert.match(task, new RegExp('Final required output: ' + requiredViews[n] + '.png'));
  });
});

test('Codex consistency inspector attaches base and views without Blender tools and requires a structured report', async t => {
  const dir = temporary(t), images = ['base', ...requiredViews].map(label => ({ label, file: path.join(dir, label + '.png') }));
  let report = { consistent: false, issues: ['Color changed'] };
  const inspector = new CodexReferenceInspector({ processRunner: async (command, args, { env }) => {
    assert.equal(env.OPENAI_API_KEY, undefined); if (args[0] === 'login') return 'Logged in using ChatGPT';
    assert.equal(args.filter(a => a === '--image').length, 5); assert.ok(args.includes('--output-schema')); assert.ok(args.includes('read-only'));
    assert.ok(!args.some(a => a.includes('mcp_servers'))); assert.ok(!args.includes('image_generation'));
    fs.writeFileSync(path.join(dir, 'consistency.json'), JSON.stringify(report)); return 'done';
  } });
  assert.deepEqual(await inspector.inspect({ prompt: input.prompt, profile: 'object', images, dir }), report);
  report = { consistent: 'true', issues: [] }; await assert.rejects(inspector.inspect({ prompt: input.prompt, profile: 'object', images, dir }), /Invalid/);
});

test('view-generation and consistency usage limits stop subsequent actions without retrying or switching', async t => {
  for (const stage of ['views', 'inspection']) {
    const store = new Store(temporary(t)), p = store.create(input, 'web');
    let calls = 0;
    const limited = () => { calls++; const e = new Error('Usage limit reached'); e.usageLimited = true; throw e; };
    const runner = new Runner(store, { conceptGenerator: { ...conceptGenerator, ...(stage === 'views' ? { generateViews: limited } : {}) }, inspectReferences: stage === 'inspection' ? limited : inspectReferences, generate: () => assert.fail('No modeling') });
    runner.start(p.id, {}, 'web'); await runner.pending;
    assert.equal(calls, 1); assert.equal(runner.usageLimited, true); assert.equal(p.versions.length, 0);
    assert.throws(() => runner.regenerateReferenceSet(p.id, {}, 'web'), /usage limit/); assert.throws(() => runner.regenerateConcept(p.id, {}, 'web'), /usage limit/);
  }
});


test('final native-tool usage reports stop the process even when the CLI turn completes successfully', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', `console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Native image generation failed: usage limit reached.'}})); process.exit(0);`]), e => e.usageLimited === true);
});

test('valid native images remain accessible when a later CLI failure or usage report blocks the job', async t => {
  for (const stage of ['concept', 'views']) {
    const store = new Store(temporary(t)), p = store.create(input, 'web');
    const provider = new CodexConceptGenerator({ processRunner: async (command, args, { cwd }) => {
      if (args[0] === 'login') return 'Logged in using ChatGPT';
      const view = path.basename(cwd), isView = requiredViews.includes(view);
      fs.writeFileSync(path.join(cwd, isView ? view + '.png' : 'concept.png'), png);
      if ((stage === 'views' && isView) || stage === 'concept') fs.writeFileSync(path.join(cwd, 'summary.txt'), 'Native image tool failed: usage limit reached.');
      return 'done';
    } });
    const runner = new Runner(store, { conceptGenerator: provider, inspectReferences, generate: () => assert.fail('Usage failure never models') });
    runner.start(p.id, {}, 'web'); await runner.pending;
    assert.equal(runner.usageLimited, true); assert.equal(p.versions.length, 0);
    const file = stage === 'concept' ? p.concepts[0].artifacts.image : p.referenceSets[0].images[0].file;
    assert.deepEqual(fs.readFileSync(store.artifact(p.id, file)), png);
    if (stage === 'views') assert.equal(p.referenceSets[0].images.length, 1);
  }
});

test('replacement providers can supply a clearly labeled right-side reference', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  const runner = new Runner(store, { conceptGenerator: { ...conceptGenerator, generateViews: async ({ onImage }) => {
    for (const view of requiredViews) await onImage({ view, side: view === 'side' ? 'right' : undefined, bytes: png, ext: 'png' });
  } }, inspectReferences: async ({ images }) => { assert.equal(images[2].label, 'right side'); return inspectReferences(); }, generate: async (p, v, dir) => artifacts(dir) });
  runner.start(p.id, {}, 'web'); await runner.pending;
  assert.equal(p.referenceSets[0].images[1].side, 'right'); assert.equal(p.versions[0].status, 'ready');
});
