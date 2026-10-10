import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '../src/store.js';
import { Runner, exportCode, taskPrompt } from '../src/runner.js';
import { createApp } from '../src/server.js';
import { refinementSettings, categories, anatomyCategories, validateComparison, CodexModelInspector } from '../src/refinement.js';

// Synthetic workflow fixtures, not evidence of real modeling/quality improvement.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const image = 'data:image/png;base64,' + png.toString('base64');
const defaults = { name: 'Test', mode: 'image', image, profile: 'object', refinementSettings: { enabled: true, maxIterations: 1 }, checkpoints: { concept: false, multiView: false, preview: false } };
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen3d-refinement-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function model(dir, v, { same = false, materialChanged = false, cameraChanged = false } = {}) {
  const scene = JSON.stringify({ asset: { version: '2.0' }, materials: [{ pbrMetallicRoughness: { baseColorFactor: materialChanged && v.refinementCycle ? [1, 0, 0, 1] : [0, 0, 1, 1] } }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }] });
  const json = Buffer.from(scene.padEnd(Math.ceil(scene.length / 4) * 4, ' '));
  const glb = Buffer.alloc(20 + json.length); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
  fs.writeFileSync(path.join(dir, 'model.glb'), glb);
  fs.writeFileSync(path.join(dir, 'scene.blend'), 'BLENDER-synthetic-' + (v.refinementCycle || 0));
  for (const name of ['preview', 'input', 'front', 'side', 'back', 'three-quarter']) fs.writeFileSync(path.join(dir, name + '.png'), png);
  fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify({ sha256: ((same || !v.refinementCycle) ? 'a' : 'b').repeat(64) }));
  fs.writeFileSync(path.join(dir, 'cameras.json'), JSON.stringify([{ view: 'input', direction: [0, -1, 0], projection: 'orthographic', center: [0, 0, 0], orthoScale: cameraChanged && v.refinementCycle ? 42 : 4 }]));
  fs.writeFileSync(path.join(dir, 'mcp-audit.jsonl'), JSON.stringify({ tool: 'execute_blender_code' }) + '\n');
}
function comparison(views = ['input'], profile = 'object', acceptable = true) {
  return { acceptable, summary: acceptable ? 'Observable features acceptable; hidden detail uncertain.' : 'Visible proportions differ.', revisionTargets: acceptable ? [] : ['geometry'], revisionInstructions: acceptable ? [] : ['Narrow the torso mesh by 20 percent; preserve the existing subject.'], views: views.map(view => ({ view, observations: [...categories, ...(profile === 'character' ? anatomyCategories : [])].map((category, i) => ({ category, status: !acceptable && i === 1 ? 'discrepancy' : 'acceptable', detail: category === 'proportions' && !acceptable ? 'Torso is visibly too wide.' : 'Visible design agrees.' })) })) };
}
function setup(t, options = {}, input = {}) {
  const store = new Store(temporary(t)), p = store.create({ ...defaults, ...input }, 'web');
  const runner = new Runner(store, { generate: async (p, v, dir) => model(dir, v), inspectModel: async ({ renders, profile }) => comparison(renders.map(r => r.view), profile), ...options });
  return { store, p, runner };
}
async function run(ctx) { ctx.runner.start(ctx.p.id, {}, 'web'); await ctx.runner.pending; return ctx.p.versions.at(-1); }

test('refinement defaults Off; settings validate, update atomically, persist across restart', t => {
  assert.deepEqual(refinementSettings(), { enabled: false, maxIterations: 2 });
  for (const bad of [null, [], { enabled: 1 }, { maxIterations: 0 }, { maxIterations: 6 }, { maxIterations: 1.5 }, { extra: true }]) assert.throws(() => refinementSettings(bad), /Refinement settings/);
  const { store, p } = setup(t);
  store.update(p.id, { refinementSettings: { maxIterations: 3 } }, 'mcp');
  assert.deepEqual(new Store(store.root).get(p.id).refinementSettings, { enabled: true, maxIterations: 3 });
  assert.throws(() => store.update(p.id, { name: 'changed', refinementSettings: { maxIterations: 9 } }, 'web'));
  assert.equal(p.name, 'Test');
});

