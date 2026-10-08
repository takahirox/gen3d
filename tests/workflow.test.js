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
import { Runner, subscriptionEnv, codexArgs, validateArtifacts, runProcess } from '../src/runner.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
const image = 'data:image/png;base64,' + png.toString('base64');
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
  const instance = createApp({ dataDir, generate });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  t.after(async () => { await instance.runner.pending; await new Promise(resolve => instance.server.close(resolve)); });
  const url = `http://127.0.0.1:${instance.server.address().port}`;
  async function request(route, method = 'GET', data, headers = {}) {
    const res = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, data: await res.json() };
  }
  return { ...instance, url, request, dataDir };
}
const input = { name: 'Robot', mode: 'text', prompt: 'A teal robot' };

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
  const runner = new Runner(store, { generate: async (p, v, dir) => artifacts(dir) });
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
  const runner = new Runner(store, { generate: async (p, v, dir) => { if (v.kind === 'revision') assert.equal(fs.readFileSync(path.join(dir, 'source.blend'), 'utf8'), 'BLENDER-test-fixture'); artifacts(dir); } });
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
  const runner = new Runner(store, { generate: async (p, v, dir) => { await barrier; artifacts(dir); } });
  runner.start(p.id, {}, 'web');
  assert.throws(() => runner.start(p2.id, {}, 'mcp'), /another version/);
  assert.throws(() => store.update(p.id, { prompt: 'changed' }, 'mcp'), /Wait/);
  assert.throws(() => store.addReference(p.id, { label: 'late', image }, 'web'), /Wait/);
  release(); await runner.pending; assert.equal(runner.active, false);
});

test('failures retain useful history, retry gets a new folder and usage limits stop subsequent jobs', async t => {
  let calls = 0;
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  const runner = new Runner(store, { generate: async (p, v, dir) => { if (++calls === 1) throw new Error('Blender disconnected'); artifacts(dir); } });
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
  const runner = new Runner(store, { generate: async (p, v, dir) => { artifacts(dir); fs.writeFileSync(path.join(dir, 'mcp-audit.jsonl'), '{"tool":"get_scene_info"}\n'); } });
  runner.start(p.id, {}, 'web'); return runner.pending.then(() => { assert.equal(p.versions[0].status, 'failed'); assert.match(p.versions[0].error, /No successful/); });
});
