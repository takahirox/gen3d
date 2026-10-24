import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Runner } from '../src/runner.js';
import { WorkflowEngine, workflowPreset, validateGraph, hash } from '../src/workflow.js';
import { workflowOperations } from '../src/workflow-operations.js';
import { createApp } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { once } from 'node:events';
import { authorizeBase, editScope } from '../src/base-model.js';
import { categories } from '../src/refinement.js';

const fixture = path.resolve('docs/validation/issue10/prop');
const png = fs.readFileSync(path.join(fixture, 'concept-1/concept.png'));
const off = { input: false, concept: false, multiView: false, preview: false };
function setup(t, { mode = 'image', checkpoints = off, inspect, failViews = false, refinement = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen3d-graph-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root), calls = [];
  const p = store.create({ name: 'Graph test', mode, prompt: 'A teal cabinet', ...(mode === 'image' ? { image: 'data:image/png;base64,' + png.toString('base64') } : {}), checkpoints, refinementSettings: { enabled: refinement, maxIterations: 1 } }, 'web');
  const runner = new Runner(store, {
    conceptGenerator: {
      async generate() { calls.push('concept'); return { ext: 'png', bytes: png }; },
      async generateViews({ onImage }) { calls.push('views'); if (failViews) throw new Error('Views unavailable'); for (const view of ['front', 'side', 'back', 'three-quarter']) await onImage({ view, side: view === 'side' ? 'left' : undefined, ext: 'png', bytes: png }); }
    },
    inspectReferences: async () => { calls.push('consistency'); return inspect || { consistent: true, issues: [] }; },
    inspectModel: async ({ dir, renders }) => { calls.push('compare'); const acceptable = path.basename(dir) === '1'; return { acceptable, summary: 'Synthetic comparison', revisionTargets: acceptable ? [] : ['geometry'], revisionInstructions: acceptable ? [] : ['Change geometry'], views: renders.map(r => ({ view: r.view, observations: categories.map((category, i) => ({ category, status: !acceptable && i === 0 ? 'discrepancy' : 'acceptable', detail: 'Synthetic scheduler evidence' })) })) }; },
    generate: async (project, v, dir) => { calls.push('model'); for (const file of ['model.glb', 'scene.blend', 'preview.png', 'mcp-audit.jsonl']) fs.copyFileSync(path.join(fixture, 'model-1', file), path.join(dir, file));
      if (v.refinementSettings.enabled) { fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify({ sha256: (v.refinementCycle ? 'b' : 'a').repeat(64) })); fs.writeFileSync(path.join(dir, 'cameras.json'), '[]'); for (const view of ['input', 'front', 'side', 'back', 'three-quarter']) fs.copyFileSync(path.join(fixture,'model-1/preview.png'), path.join(dir,view+'.png')); }
    }
  });
  const engine = new WorkflowEngine(store, runner, workflowOperations(store, runner));
  const run = async input => { engine.start(p.id, input, 'web'); await runner.pending; return p.workflowRuns.at(-1); };
  return { root, store, runner, engine, p, calls, run };
}

test('graph contracts reject cycles, incompatible/duplicate ports, unknown settings and missing dependencies', () => {
  for (const kind of ['object', 'humanoid']) assert.equal(validateGraph(workflowPreset(kind)).graph.nodes.length, kind === 'object' ? 9 : 10);
  const invalid = change => { const g = workflowPreset(); change(g); assert.throws(() => validateGraph(g)); };
  invalid(g => g.edges.pop());
  invalid(g => g.edges.push({ from: 'input', to: 'review', input: 'model' }));
  invalid(g => g.edges.push(g.edges[0]));
  invalid(g => g.nodes[0].settings = { shell: 'anything' });
  invalid(g => g.nodes.find(n => n.type === 'refine').settings.maxIterations = 100);
  invalid(g => g.nodes.push({ id: 'unused', type: 'input' }));
  invalid(g => { g.edges = g.edges.filter(e => e.to !== 'refine'); g.edges.push({ from: 'refine', to: 'refine', input: 'model' }); });
});