test('Off skips inspection and preserves preview review and exports', async t => {
  for (const preview of [true, false]) {
    const ctx = setup(t, { inspectModel: () => { throw new Error('Must not inspect'); } }, { refinementSettings: { enabled: false }, checkpoints: { preview } });
    const v = await run(ctx); assert.equal(v.status, 'ready'); assert.equal(v.refinement.status, 'off'); assert.equal(v.refinement.iterations.length, 0);
    assert.equal(v.review, preview ? 'pending' : 'approved');
    if (preview) assert.throws(() => ctx.store.canExport(ctx.p.id, v.id), /Approve/); else assert.ok(ctx.store.canExport(ctx.p.id, v.id));
  }
});

test('model revisions use the copied existing scene, re-evaluate fresh renders and retain source history', async t => {
  for (const profile of ['object', 'character']) {
    let calls = 0, initialScene;
    const ctx = setup(t, { generate: async (p, v, dir) => {
      if (v.refinementCycle) {
        assert.equal(v.kind, 'revision'); assert.equal(fs.readFileSync(path.join(dir, 'source.blend'), 'utf8'), initialScene);
        assert.match(fs.readFileSync(path.join(dir, 'REVISION.md'), 'utf8'), /Narrow the torso/);
        assert.match(taskPrompt(p, v), /SAME scene lineage/);
      }
      model(dir, v); if (!v.refinementCycle) initialScene = fs.readFileSync(path.join(dir, 'scene.blend'), 'utf8');
    }, inspectModel: async ({ images, renders, profile }) => {
      assert.equal(images[0].file, path.join(ctx.store.dir(ctx.p.id), ctx.p.inputImage)); assert.equal(renders.length, 1);
      return comparison(['input'], profile, calls++ > 0);
    } }, { profile, checkpoints: { preview: true } });
    const v = await run(ctx);
    assert.equal(v.refinement.status, 'passed'); assert.equal(calls, 2); assert.equal(v.refinement.iterations[1].geometryChanged, true);
    assert.equal(v.review, 'pending'); assert.match(v.artifacts.blend, /refinement\/1\/scene.blend/);
    const [first, second] = v.refinement.iterations;
    assert.equal(fs.readFileSync(ctx.store.artifact(ctx.p.id, first.artifacts['scene.blend']), 'utf8'), initialScene);
    assert.notEqual(first.artifacts['input.png'], second.artifacts['input.png']);
    assert.match(fs.readFileSync(ctx.store.artifact(ctx.p.id, second.artifacts['REVISION.md']), 'utf8'), /Narrow/);
    assert.equal(new Store(ctx.store.root).get(ctx.p.id).versions[0].refinement.status, 'passed');
    assert.throws(() => ctx.store.reviewVersion(ctx.p.id, v.id, 'approved', 'mcp'), /web UI/);
  }
});

test('bounded discrepancies terminate at cycle cap; immediate pass does not revise', async t => {
  let calls = 0;
  const ctx = setup(t, { inspectModel: async () => { calls++; return comparison(['input'], 'object', false); } });
  const v = await run(ctx); assert.equal(v.status, 'ready'); assert.equal(v.refinement.status, 'iteration-limit'); assert.equal(calls, 2); assert.match(v.refinement.error, /no quality improvement/);
  const passing = await run(setup(t)); assert.equal(passing.refinement.status, 'passed'); assert.equal(passing.refinement.iterations.length, 1);
});

