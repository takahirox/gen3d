import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Transformer } from '@napi-rs/image';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '../src/store.js';
import { Runner, taskPrompt } from '../src/runner.js';
import { referenceViews, referenceDecisions } from '../src/model-reference-visuals.js';
import { CodexModelInspector, validateComparison, categories } from '../src/refinement.js';

const png = fs.readFileSync('docs/validation/issue10/prop/concept-1/concept.png');
const tile = await Transformer.fromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384"><rect width="384" height="384" fill="white"/><rect x="80" y="60" width="220" height="260" fill="teal"/></svg>').resize(384, 384).png();
const blank = await Transformer.fromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384"><rect width="384" height="384" fill="white"/></svg>').resize(384, 384).png();
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen3d-visuals-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function context(t, count, failure) {
  const store = new Store(temporary(t));
  const p = store.create({ name: 'Visual references', mode: 'image', image: 'data:image/png;base64,' + png.toString('base64'), checkpoints: { input: false } }, 'web');
  const models = Array.from({ length: count }, (_, i) => ({ assetId: randomUUID(), name: `reference-${i}.glb`, role: `role-${i}`, permission: i ? 'reference-only' : 'reuse-edit', sha256: 'a'.repeat(64) }));
  store.library.jobFiles = () => models;
  const v = { id: randomUUID(), kind: 'generate', visualInput: p.inputImage, imageInputs: [p.inputImage], referenceIds: [], modelReferences: models, modelingImages: [], artifacts: {} };
  p.versions.push(v);
  const dir = path.join(store.dir(p.id), 'versions', v.id); fs.mkdirSync(dir, { recursive: true });
  const calls = [], attachments = [];
  const runner = new Runner(store, { processRunner: async (command, args) => {
    if (args[0] === 'login') return 'Logged in using ChatGPT';
    calls.push('codex'); attachments.push(...args.filter((arg, i) => args[i - 1] === '--image'));
    fs.writeFileSync(path.join(dir, 'mcp-audit.jsonl'), models.flatMap(m => [{ tool: 'inspect_reference_model', assetId: m.assetId }, { tool: 'choose_reference_usage', assetId: m.assetId, usage: 'visual-only', reason: 'Different requested topology; use visible role traits only.' }]).map(e => JSON.stringify(e)).join('\n'));
  }, blender: async (type, params) => {
    if (type !== 'execute_code') return {};
    calls.push(params.code);
    if (params.code.includes('refs.load_references')) fs.writeFileSync(path.join(dir, 'reference-load.json'), JSON.stringify(models));
    if (params.code.includes('refs.render_reference')) {
      const model = models.find(m => params.code.includes(m.assetId));
      if (failure === model.assetId) throw new Error('Renderer unavailable for this model');
      const folder = path.join(dir, 'reference-renders', model.assetId); fs.mkdirSync(folder, { recursive: true });
      const views = referenceViews.map(view => {
        fs.writeFileSync(path.join(folder, view + '.png'), failure === 'blank' ? blank : tile);
        return { view, image: view + '.png', direction: [0, -1, 0], center: [0, 0, 0], orthoScale: 2, projection: 'orthographic' };
      });
      if (failure === 'missing-view') views.pop();
      return { output: 'GEN3D_REFERENCE_VIEWS=' + JSON.stringify(views) };
    }
    if (params.code.includes('refs.validate_deliverable')) fs.writeFileSync(path.join(dir, 'reference-provenance.json'), '[]');
    return { output: '' };
  } });
  return { store, p, v, dir, runner, calls, attachments, models };
}

