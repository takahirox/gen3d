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
import { CodexConceptGenerator } from '../src/concept.js';
import { Runner, subscriptionEnv, codexArgs, validateArtifacts, runProcess } from '../src/runner.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
const image = 'data:image/png;base64,' + png.toString('base64');
const conceptGenerator = { generate: async () => ({ bytes: png, ext: 'png' }) };
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
  const instance = createApp({ dataDir, generate, conceptGenerator });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  t.after(async () => { await instance.runner.pending; await new Promise(resolve => instance.server.close(resolve)); await instance.closed; });
  const url = `http://127.0.0.1:${instance.server.address().port}`;
  async function request(route, method = 'GET', data, headers = {}) {
    const res = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, data: await res.json() };
  }
  return { ...instance, url, request, dataDir };
}
const input = { name: 'Robot', mode: 'text', prompt: 'A teal robot', checkpoints: { input: false, concept: false, preview: false } };

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
  const runner = new Runner(store, { conceptGenerator, generate: async (p, v, dir) => artifacts(dir) });
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
  const runner = new Runner(store, { conceptGenerator, generate: async (p, v, dir) => { if (v.kind === 'revision') assert.equal(fs.readFileSync(path.join(dir, 'source.blend'), 'utf8'), 'BLENDER-test-fixture'); artifacts(dir); } });
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
  const runner = new Runner(store, { conceptGenerator, generate: async (p, v, dir) => { await barrier; artifacts(dir); } });
  runner.start(p.id, {}, 'web');
  assert.throws(() => runner.start(p2.id, {}, 'mcp'), /another version/);
  assert.throws(() => store.update(p.id, { prompt: 'changed' }, 'mcp'), /Wait/);
  assert.throws(() => store.addReference(p.id, { label: 'late', image }, 'web'), /Wait/);
  release(); await runner.pending; assert.equal(runner.active, false);
});

test('failures retain useful history, retry gets a new folder and usage limits stop subsequent jobs', async t => {
  let calls = 0;
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  const runner = new Runner(store, { conceptGenerator, generate: async (p, v, dir) => { if (++calls === 1) throw new Error('Blender disconnected'); artifacts(dir); } });
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
  const runner = new Runner(store, { conceptGenerator, generate: async (p, v, dir) => { artifacts(dir); fs.writeFileSync(path.join(dir, 'mcp-audit.jsonl'), '{"tool":"get_scene_info"}\n'); } });
  runner.start(p.id, {}, 'web'); return runner.pending.then(() => { assert.equal(p.versions[0].status, 'failed'); assert.match(p.versions[0].error, /No successful/); });
});

test('text workflow generates a concept first, waits for explicit acceptance, and models the selected image', async t => {
  const store = new Store(temporary(t)), p = store.create({ ...input, checkpoints: { input: true, concept: true, preview: true } }, 'web');
  const calls = [];
  const runner = new Runner(store, { conceptGenerator: { generate: async task => { calls.push('concept'); assert.equal(task.prompt, p.prompt); return { bytes: png, ext: 'png' }; } }, generate: async (project, v, dir) => {
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
  const store = new Store(temporary(t)), p = store.create({ ...input, checkpoints: { concept: true, preview: false } }, 'web');
  let modeled = 0;
  const runner = new Runner(store, { conceptGenerator, generate: async (p, v, dir) => { modeled++; artifacts(dir); } });
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

test('disabled checkpoints auto-continue and a replaceable generator needs no Blender-flow changes', async t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  let generated = 0;
  const runner = new Runner(store, { conceptGenerator: { generate: async () => { generated++; return { bytes: png, ext: 'png' }; } }, generate: async (p, v, dir) => artifacts(dir) });
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
  const store = new Store(temporary(t)), p = store.create({ name: 'Image', mode: 'image', image, checkpoints: { input: true, concept: true, preview: true } }, 'web');
  const runner = new Runner(store, { conceptGenerator: { generate: () => { throw new Error('Must never generate concept for image input'); } }, generate: async (p, v, dir) => { assert.equal(v.visualInput, p.inputImage); artifacts(dir); } });
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
    const runner = new Runner(store, { conceptGenerator: { generate: fail }, generate: () => assert.fail('Modeling must not run') });
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
  const p = (await a.request('/api/projects', 'POST', { ...input, checkpoints: { concept: true, preview: true } })).data;
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
  const runner = new Runner(store, { conceptGenerator: generator, generate: () => assert.fail('No modeling after a usage limit') });
  runner.start(p.id, {}, 'web'); await runner.pending;
  assert.equal(runner.usageLimited, true); assert.equal(p.versions.length, 0);
  assert.throws(() => runner.start(p.id, {}, 'web'), /usage limit/);
  assert.throws(() => runner.regenerateConcept(p.id, {}, 'web'), /usage limit/);
  await assert.rejects(runProcess(process.execPath, ['-e', `console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',exit_code:1,status:'completed',aggregated_output:'ERROR: quota exceeded'}}));`]), e => e.usageLimited === true);
});