test('material-only and camera-only revisions re-evaluate without claiming geometry changes', async t => {
  for (const target of ['materials', 'camera']) {
    for (const profile of ['object', 'character']) {
      let inspections = 0;
      const ctx = setup(t, { generate: async (p, v, dir) => {
        model(dir, v, { same: true, materialChanged: target === 'materials', cameraChanged: target === 'camera' });
        if (v.refinementCycle) {
          assert.match(taskPrompt(p, v), /mesh changes are required only for geometry corrections/);
          assert.match(fs.readFileSync(path.join(dir, 'REVISION.md'), 'utf8'), new RegExp(`Required changes: ${target}`));
        }
      }, inspectModel: async ({ dir }) => {
        const report = comparison(['input'], profile, inspections++ > 0);
        report.revisionTargets = report.acceptable ? [] : [target];
        if (!report.acceptable) {
          report.views[0].observations.forEach(o => o.status = 'acceptable');
          const observation = report.views[0].observations.find(o => o.category === (target === 'materials' ? 'colorsMaterials' : 'silhouette'));
          observation.status = 'discrepancy'; observation.detail = target === 'materials' ? 'Body should be red.' : 'Camera crops the silhouette.';
          report.revisionInstructions = [target === 'materials' ? 'Make the existing material red.' : 'Set input camera orthoScale to 42.'];
        } else if (target === 'camera') assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'cameras.json')))[0].orthoScale, 42);
        return report;
      } }, { profile });
      const v = await run(ctx), cycle = v.refinement.iterations[1];
      assert.equal(v.refinement.status, 'passed'); assert.equal(inspections, 2);
      assert.equal(cycle.geometryChanged, false); assert.equal(cycle[target + 'Changed'], true);
      assert.deepEqual(cycle.revisionTargets, [target]); assert.ok(cycle.artifacts['materials.json']);
      assert.match(v.artifacts.blend, /refinement\/1\/scene.blend/);
    }
  }
});

test('revision verification requires every requested change and rejects irrelevant changes or absent evidence', async t => {
  for (const branch of ['materials', 'camera', 'mixed', 'camera-missing', 'camera-invalid']) {
    let inspections = 0;
    const targets = branch === 'mixed' ? ['geometry', 'materials'] : [branch.startsWith('camera') ? 'camera' : 'materials'];
    const ctx = setup(t, { generate: async (p, v, dir) => {
      model(dir, v); // Geometry changes cannot stand in for missing material/camera changes.
      if (v.refinementCycle && branch === 'camera-missing') fs.unlinkSync(path.join(dir, 'cameras.json'));
      if (v.refinementCycle && branch === 'camera-invalid') fs.writeFileSync(path.join(dir, 'cameras.json'), '[]');
    }, inspectModel: async () => { inspections++; return { ...comparison(['input'], 'object', false), revisionTargets: targets }; } });
    const v = await run(ctx);
    assert.equal(v.refinement.status, 'failed'); assert.equal(inspections, 1);
    assert.equal(v.review, 'pending'); assert.doesNotMatch(v.artifacts.blend, /refinement/);
    assert.match(v.refinement.error, /no verified|camera evidence|ENOENT/);
  }
});

test('inspection/modeling/usage/no-change failures retain validated model and partial files without automatic retries', async t => {
  for (const branch of ['inspection', 'modeling', 'usage', 'same', 'missing-view']) {
    let inspections = 0, generations = 0;
    const ctx = setup(t, { generate: async (p, v, dir) => {
      generations++; model(dir, v, { same: branch === 'same' });
      if (v.refinementCycle && branch === 'modeling') throw new Error('Blender revision failed');
      if (v.refinementCycle && branch === 'missing-view') fs.unlinkSync(path.join(dir, 'input.png'));
    }, inspectModel: async ({ profile }) => {
      inspections++;
      if (branch === 'inspection') throw new Error('Inspection failed');
      if (branch === 'usage') throw Object.assign(new Error('Codex usage limit reached'), { usageLimited: true });
      return comparison(['input'], profile, false);
    } });
    const v = await run(ctx); assert.equal(v.status, 'ready'); assert.equal(v.review, 'pending'); assert.equal(v.checkpoints.preview, true);
    assert.equal(v.refinement.status, branch === 'usage' ? 'usage-limit' : 'failed'); assert.ok(v.refinement.error); assert.ok(ctx.store.artifact(ctx.p.id, v.artifacts.blend));
    assert.ok(v.refinement.iterations.at(-1).artifacts['scene.blend']);
    if (branch === 'usage') { assert.equal(ctx.runner.usageLimited, true); assert.throws(() => ctx.runner.start(ctx.p.id, {}, 'web'), /usage limit/); }
    assert.equal(inspections, 1); assert.equal(generations, ['inspection', 'usage'].includes(branch) ? 1 : 2);
  }
});