test('actual adapter execution follows graph edges, saves typed artifacts and restart-persistent presets/runs', async t => {
  const c = setup(t, { mode: 'text' });
  const g = workflowPreset(); g.nodes.reverse(); c.engine.saveGraph(c.p.id, g, 'web');
  const r = await c.run(); assert.equal(r.status, 'completed', r.error);
  assert.deepEqual(c.calls, ['concept', 'views', 'consistency', 'model']);
  assert.equal(r.checkpoints.length, 9);
  for (const cp of r.checkpoints) { assert.equal(cp.graphRevision, 2); assert.ok(cp.recordHash); c.engine.checkpoint(c.p, r, cp.id); }
  assert.equal(c.p.versions.length, 1); assert.equal(c.p.acceptedVersionId, c.p.versions[0].id);
  const preset = c.engine.savePreset({ name: 'My duplicate', graph: g });
  const restarted = new Store(c.root), e = new WorkflowEngine(restarted, new Runner(restarted), {});
  assert.equal(e.presets().find(p => p.id === preset.id).name, 'My duplicate');
  assert.equal(restarted.get(c.p.id).workflowRuns[0].status, 'completed');
  assert.equal(restarted.canExport(c.p.id, c.p.versions[0].id).review, 'approved');
});

test('fork reuses only selected valid ancestors and changed downstream nodes execute into new candidates', async t => {
  const c = setup(t, { mode: 'text' }); const original = await c.run();
  assert.equal(original.status, 'completed', original.error);
  const before = hash(original), firstVersion = structuredClone(c.p.versions[0]);
  const cp = original.checkpoints.find(cp => cp.nodeId === 'consistency');
  const g = structuredClone(c.p.workflow); g.nodes.find(n => n.type === 'model').settings.instructions = 'Longer cabinet';
  c.engine.saveGraph(c.p.id, g, 'web'); const child = await c.run({ runId: original.id, checkpointId: cp.id });
  assert.equal(child.status, 'completed', child.error); assert.equal(child.nodes.consistency.reusedFrom, original.id);
  assert.deepEqual(c.calls, ['concept', 'views', 'consistency', 'model', 'model']);
  assert.equal(c.p.versions.length, 2); assert.deepEqual(c.p.versions[0], firstVersion); assert.equal(hash(original), before);
  assert.notEqual(c.p.versions[0].artifacts.glb, c.p.versions[1].artifacts.glb);
  assert.equal(child.parentCheckpointId, cp.id);
});

test('rewiring typed dependencies changes real execution; removing refine omits the composite', async t => {
  const c = setup(t); const g = workflowPreset();
  g.nodes = g.nodes.filter(n => n.type !== 'refine'); g.edges = g.edges.filter(e => e.from !== 'refine' && e.to !== 'refine');
  g.edges.push({ from: 'model', to: 'review', input: 'model' }); c.engine.saveGraph(c.p.id, g, 'web');
  const r = await c.run(); assert.equal(r.status, 'completed', r.error); assert.equal(r.nodes.refine, undefined);
});

test('upstream settings/input edits invalidate checkpoints and tampered artifacts block reuse/export', async t => {
  const c = setup(t, { mode: 'text' }); const original = await c.run();
  const cp = original.checkpoints.find(cp => cp.nodeId === 'consistency');
  const graph = structuredClone(c.p.workflow); graph.nodes.find(n => n.type === 'concept').settings.feedback = 'New design';
  c.engine.saveGraph(c.p.id, graph, 'web');
  assert.throws(() => c.engine.start(c.p.id, { runId: original.id, checkpointId: cp.id }), /upstream/);
  c.engine.saveGraph(c.p.id, workflowPreset(), 'web');
  c.store.update(c.p.id, { prompt: 'A changed prompt' }, 'web');
  assert.throws(() => c.engine.start(c.p.id, { runId: original.id, checkpointId: cp.id }), /upstream/);
  const image = original.checkpoints.find(cp => cp.nodeId === 'concept').data.file;
  fs.appendFileSync(c.store.artifact(c.p.id, image), 'tamper');
  assert.throws(() => c.engine.checkpoint(c.p, original, cp.id), /changed/);
  assert.throws(() => c.store.canExport(c.p.id, c.p.versions[0].id), /changed/);
});

test('human approvals cannot be bypassed by MCP, settings, forks or restart', async t => {
  const c = setup(t, { mode: 'text', checkpoints: { ...off, concept: true, preview: true } });
  const r = await c.run(); assert.equal(r.status, 'waiting-review'); assert.deepEqual(c.calls, ['concept']);
  assert.throws(() => c.engine.review(c.p.id, r.id, 'concept', 'approved', 'mcp'), /human/);
  c.store.update(c.p.id, { checkpoints: off }, 'web');
  assert.throws(() => c.engine.start(c.p.id, { runId: r.id, checkpointId: r.checkpoints[0].id }), /pending/);
  const restarted = new Store(c.root); assert.equal(restarted.get(c.p.id).workflowRuns[0].status, 'waiting-review');
  c.engine.review(c.p.id, r.id, 'concept', 'approved', 'web'); await c.runner.pending;
  assert.equal(r.status, 'waiting-review'); assert.equal(r.nodes.review.status, 'waiting-review');
  const v = c.p.versions.at(-1);
  assert.throws(() => c.store.canExport(c.p.id, v.id), /Approve/);
  c.engine.review(c.p.id, r.id, 'review', 'approved', 'web'); await c.runner.pending;
  assert.equal(r.status, 'completed', r.error); assert.ok(c.store.canExport(c.p.id, v.id));
});