test('actual modeling arguments preserve the original input and every asset sheet at 0/1/4/32 selections', async t => {
  for (const count of [0, 1, 4, 32]) {
    const c = context(t, count);
    await c.runner.realGenerate(c.p, c.v, c.dir);
    assert.equal(c.attachments.length, count + 1);
    assert.equal(c.attachments[0], c.store.imageArtifact(c.p.id, c.p.inputImage));
    if (!count) { assert.ok(!c.calls.some(call => call.includes('load_references'))); continue; }
    const manifest = JSON.parse(fs.readFileSync(path.join(c.dir, 'model-references.json')));
    assert.equal(manifest.visuals.length, count); assert.equal(manifest.decisions.length, count);
    for (const [i, visual] of c.v.modelReferenceVisuals.entries()) {
      assert.equal(visual.assetId, c.models[i].assetId); assert.equal(visual.views.length, 8);
      const sheet = c.store.imageArtifact(c.p.id, visual.sheet);
      assert.equal(c.attachments[i + 1], sheet);
      const metadata = new Transformer(fs.readFileSync(sheet)).metadataSync();
      assert.equal(metadata.width, 1536); assert.equal(metadata.height, 884);
      for (const view of visual.views) c.store.imageArtifact(c.p.id, view.image);
    }
    // Revisions use the exact saved views for every role, with no new rendering.
    c.calls.length = 0; c.attachments.length = 0;
    await c.runner.realGenerate(c.p, c.v, c.dir);
    assert.equal(c.v.modelReferenceVisuals.length, count);
    assert.ok(!c.calls.some(call => call.includes('refs.render_reference')));
    fs.writeFileSync(c.store.artifact(c.p.id, c.v.modelReferenceVisuals[0].views[0].image), tile.subarray(0, 20));
    await assert.rejects(c.runner.realGenerate(c.p, c.v, c.dir), /Cannot visually inspect/);
  }
});

test('limits and incomplete reference renders block Codex without silently omitting assets', async t => {
  const tooMany = context(t, 33);
  await assert.rejects(tooMany.runner.realGenerate(tooMany.p, tooMany.v, tooMany.dir), /At most 32/);
  assert.equal(tooMany.calls.length, 0);
  const missing = context(t, 4, 'missing-view');
  await assert.rejects(missing.runner.realGenerate(missing.p, missing.v, missing.dir), /reference-0.glb.*incomplete 3D reference renders/);
  assert.ok(!missing.calls.includes('codex'));
  const invisible = context(t, 1, 'blank');
  await assert.rejects(invisible.runner.realGenerate(invisible.p, invisible.v, invisible.dir), /all reference views are blank/);
  assert.ok(!invisible.calls.includes('codex'));
});

test('large saved inspection metadata stays out of Blender protocol requests', async t => {
  const c = context(t, 1);
  c.models[0].inspection = { details: 'x'.repeat(2_100_000) };
  await c.runner.realGenerate(c.p, c.v, c.dir);
  assert.ok(c.calls.filter(call => call !== 'codex').every(code => code.length < 50000));
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.dir, 'model-references.json'))).models[0].inspection.details.length, 2_100_000);
});

test('scratch remains available while approved suitable starting geometry is preferred and decisions require real surviving reuse', t => {
  const c = context(t, 1);
  assert.doesNotMatch(taskPrompt(c.p, c.v), /Create mesh geometry from scratch/);
  assert.match(taskPrompt(c.p, c.v), /Prefer suitable approved existing mesh/);
  assert.match(taskPrompt(c.p, c.v), /shape keys, proportional editing/);
  c.v.modelReferences[0].permission = 'reference-only';
  assert.match(taskPrompt(c.p, c.v), /Create mesh geometry from scratch/);
  c.v.modelReferences = []; assert.match(taskPrompt(c.p, c.v), /Create mesh geometry from scratch/);
  const model = { assetId: 'a', name: 'Base', role: 'face', permission: 'reuse-edit', sha256: 'b'.repeat(64) };
  const audit = [{ tool: 'choose_reference_usage', assetId: 'a', usage: 'reuse', reason: 'Matches the face shape and stylized topology.' }];
  const provenance = [{ assetId: 'a', objectName: 'Head', targetObject: 'Adapted_head', method: 'reuse_reference_mesh', sha256: model.sha256 }];
  assert.throws(() => referenceDecisions([model], audit, []), /no permitted surviving geometry/);
  assert.equal(referenceDecisions([model], audit, provenance)[0].objects[0].targetObject, 'Adapted_head');
  assert.throws(() => referenceDecisions([{ ...model, permission: 'reference-only' }], audit, provenance), /no permitted/);
  assert.throws(() => referenceDecisions([model], [{ ...audit[0], usage: 'visual-only' }], provenance), /contradicts reused/);
  assert.throws(() => referenceDecisions([model], [], []), /Missing suitability/);
});