test('initial failure and restart retain partial cycle artifacts and never resume automatically', async t => {
  const ctx = setup(t, { generate: async (p, v, dir) => { model(dir, v); throw new Error('Initial model failed'); } });
  const v = await run(ctx); assert.equal(v.status, 'failed'); assert.equal(v.refinement.status, 'failed');
  assert.ok(ctx.store.artifact(ctx.p.id, v.refinement.iterations[0].artifacts['input.png']));
  v.status = 'running'; v.refinement.status = 'running'; v.refinement.iterations[0].status = 'running'; ctx.store.save(ctx.p);
  const recovered = new Store(ctx.store.root).get(ctx.p.id).versions[0];
  assert.equal(recovered.status, 'failed'); assert.equal(recovered.refinement.status, 'interrupted'); assert.equal(recovered.refinement.iterations[0].status, 'interrupted');
  assert.deepEqual(recovered.refinement.iterations[0].artifacts, v.refinement.iterations[0].artifacts);
});

test('human review interrupts at operation boundaries and remains authoritative even when preview setting was Off', async t => {
  for (const stage of ['modeling', 'comparing', 'revising']) {
    let release, entered; const gate = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; }); let comparisons = 0;
    const ctx = setup(t, { generate: async (p, v, dir) => { model(dir, v); if (stage === 'modeling' && !v.refinementCycle || stage === 'revising' && v.refinementCycle) { entered(); await gate; } }, inspectModel: async () => { comparisons++; if (stage === 'comparing') { entered(); await gate; } return comparison(['input'], 'object', false); } });
    ctx.runner.start(ctx.p.id, {}, 'web'); await started;
    const v = ctx.p.versions[0]; assert.throws(() => ctx.runner.requestRefinementReview(ctx.p.id, v.id, 'mcp'), /web UI/);
    ctx.runner.requestRefinementReview(ctx.p.id, v.id, 'web'); release(); await ctx.runner.pending;
    assert.equal(v.status, 'ready'); assert.equal(v.refinement.status, 'review-requested'); assert.equal(v.review, 'pending'); assert.equal(v.checkpoints.preview, true);
    assert.throws(() => ctx.store.canExport(ctx.p.id, v.id), /Approve/); assert.equal(comparisons, stage === 'modeling' ? 0 : 1);
    assert.throws(() => ctx.runner.start(ctx.p.id, {}, 'web'), /Review the 3D preview/);
  }
});

test('multi-view original concept, all labeled views and approved supplementary images reach every comparison', async t => {
  let calls = 0;
  const generator = { generate: async () => ({ bytes: png, ext: 'png' }), generateViews: async ({ onImage }) => { for (const view of ['front', 'side', 'back', 'three-quarter']) await onImage({ view, side: view === 'side' ? 'right' : undefined, bytes: png, ext: 'png' }); } };
  const ctx = setup(t, { conceptGenerator: generator, inspectReferences: async () => ({ consistent: true, issues: [] }), inspectModel: async ({ images, renders }) => {
    calls++; assert.equal(images.length, 6); assert.equal(images[2].label, 'right side'); assert.deepEqual(renders.map(r => r.view), ['front', 'side', 'back', 'three-quarter']);
    assert.ok(images[0].file.endsWith('concept.png')); return comparison(renders.map(r => r.view), 'object', calls > 1);
  } }, { mode: 'text', prompt: 'A kettle', profile: 'object' });
  ctx.store.addReference(ctx.p.id, { label: 'Material', image }, 'web'); ctx.store.reviewReference(ctx.p.id, ctx.p.references[0].id, 'approved', 'web');
  const v = await run(ctx); assert.equal(v.refinement.status, 'passed'); assert.equal(calls, 2);
  for (const c of v.refinement.iterations) { assert.deepEqual(c.imageInputs, v.imageInputs); assert.equal(c.referenceFingerprint, v.referenceFingerprint); }
  const code = exportCode('/tmp/job', v); assert.match(code, /view_labels = \["front","side","back","three-quarter"\]/); assert.match(code, /gen3d_reference_camera_directions/); assert.match(taskPrompt(ctx.p, v), /Inspect each original view/);
});