test('consistency blockers and partial failed views never become reusable modeling checkpoints', async t => {
  for (const options of [{ inspect: { consistent: false, issues: ['Different feet'] } }, { failViews: true }]) {
    const c = setup(t, { mode: 'text', ...options }); const r = await c.run(); assert.equal(r.status, 'failed'); assert.ok(!c.calls.includes('model'));
    assert.ok(!r.checkpoints.some(cp => cp.nodeId === 'consistency'));
    assert.equal(c.p.versions.length, 0);
  }
});

test('restart marks interrupted running nodes, preserves completed checkpoints and never auto-resumes', async t => {
  const c = setup(t); const r = await c.run(); r.status = 'running'; r.nodes.output.status = 'running'; c.store.save(c.p);
  const restarted = new Store(c.root), r2 = restarted.get(c.p.id).workflowRuns[0];
  assert.equal(r2.status, 'interrupted'); assert.equal(r2.nodes.output.status, 'interrupted'); assert.equal(r2.nodes.model.status, 'completed');
});

test('base scope is explicit and human-only; humanoid run blocks missing authorization', async t => {
  assert.throws(() => editScope({ editableObjects: [] })); assert.throws(() => editScope({ editableObjects: ['Hair'], allowChanges: ['everything'] }));
  assert.deepEqual(editScope({ editableObjects: ['Hair'] }).allowChanges, []);
  const c = setup(t); c.engine.saveGraph(c.p.id, workflowPreset('humanoid'), 'web');
  await assert.rejects(authorizeBase(c.store, c.p.id, { assetId: 'fake', scope: { editableObjects: ['Hair'] } }, 'mcp'), /human/);
  assert.throws(() => c.engine.start(c.p.id), /authorize/);
});

test('usage limit stops scheduler and blocks automatic/new attempts without switching allowance', async t => {
  const c = setup(t); c.runner.generate = async () => { const error = new Error('Allowance exhausted'); error.usageLimited = true; throw error; };
  const r = await c.run(); assert.equal(r.status, 'usage-limit'); assert.equal(c.runner.usageLimited, true);
  assert.throws(() => c.engine.start(c.p.id), /usage limit/); assert.equal(c.p.workflowRuns.length, 1);
});

test('bounded refine node runs downstream from immutable model checkpoint and keeps saved cycle evidence', async t => {
  const c = setup(t, { refinement: true }); const r = await c.run();
  assert.equal(r.status, 'completed', r.error); assert.deepEqual(c.calls, ['model','compare','model','compare']);
  assert.equal(c.p.versions.length,2); const v=c.p.versions[1]; assert.equal(v.refinement.status,'passed');assert.equal(v.refinement.iterations.length,2);
  assert.notEqual(c.p.versions[0].artifacts.blend,v.artifacts.blend);
  assert.ok(r.checkpoints.find(cp=>cp.nodeId==='refine').files.some(f=>f.file.endsWith('comparison.json')));
  c.engine.checkpoint(c.p,r,r.checkpoints.find(cp=>cp.nodeId==='model').id);
});

test('enabling refinement downstream reuses the model and its original render evidence', async t => {
  const c=setup(t);const original=await c.run();const cp=original.checkpoints.find(cp=>cp.nodeId==='model');
  for (const name of ['geometry.json', 'materials.json', 'cameras.json', 'input.png', 'front.png', 'side.png', 'back.png', 'three-quarter.png']) {
    assert.ok(cp.files.some(f => f.file === cp.data.evidence[name]), name + ' is hashed in the model checkpoint');
  }
  const graph=structuredClone(c.p.workflow);graph.nodes.find(n=>n.type==='refine').settings={enabled:true,maxIterations:1};c.engine.saveGraph(c.p.id,graph,'web');
  const fork=await c.run({runId:original.id,checkpointId:cp.id});assert.equal(fork.status,'completed',fork.error);assert.equal(fork.nodes.model.reusedFrom,original.id);
  assert.deepEqual(c.calls,['model','compare','model','compare']);
});