test('comparison attaches every role sheet and rejects missing, contradictory or mismatched role feedback', async t => {
  const dir = temporary(t), image = path.join(dir, 'input.png'); fs.writeFileSync(image, png);
  const models = ['face', 'hair', 'clothes', 'pose'].map(role => ({ assetId: randomUUID(), role, label: role + ' sheet', file: image }));
  const report = { acceptable: true, summary: 'Visible role traits agree.', revisionInstructions: [], revisionTargets: [],
    views: [{ view: 'input', observations: categories.map(category => ({ category, status: 'acceptable', detail: 'Agrees with primary design.' })) }],
    modelReferences: models.map(m => ({ assetId: m.assetId, role: m.role, intendedTraits: 'Only the assigned role guides this feature.', deliberateDifferences: 'Primary input colors take precedence.', observations: [{ trait: m.role, status: 'uncertain', detail: 'Partly hidden in the uploaded viewpoint.' }] })) };
  const inspector = new CodexModelInspector({ processRunner: async (command, args) => {
    if (args[0] === 'login') return 'ChatGPT';
    assert.equal(args.filter(a => a === '--image').length, 6);
    assert.match(fs.readFileSync(path.join(dir, 'COMPARISON.md'), 'utf8'), /pose source must not dictate skin colors/);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'comparison-schema.json'))).required.includes('modelReferences'));
    fs.writeFileSync(path.join(dir, 'comparison.json'), JSON.stringify(report));
  } });
  await inspector.inspect({ prompt: 'Stylized subject', profile: 'object', images: [{ file: image, label: 'original' }], modelReferences: models, renders: [{ file: image, label: 'output', view: 'input' }], dir });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'comparison-inputs.json'))).length, 6);
  for (const change of [r => r.modelReferences.pop(), r => r.modelReferences[0].role = 'wrong', r => r.modelReferences[0].observations[0].status = 'discrepancy']) {
    const bad = structuredClone(report); change(bad); assert.throws(() => validateComparison(bad, ['input'], 'object', models));
  }
  const discrepant = structuredClone(report); discrepant.acceptable = false; discrepant.revisionInstructions = ['Adapt face shape to the face role while preserving hair.']; discrepant.revisionTargets = ['geometry']; discrepant.modelReferences[0].observations[0].status = 'discrepancy';
  assert.equal(validateComparison(discrepant, ['input'], 'object', models).acceptable, false);
});

test('real MCP records suitability and denies reference-only reuse and reuse before inspection/decision', async t => {
  const dir = temporary(t), reference = randomUUID(), reusable = randomUUID();
  fs.writeFileSync(path.join(dir, 'model-references.json'), JSON.stringify({ models: [{ assetId: reference, permission: 'reference-only' }, { assetId: reusable, permission: 'reuse-edit' }] }));
  const requests = [], bridge = net.createServer(socket => {
    let data = ''; socket.on('data', chunk => { data += chunk; if (!data.includes('\n')) return;
      const request = JSON.parse(data.split('\n')[0]); requests.push(request);
      socket.end(JSON.stringify({ status: 'success', result: { object: 'Adapted_head', assetId: request.params.assetId, objectName: 'Head', method: 'reuse_reference_mesh' } }) + '\n');
    });
  });
  bridge.listen(0, '127.0.0.1'); await once(bridge, 'listening');
  const client = new Client({ name: 'reference-permissions', version: '1' });
  t.after(async () => { await client.close(); await new Promise(resolve => bridge.close(resolve)); });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/blender-mcp.js')], env: { ...process.env, GEN3D_BLENDER_PORT: String(bridge.address().port), GEN3D_AUDIT_DIR: dir }, stderr: 'pipe' }));
  const choose = assetId => client.callTool({ name: 'choose_reference_usage', arguments: { assetId, usage: 'reuse', reason: 'Suitable role-specific starting geometry.' } });
  const reuse = assetId => client.callTool({ name: 'reuse_reference_mesh', arguments: { assetId, objectName: 'Head' } });
  const execute = () => client.callTool({ name: 'execute_blender_code', arguments: { code: 'import bpy' } });
  assert.equal((await choose(reusable)).isError, true);
  assert.equal((await execute()).isError, true);
  for (const assetId of [reference, reusable]) await client.callTool({ name: 'inspect_reference_model', arguments: { assetId } });
  assert.equal((await execute()).isError, undefined);
  assert.equal((await choose(reference)).isError, true); assert.equal((await reuse(reference)).isError, true);
  assert.equal((await reuse(reusable)).isError, true);
  assert.equal((await choose(reusable)).isError, undefined); assert.equal((await reuse(reusable)).isError, undefined);
  assert.equal(requests.filter(r => r.type === 'reuse_reference').length, 1);
  const audit = fs.readFileSync(path.join(dir, 'mcp-audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(audit.at(-1).objectName, 'Head'); assert.equal(audit.at(-1).object, 'Adapted_head'); assert.equal(audit.filter(e => e.tool === 'choose_reference_usage').length, 1);
});