test('comparison validation requires every view/category, truthful verdict and uncertainty for hidden detail', () => {
  const valid = comparison(); valid.views[0].observations[3].status = 'uncertain'; assert.equal(validateComparison(valid, ['input'], 'object'), valid);
  for (const mutate of [r => r.views.pop(), r => r.views[0].observations.pop(), r => r.revisionInstructions.push('Change mesh'), r => r.acceptable = false, r => r.views[0].observations.forEach(o => o.status = 'uncertain')]) {
    const bad = comparison(); mutate(bad); assert.throws(() => validateComparison(bad, ['input'], 'object'));
  }
  assert.throws(() => validateComparison(comparison(), ['input'], 'character'));
  for (const targets of [undefined, null, ['unknown'], ['camera', 'camera'], ['materials']]) assert.throws(() => validateComparison({ ...comparison(), revisionTargets: targets }, ['input'], 'object'), /revision targets/);
  assert.throws(() => validateComparison({ ...comparison(['input'], 'object', false), revisionTargets: [] }, ['input'], 'object'), /revision targets/);
});

test('real inspector invocation attaches references and renders together, saves bounded schema and has no Blender tools', async t => {
  const dir = temporary(t), images = [{ label: 'approved input', file: path.join(dir, 'original.png') }], renders = [{ view: 'input', label: 'model input view', file: path.join(dir, 'render.png') }];
  fs.writeFileSync(images[0].file, png); fs.writeFileSync(renders[0].file, png);
  const inspector = new CodexModelInspector({ env: { OPENAI_API_KEY: 'must-be-removed' }, processRunner: async (command, args, opts) => {
    assert.equal(opts.env.OPENAI_API_KEY, undefined);
    if (args[0] === 'login') return 'Logged in using ChatGPT';
    assert.ok(args.includes('read-only')); assert.ok(args.includes('--ignore-user-config')); assert.ok(!args.some(a => a.includes('mcp_servers')));
    assert.deepEqual(args.filter((a, i) => args[i - 1] === '--image'), [images[0].file, renders[0].file]);
    assert.match(fs.readFileSync(path.join(dir, 'COMPARISON.md'), 'utf8'), /unseen detail is uncertain/);
    fs.writeFileSync(path.join(dir, 'comparison.json'), JSON.stringify(comparison()));
  } });
  assert.equal((await inspector.inspect({ prompt: 'Input', profile: 'object', images, renders, dir })).acceptable, true);
});

