// Real Blender + real Store/workflow boundaries with a deterministic mesh edit.
// No Codex generation or provider allowance; the modeler/audit are test fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Runner, exportCode } from '../src/runner.js';
import { runProcess } from '../src/codex.js';
import { authorizeBase } from '../src/base-model.js';
import { WorkflowEngine, fileHash } from '../src/workflow.js';
import { workflowOperations } from '../src/workflow-operations.js';

export function blenderExecutor(output) {
  let number = 0;
  return async (tool, { code }) => {
    assert.equal(tool, 'execute_code');
    const script = path.join(output, `execution-${++number}.py`);
    fs.writeFileSync(script, code);
    let diagnostic;
    let log;
    try {
      log = await runProcess(process.env.GEN3D_BLENDER_BIN || 'blender', ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', script], { timeout: 180000, onLine: line => { if (line.startsWith('RuntimeError:')) diagnostic = line.slice('RuntimeError:'.length).trim(); } });
    } catch (error) {
      // Match the real Blender bridge, which returns the Python exception text.
      if (diagnostic) throw new Error(diagnostic);
      throw error;
    }
    fs.writeFileSync(script + '.log', log);
    return { output: log };
  };
}

export async function deterministicEdit(blender, project, version, directory) {
  const code = `import bpy\nbpy.ops.wm.open_mainfile(filepath=${JSON.stringify(path.join(directory, 'source.blend'))}, use_scripts=False)\nfor v in bpy.data.objects['Hair'].data.vertices:\n    v.co.x *= 1.15\nbpy.context.scene['gen3d_reference_camera_direction'] = [0,-1,0]\n` + exportCode(directory, version);
  await blender('execute_code', { code });
  fs.writeFileSync(path.join(directory, 'mcp-audit.jsonl'), JSON.stringify({ tool: 'execute_blender_code', synthetic: true, description: 'Deterministic fixture edit; no Codex invocation' }) + '\n');
}

export async function checkPosedWorkflow(output, fixtures, cases = [['blend', 'posed.blend', 'blend'], ['glb', 'blend/base.glb', 'glb'], ['constraint', 'constraint.blend', 'blend']]) {
  fs.mkdirSync(output, { recursive: true });
  const store = new Store(fs.mkdtempSync(path.join(output, 'data-')));
  const blender = blenderExecutor(output);
  let generations = 0;
  const runner = new Runner(store, { blender, generate: async (...args) => { generations++; await deterministicEdit(blender, ...args); } });
  const engine = new WorkflowEngine(store, runner, workflowOperations(store, runner));
  const png = fs.readFileSync('docs/validation/issue10/prop/model-1/preview.png');
  const results = [];
  for (const [kind, source, format] of cases) {
    const asset = await store.library.import({ name: `posed-${kind}.${format}`, data: fs.readFileSync(path.join(fixtures, source)).toString('base64') });
    const before = fileHash(store.library.resolve(asset));
    let selectionPreview;
    if (kind !== 'constraint') {
      const preview = await store.library.partPreview(asset.id);
      const evidence = path.join(output, `preview-${kind}.json`);
      await blender('execute_code', { code: `import sys, runpy\nsys.path.insert(0, ${JSON.stringify(path.resolve('blender'))})\nimport preservation as p\ncheck = runpy.run_path(${JSON.stringify(path.resolve('scripts/posed-rig-check.py'))})['check_selection_preview']\np.write(${JSON.stringify(evidence)}, check(p, ${JSON.stringify(store.library.resolve(asset))}, ${JSON.stringify(preview)}))\n` });
      selectionPreview = JSON.parse(fs.readFileSync(evidence, 'utf8'));
    }
    const project = store.create({ name: `Posed ${kind}`, workflowType: 'humanoid', mode: 'image', refinementSettings: { enabled: false }, image: 'data:image/png;base64,' + png.toString('base64') }, 'web');
    await assert.rejects(authorizeBase(store, project.id, { assetId: asset.id, scope: { editableObjects: ['Hair'] } }, 'mcp'), /human/);
    await authorizeBase(store, project.id, { assetId: asset.id, sha256: asset.sha256, scope: { editableObjects: ['Hair'] } }, 'web');
    const generationCount = generations;
    engine.start(project.id, {}, 'web');
    await runner.pending;
    const run = project.workflowRuns.at(-1);
    if (kind === 'constraint') {
      assert.equal(run.status, 'failed');
      assert.match(run.error, /bone constraints: mixamorig:Spine/);
      assert.equal(generations, generationCount, 'failed preflight spends no modeling allowance');
      assert.equal(run.checkpoints.some(c => c.nodeId === 'base'), false);
    } else {
      assert.equal(run.status, 'completed', run.error);
      const version = project.versions.at(-1);
      assert.equal(version.preservation.roundtrip.passed, true);
      assert.deepEqual(project.editableBase.scope, { editableObjects: ['Hair'], allowChanges: [], allowNewObjects: false });
      assert.equal(project.activity.filter(e => e.type === 'editable_base_authorized').length, 1);
      assert.equal(store.canExport(project.id, version.id).id, version.id);
      assert.equal(new Store(store.root).get(project.id).editableBase.sha256, asset.sha256);
    }
    assert.equal(fileHash(store.library.resolve(asset)), before);
    results.push({ source: kind, status: run.status, error: run.error || null, sourceUnchanged: true, scope: project.editableBase.scope, selectionPreview });
  }
  return { realBlender: true, realWorkflow: true, codexUsed: false, deterministicModeler: true, results };
}