test('changed comparison renders and revision evidence block checkpoint reuse and export', async t => {
  for (const name of ['input.png', 'front.png', 'side.png', 'back.png', 'three-quarter.png', 'geometry.json', 'materials.json', 'cameras.json']) {
    await t.test(name, async t => {
      const c = setup(t), original = await c.run(), cp = original.checkpoints.find(cp => cp.nodeId === 'model');
      const graph = structuredClone(c.p.workflow);
      graph.nodes.find(n => n.type === 'refine').settings = { enabled: true, maxIterations: 1 };
      c.engine.saveGraph(c.p.id, graph, 'web');
      fs.writeFileSync(c.store.artifact(c.p.id, cp.data.evidence[name]), name.endsWith('.png') ? png : '{"changed":true}');
      assert.throws(() => c.engine.checkpoint(c.p, original, cp.id), /Checkpoint artifact changed/);
      assert.throws(() => c.engine.start(c.p.id, { runId: original.id, checkpointId: cp.id }), /Checkpoint artifact changed/);
      assert.throws(() => c.store.canExport(c.p.id, c.p.versions[0].id), /changed/);
      assert.equal(c.p.workflowRuns.length, 1);
      assert.deepEqual(c.calls, ['model']);
    });
  }
});

test('refinement copies only recorded model files, excluding later injected directory contents', async t => {
  const c = setup(t), original = await c.run(), cp = original.checkpoints.find(cp => cp.nodeId === 'model');
  const dir = path.dirname(c.store.artifact(c.p.id, cp.data.artifacts.blend));
  fs.writeFileSync(path.join(dir, 'unrecorded.png'), png);
  fs.mkdirSync(path.join(dir, 'refinement'));
  fs.writeFileSync(path.join(dir, 'refinement', 'injected.json'), '{"unrecorded":true}');
  const graph = structuredClone(c.p.workflow);
  graph.nodes.find(n => n.type === 'refine').settings = { enabled: true, maxIterations: 1 };
  c.engine.saveGraph(c.p.id, graph, 'web');
  const fork = await c.run({ runId: original.id, checkpointId: cp.id });
  assert.equal(fork.status, 'completed', fork.error);
  const refinedDir = path.join(c.store.dir(c.p.id), 'runs', fork.id, 'refine');
  assert.equal(fs.existsSync(path.join(refinedDir, 'unrecorded.png')), false);
  assert.equal(fs.existsSync(path.join(refinedDir, 'refinement', 'injected.json')), false);
});

test('a branch from a completed model publishes a separate candidate without changing accepted source', async t => {
  const c=setup(t);const original=await c.run();const cp=original.checkpoints.find(cp=>cp.nodeId==='model'),before=hash(c.p.versions[0]);
  const fork=await c.run({runId:original.id,checkpointId:cp.id});assert.equal(fork.status,'completed',fork.error);
  assert.equal(c.p.versions.length,2);assert.equal(hash(c.p.versions[0]),before);assert.notEqual(c.p.versions[0].id,c.p.versions[1].id);
});

test('HTTP and a real MCP client share catalog, preset, graph execution and checkpoint state', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gen3d-graph-http-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const app=createApp({dataDir:root,generate:async(p,v,dir)=>{for(const f of ['model.glb','scene.blend','preview.png','mcp-audit.jsonl'])fs.copyFileSync(path.join(fixture,'model-1',f),path.join(dir,f));}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const url=`http://127.0.0.1:${app.server.address().port}`;
  const client=new Client({name:'graph-test',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('src/mcp.js')],env:{...process.env,GEN3D_URL:url},stderr:'pipe'});
  await client.connect(transport);
  t.after(async()=>{await client.close();app.server.close();await app.closed;});
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
  const workflows=await call('list_workflows');assert.equal(workflows.presets.length,2);assert.ok(workflows.catalog.edit);
  const p=await call('create_project',{name:'MCP graph',mode:'image',image:'data:image/png;base64,'+png.toString('base64'),checkpoints:off});
  const g=workflowPreset();g.nodes.find(n=>n.type==='model').settings.instructions='Graph instructions';await call('save_workflow',{projectId:p.id,graph:g});
  const preset=await call('save_workflow_preset',{name:'MCP duplicate',graph:g});assert.ok(preset.id);
  await call('run_workflow',{projectId:p.id});await app.runner.pending;
  const shared=await call('get_project',{projectId:p.id});assert.equal(shared.workflowRuns[0].status,'completed',shared.workflowRuns[0].error);
  const web=await(await fetch(url+`/api/projects/${p.id}`)).json();assert.deepEqual(web.workflowRuns,shared.workflowRuns);
  const denied=await fetch(url+`/api/projects/${p.id}/editable-base`,{method:'POST',headers:{'content-type':'application/json','x-gen3d-client':'mcp'},body:JSON.stringify({assetId:'fake',scope:{editableObjects:['Hair']}})});assert.equal(denied.status,403);
});