test('HTTP and real MCP clients share settings, cycles, image artifacts, reports and review gates', async t => {
  const instance = createApp({ dataDir: temporary(t), generate: async (p, v, dir) => model(dir, v), inspectModel: async () => comparison() });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  const url = `http://127.0.0.1:${instance.server.address().port}`;
  const client = new Client({ name: 'refinement-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.js'], env: { ...process.env, GEN3D_URL: url } }));
  t.after(async () => { await client.close(); await instance.runner.pending; await new Promise(r => instance.server.close(r)); await instance.closed; });
  const p = JSON.parse((await client.callTool({ name: 'create_project', arguments: { ...defaults, checkpoints: { preview: true } } })).content[0].text);
  assert.deepEqual(p.refinementSettings, defaults.refinementSettings);
  await client.callTool({ name: 'update_project', arguments: { projectId: p.id, refinementSettings: { maxIterations: 2 } } });
  assert.equal((await (await fetch(url + '/api/projects/' + p.id)).json()).refinementSettings.maxIterations, 2);
  await client.callTool({ name: 'generate_model', arguments: { projectId: p.id } }); await instance.runner.pending;
  const shared = JSON.parse((await client.callTool({ name: 'get_project', arguments: { projectId: p.id } })).content[0].text), v = shared.versions[0];
  assert.equal(v.refinement.status, 'passed'); assert.ok(shared.activity.some(e => e.type === 'model_compared'));
  assert.equal(v.review, 'pending');
  assert.ok((await client.callTool({ name: 'review_model', arguments: { projectId: p.id, versionId: v.id, decision: 'approved' } })).isError);
  assert.equal((await fetch(url + `/api/projects/${p.id}/artifacts/${v.artifacts.blend}?download=1`)).status, 409);
  const file = v.refinement.iterations[0].artifacts['input.png'];
  const result = await client.callTool({ name: 'get_artifact_image', arguments: { projectId: p.id, file } }); assert.equal(result.content[0].type, 'image');
  assert.equal((await fetch(url + `/api/projects/${p.id}/artifacts/${v.refinement.iterations[0].artifacts['comparison.json']}`)).status, 200);
  const absent = await client.callTool({ name: 'get_artifact_image', arguments: { projectId: p.id, file: '../../outside.png' } }); assert.ok(absent.isError);
});


test('in-progress partial renders are published and job settings cannot race an active cycle', async t => {
  let entered, release;
  const ready = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; });
  const ctx = setup(t, { generate: async (p, v, dir) => { fs.writeFileSync(path.join(dir, 'input.png'), png); entered(); await gate; model(dir, v); } });
  ctx.runner.start(ctx.p.id, {}, 'web'); await ready;
  try {
    const v = ctx.p.versions[0];
    const deadline = Date.now() + 3000;
    while (!v.refinement.iterations[0].artifacts['input.png'] && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    assert.equal(v.status, 'running'); assert.equal(v.refinement.iterations[0].stage, 'modeling');
    const file = v.refinement.iterations[0].artifacts['input.png'];
    assert.deepEqual(fs.readFileSync(ctx.store.imageArtifact(ctx.p.id, file)), png);
    assert.throws(() => ctx.store.update(ctx.p.id, { refinementSettings: { enabled: false } }, 'web'), /Wait/);
    assert.equal(v.refinementSettings.enabled, true);
  } finally { release(); await ctx.runner.pending; }
});

test('existing input/concept/multi-view checkpoints block enabled refinement and cannot be approved by MCP', async t => {
  let models = 0, inspections = 0;
  const ctx = setup(t, { generate: async (p, v, dir) => { models++; model(dir, v); }, inspectModel: async () => { inspections++; return comparison(['front', 'side', 'back', 'three-quarter']); },
    conceptGenerator: { generate: async () => ({ bytes: png, ext: 'png' }), generateViews: async ({ onImage }) => { for (const view of ['front', 'side', 'back', 'three-quarter']) await onImage({ view, side: view === 'side' ? 'left' : undefined, bytes: png, ext: 'png' }); } }, inspectReferences: async () => ({ consistent: true, issues: [] })
  }, { mode: 'text', prompt: 'A kettle', checkpoints: { input: true, concept: true, multiView: true, preview: true } });
  assert.throws(() => ctx.runner.start(ctx.p.id, {}, 'web'), /Review the input/);
  ctx.store.reviewInput(ctx.p.id, 'approved', 'web');
  ctx.runner.start(ctx.p.id, {}, 'web'); await ctx.runner.pending;
  assert.equal(models, 0); assert.equal(inspections, 0);
  assert.throws(() => ctx.runner.reviewConcept(ctx.p.id, ctx.p.concepts[0].id, 'approved', 'mcp'), /web UI/);
  ctx.runner.reviewConcept(ctx.p.id, ctx.p.concepts[0].id, 'approved', 'web'); await ctx.runner.pending;
  assert.equal(models, 0); assert.equal(inspections, 0);
  assert.throws(() => ctx.runner.reviewReferenceSet(ctx.p.id, ctx.p.referenceSets[0].id, 'approved', 'mcp'), /web UI/);
  ctx.runner.reviewReferenceSet(ctx.p.id, ctx.p.referenceSets[0].id, 'approved', 'web'); await ctx.runner.pending;
  assert.equal(models, 1); assert.equal(inspections, 1); assert.equal(ctx.p.versions[0].review, 'pending');
});


test('real modeling clears camera metadata for consecutive projects and retry, preserving it for revisions', async t => {
  const preparations = [];
  const ctx = setup(t, { generate: undefined,
    processRunner: async (command, args) => args[0] === 'login' ? 'Logged in using ChatGPT' : 'done',
    blender: async (command, { code } = {}) => {
      if (command !== 'execute_code') return {};
      if (code.includes('export_scene.gltf')) {
        const dir = JSON.parse(code.match(/^out = (.+)$/m)[1]);
        model(dir, {});
      } else preparations.push(code);
      return {};
    }
  }, { refinementSettings: { enabled: false } });
  assert.equal((await run(ctx)).status, 'ready');
  const next = ctx.store.create({ ...defaults, refinementSettings: { enabled: false } }, 'web');
  assert.equal((await run({ ...ctx, p: next })).status, 'ready');
  ctx.runner.start(next.id, { kind: 'retry' }, 'web'); await ctx.runner.pending;
  assert.equal(next.versions.at(-1).status, 'ready');
  ctx.runner.start(next.id, { kind: 'revision', sourceVersionId: next.versions.at(-1).id, feedback: 'Adjust framing' }, 'web'); await ctx.runner.pending;
  assert.equal(next.versions.at(-1).status, 'ready');
  assert.equal(preparations.length, 4);
  for (const code of preparations.slice(0, 3)) {
    for (const property of ['direction', 'directions', 'framing']) {
      assert.ok(code.includes(`del bpy.context.scene['gen3d_reference_camera_${property}']`));
    }
    assert.doesNotMatch(code, /open_mainfile/);
  }
  assert.match(preparations[3], /open_mainfile.*source\.blend/);
  assert.doesNotMatch(preparations[3], /del bpy\.context\.scene/);
});

test('a real runner modeling usage failure saves available Blender work once without retrying Codex or masking its error', async t => {
  for (const exportFails of [false, true]) {
    let turns = 0, exports = 0;
    const ctx = setup(t, { generate: undefined, processRunner: async (command, args) => {
      if (args[0] === 'login') return 'Logged in using ChatGPT';
      turns++; throw Object.assign(new Error('Codex usage limit reached'), { usageLimited: true });
    }, blender: async (command, { code } = {}) => {
      if (code?.includes('export_scene.gltf')) {
        exports++;
        if (exportFails) throw new Error('Partial export unavailable');
        const dir = JSON.parse(code.match(/^out = (.+)$/m)[1]); model(dir, ctx.p.versions[0]);
      }
      return {};
    } });
    const v = await run(ctx); assert.equal(turns, 1); assert.equal(exports, 1); assert.equal(v.status, 'failed');
    assert.equal(v.error, 'Codex usage limit reached'); assert.equal(v.refinement.status, 'usage-limit'); assert.equal(ctx.runner.usageLimited, true);
    const files = v.refinement.iterations[0].artifacts;
    assert.ok(exportFails ? files['partial-export-error.json'] : files['scene.blend']);
    assert.throws(() => ctx.runner.start(ctx.p.id, {}, 'web'), /usage limit/);
  }
});