test('rejection can resolve a waiting checkpoint whose source became stale', async t => {
  const c=setup(t,{mode:'text',checkpoints:{...off,concept:true}}),r=await c.run(),cp=r.checkpoints.find(cp=>cp.nodeId==='concept');
  fs.appendFileSync(c.store.artifact(c.p.id,cp.data.file),'changed');
  assert.throws(()=>c.engine.review(c.p.id,r.id,'concept','approved','web'),/changed/);
  c.engine.review(c.p.id,r.id,'concept','rejected','web');assert.equal(r.status,'rejected');
});

test('protection evidence is mandatory at the model review and export boundary', async t => {
  const c=setup(t);await c.run();const v=c.p.versions[0];v.editableBase={assetId:'protected-base'};v.preservation={passed:false};
  assert.throws(()=>c.store.reviewVersion(c.p.id,v.id,'approved','web'),/protected base/);
  assert.throws(()=>c.store.canExport(c.p.id,v.id),/preservation/);
});

test('a base checkpoint fork also reuses valid parallel concept/view paths', async t => {
  // Synthetic base boundary isolates scheduler lineage; real preservation is
  // exercised by test:workflow-blender and validate:workflow-live.
  const c=setup(t,{mode:'text'});c.engine.saveGraph(c.p.id,workflowPreset('humanoid'),'web');
  c.p.editableBase={assetId:'fixture-base',sha256:'a'.repeat(64),scope:{editableObjects:['Hair']},review:'approved'};
  c.store.library.get=()=>({});c.store.library.verify=()=>({sha256:'a'.repeat(64)});
  c.engine.operations.base=async ctx=>{const file=path.join(ctx.dir,'base.blend');fs.copyFileSync(path.join(fixture,'model-1/scene.blend'),file);const rel=path.relative(c.store.dir(c.p.id),file).split(path.sep).join('/');return {data:{...c.p.editableBase,blend:rel,baseline:rel},files:[rel]};};
  const edit=c.engine.operations.edit;c.engine.operations.edit=ctx=>edit({...ctx,inputs:{...ctx.inputs,base:undefined}});
  const first=await c.run();assert.equal(first.status,'completed',first.error);const cp=first.checkpoints.find(cp=>cp.nodeId==='base');
  const graph=structuredClone(c.p.workflow);graph.nodes.find(n=>n.type==='edit').settings.instructions='Different downstream edit';c.engine.saveGraph(c.p.id,graph,'web');
  const fork=await c.run({runId:first.id,checkpointId:cp.id});assert.equal(fork.status,'completed',fork.error);
  for(const id of ['base','concept','views','consistency','references'])assert.equal(fork.nodes[id].reusedFrom,first.id);
  assert.deepEqual(c.calls,['concept','views','consistency','model','model']);
});

test('lower-level MCP gates remain authoritative and cannot model a humanoid from scratch', async t => {
  const c=setup(t,{mode:'text',checkpoints:{...off,concept:true}});c.runner.start(c.p.id,{},'mcp');await c.runner.pending;
  assert.throws(()=>c.engine.start(c.p.id),/pending artifact reviews/);
  c.store.reviewConcept(c.p.id,c.p.concepts[0].id,'rejected','web');
  c.engine.saveGraph(c.p.id,workflowPreset('humanoid'),'web');
  assert.throws(()=>c.runner.start(c.p.id,{},'mcp'),/editable-base/);
});

test('human stop during initial modeling skips downstream refinement and forces review even with preview Off', async t => {
  const c=setup(t,{refinement:true}),generate=c.runner.generate;
  let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  c.runner.generate=async(...args)=>{entered();await gate;return generate(...args);};
  c.engine.start(c.p.id,{},'web');await started;
  c.runner.requestRefinementReview(c.p.id,c.p.versions[0].id,'web');release();await c.runner.pending;
  const r=c.p.workflowRuns[0];assert.equal(r.status,'waiting-review',r.error);assert.deepEqual(c.calls,['model']);
  assert.equal(r.nodes.review.status,'waiting-review');assert.equal(r.checkpoints.find(cp=>cp.nodeId==='model').data.reviewRequired,true);
  assert.throws(()=>c.engine.start(c.p.id,{runId:r.id,checkpointId:r.checkpoints[0].id}),/pending/);
  c.engine.review(c.p.id,r.id,'review','approved','web');await c.runner.pending;assert.equal(r.status,'completed',r.error);
});
