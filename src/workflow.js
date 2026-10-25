import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import { validWorkflowViews } from './reference-set.js';

const contract = (inputs, output, settings = {}) => ({ inputs, output, settings });
export const nodeCatalog = {
  input: contract({}, 'design'),
  concept: contract({ design: 'design' }, 'visual', { feedback: 'string' }),
  views: contract({ visual: 'visual' }, 'views', { feedback: 'string' }),
  consistency: contract({ views: 'views' }, 'checkedViews', { enabled: 'boolean', onFailure: ['stop', 'continue'] }),
  references: contract({ design: 'design' }, 'references'),
  base: contract({ design: 'design' }, 'base'),
  model: contract({ views: 'checkedViews', references: 'references?' }, 'model', { instructions: 'string' }),
  edit: contract({ views: 'checkedViews', base: 'base', references: 'references?' }, 'model', { instructions: 'string' }),
  refine: contract({ model: 'model' }, 'model', { enabled: 'boolean', maxIterations: 'bound' }),
  review: contract({ model: 'model' }, 'reviewedModel'),
  output: contract({ model: 'reviewedModel' }, 'exports')
};
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])) : value; }
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const fileHash = file => hash(fs.readFileSync(file));
const fail = message => { throw new AppError(message, 409); };

export function validateGraph(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)
    || value.nodes.length < 2 || value.nodes.length > 64 || value.edges.length > 256 || canonical(value).length > 100000) fail('Graph requires schemaVersion 1, 2–64 nodes and at most 256 edges');
  const graph = structuredClone(value), ids = new Map();
  for (const n of graph.nodes) {
    if (!n || !/^[a-z][a-z0-9_-]{0,63}$/.test(n.id) || ids.has(n.id) || !Object.hasOwn(nodeCatalog, n.type)) fail('Unknown node type or invalid/duplicate node ID');
    n.settings ??= {};
    if (typeof n.settings !== 'object' || Array.isArray(n.settings) || n.settings === null) fail(`${n.id}: settings must be an object`);
    for (const [key, v] of Object.entries(n.settings)) {
      const rule = Object.hasOwn(nodeCatalog[n.type].settings, key) && nodeCatalog[n.type].settings[key];
      if (!rule || (Array.isArray(rule) ? !rule.includes(v) : rule === 'bound' ? !Number.isInteger(v) || v < 1 || v > 5 : typeof v !== rule || (rule === 'string' && v.length > 12000))) fail(`${n.id}: unsupported setting ${key}; refinement is bounded to 1–5 cycles`);
    }
    ids.set(n.id, n);
  }
  const incoming = new Map(graph.nodes.map(n => [n.id, {}]));
  for (const e of graph.edges) {
    const from = ids.get(e.from), to = ids.get(e.to), port = to && Object.hasOwn(nodeCatalog[to.type].inputs, e.input) && nodeCatalog[to.type].inputs[e.input];
    if (!from || !to || !port || port.replace('?', '') !== nodeCatalog[from.type].output) fail('Incompatible edge: use an existing node and a matching typed input port');
    if (incoming.get(e.to)[e.input]) fail(`${e.to}.${e.input}: only one connection is allowed`);
    incoming.get(e.to)[e.input] = e.from;
  }
  for (const n of graph.nodes) for (const [port, type] of Object.entries(nodeCatalog[n.type].inputs)) if (!type.endsWith('?') && !incoming.get(n.id)[port]) fail(`${n.id}.${port}: required dependency is unconnected`);
  const order = [], active = new Set(), done = new Set();
  function visit(id) {
    if (active.has(id)) fail('Graph cycles are unsupported; use the bounded refine node');
    if (done.has(id)) return;
    active.add(id); for (const dep of Object.values(incoming.get(id))) visit(dep);
    active.delete(id); done.add(id); order.push(id);
  }
  for (const n of graph.nodes) visit(n.id);
  if (graph.nodes.filter(n => n.type === 'input').length !== 1 || graph.nodes.filter(n => n.type === 'output').length !== 1) fail('Graph requires exactly one input and one output node');
  const ancestors = new Set();
  function collect(id) { if (ancestors.has(id)) return; ancestors.add(id); Object.values(incoming.get(id)).forEach(collect); }
  collect(graph.nodes.find(n => n.type === 'output').id);
  if (ancestors.size !== graph.nodes.length) fail('Every node must contribute to the output; remove disconnected nodes');
  return { graph, order, incoming, ids };
}

export function workflowPreset(kind = 'object') {
  if (!['object', 'humanoid'].includes(kind)) fail('Choose the object or humanoid preset');
  const nodes = ['input', 'concept', 'views', 'consistency', 'references', ...(kind === 'humanoid' ? ['base'] : []), kind === 'humanoid' ? 'edit' : 'model', 'refine', 'review', 'output'].map(type => ({ id: type, type, settings: {} }));
  const modeling = kind === 'humanoid' ? 'edit' : 'model';
  const edges = [ ['input', 'concept', 'design'], ['concept', 'views', 'visual'], ['views', 'consistency', 'views'], ['input', 'references', 'design'], ['consistency', modeling, 'views'], ['references', modeling, 'references'], [modeling, 'refine', 'model'], ['refine', 'review', 'model'], ['review', 'output', 'model'], ...(kind === 'humanoid' ? [['input', 'base', 'design'], ['base', modeling, 'base']] : []) ].map(([from, to, input]) => ({ from, to, input }));
  return { schemaVersion: 1, name: kind === 'humanoid' ? 'Humanoid from editable base' : 'Object from text / image', nodes, edges };
}

export function validateNodeOutput(type, data) {
  const valid = data && typeof data === 'object' && !Array.isArray(data);
  if (!valid) fail(`${type}: node output must be an object`);
  const image = d => typeof d?.file === 'string' && ['image', 'text'].includes(d.mode);
  const model = d => typeof d?.versionId === 'string' && ['glb', 'blend', 'render'].every(k => typeof d.artifacts?.[k] === 'string');
  const check = {
    input: () => ['text', 'image'].includes(data.mode) && typeof data.prompt === 'string' && typeof data.profile === 'string',
    concept: () => image(data),
    views: () => image(data.visual) && validWorkflowViews(data),
    consistency: () => image(data.visual) && validWorkflowViews(data) && data.consistency?.outcome === 'allowed',
    references: () => Array.isArray(data.models) && Array.isArray(data.images) && Array.isArray(data.visuals),
    base: () => data.review === 'approved' && typeof data.blend === 'string' && typeof data.baseline === 'string' && typeof data.sha256 === 'string' && Array.isArray(data.scope?.editableObjects),
    model: () => model(data), edit: () => model(data), refine: () => model(data), review: () => model(data),
    output: () => model(data) && typeof data.validation?.glbSha256 === 'string'
  }[type];
  if (!check?.()) fail(`${type}: invalid typed node output`);
}

// One durable scheduler owns both HTTP and MCP execution. Operations are injected
// so graph tests can distinguish scheduler behavior from real Codex/Blender work.
export class WorkflowEngine {
  constructor(store, runner, operations) {
    this.store = store; this.runner = runner; this.operations = operations;
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    this.implementationSources = Object.fromEntries(['src/workflow.js', 'src/workflow-operations.js', 'src/runner.js', 'src/store.js', 'src/concept.js', 'src/reference-set.js', 'src/refinement.js', 'src/model-reference-visuals.js', 'src/base-model.js', 'src/codex.js', 'blender/preservation.py', 'blender/reference_runtime.py', 'blender/gen3d_bridge.py'].map(file => [file, fileHash(path.join(root, file))]));
    this.implementationHash = hash(this.implementationSources);
  }
  saveGraph(id, graph, actor) {
    const p = this.store.get(id); this.store.idle(p);
    const parsed = validateGraph(graph).graph;
    p.workflow = { ...parsed, revision: (p.workflow?.revision || 0) + 1 };
    this.store.event(p, actor, 'workflow_saved', { revision: p.workflow.revision, invalidates: 'Changed nodes and all dependent descendants in future runs' });
    this.store.save(p); return p;
  }
  presets() {
    const file = path.join(this.store.root, 'workflow-presets.json');
    return [...['object', 'humanoid'].map(id => ({ id, graph: workflowPreset(id), builtin: true })), ...(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [])];
  }
  savePreset(input) {
    const graph = validateGraph(input.graph).graph;
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160) fail('Preset name must contain 1–160 characters');
    const item = { id: randomUUID(), name: input.name.trim(), graph: { ...graph, name: input.name.trim() }, builtin: false };
    const items = this.presets().filter(p => !p.builtin); items.push(item);
    const file = path.join(this.store.root, 'workflow-presets.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(items, null, 2)); fs.renameSync(file + '.tmp', file); return item;
  }
  snapshot(p) {
    const source = relative => ({ file: relative, sha256: fileHash(this.store.artifact(p.id, relative)) });
    if (p.references.some(r => r.review === 'pending') || p.modelReferences.some(r => r.review === 'pending')) fail('Review pending image/model references in the studio first');
    if (p.inputReview === 'rejected') fail('Input was rejected; approve the input before running');
    return { mode: p.mode, prompt: p.prompt, profile: p.profile, checkpoints: structuredClone(p.checkpoints), inputReview: p.inputReview,
      consistencySettings: structuredClone(p.consistencySettings), refinementSettings: structuredClone(p.refinementSettings),
      image: p.inputImage ? source(p.inputImage) : null,
      images: p.references.filter(r => r.review === 'approved').map(r => ({ ...structuredClone(r), ...source(r.file) })),
      models: this.store.library.snapshot(p.modelReferences), base: structuredClone(p.editableBase || null) };
  }
  context(node, snapshot) {
    switch (node.type) {
      case 'input': return { mode: snapshot.mode, prompt: snapshot.prompt, profile: snapshot.profile, image: snapshot.image, review: snapshot.checkpoints.input || snapshot.inputReview === 'rejected' };
      case 'concept': return { review: snapshot.checkpoints.concept };
      case 'views': return { review: snapshot.checkpoints.multiView };
      case 'consistency': return { ...snapshot.consistencySettings, ...node.settings };
      case 'references': return { images: snapshot.images, models: snapshot.models };
      case 'base': return snapshot.base;
      case 'refine': return { ...snapshot.refinementSettings, ...node.settings };
      case 'review': return { review: snapshot.checkpoints.preview };
      default: return {};
    }
  }
  fingerprint(node, snapshot, parents) { return hash({ implementationHash: this.implementationHash, type: node.type, settings: node.settings, context: this.context(node, snapshot), parents }); }
  checkpoint(p, run, id, seen = new Set()) {
    const cp = run.checkpoints.find(c => c.id === id);
    if (!cp) fail('Checkpoint not found');
    if (seen.has(id)) return cp;
    seen.add(id);
    const record = JSON.parse(fs.readFileSync(this.store.artifact(p.id, cp.record), 'utf8'));
    const { record: _record, recordHash: _recordHash, ...saved } = cp;
    if (hash(saved) !== cp.recordHash || hash(record) !== cp.recordHash || hash(cp.data) !== cp.dataHash || hash(cp.files) !== hash(record.files)) fail('Checkpoint record changed; stale artifact reuse is blocked');
    for (const f of cp.files) if (fileHash(this.store.artifact(p.id, f.file)) !== f.sha256) fail(`Checkpoint artifact changed: ${f.file}`);
    for (const dependency of Object.values(cp.dependencyIds)) this.checkpoint(p, run, dependency, seen);
    return cp;
  }
  sources(p, snapshot) {
    for (const f of [snapshot.image, ...snapshot.images].filter(Boolean)) if (fileHash(this.store.artifact(p.id, f.file)) !== f.sha256) fail(`Input source changed: ${f.file}`);
    this.store.library.jobFiles(snapshot.models);
    if (snapshot.base) {
      const a = this.store.library.get(snapshot.base.assetId);
      if (this.store.library.verify(a).sha256 !== snapshot.base.sha256) fail('Editable base source changed; select and authorize it again');
    }
  }
  start(id, input = {}, actor = 'web') {
    const p = this.store.get(id); this.store.idle(p);
    if (this.runner.active || this.runner.usageLimited) fail(this.runner.usageLimited ? 'Codex usage limit reached; no automatic retry or allowance reset' : 'Another local job is running');
    const parsed = validateGraph(p.workflow || workflowPreset());
    if (p.workflowRuns?.some(r => r.status === 'waiting-review')) fail('Resolve the pending workflow approval before starting or forking another run');
    if (p.concepts.some(c => c.prompt === p.prompt && c.profile === p.profile && c.status === 'ready' && c.review === 'pending') || p.referenceSets.some(s => s.conceptId === p.selectedConceptId && s.prompt === p.prompt && s.profile === p.profile && s.status === 'ready' && s.review === 'pending') || p.versions.some(v => !v.workflowRunId && v.status === 'ready' && v.checkpoints?.preview && v.review === 'pending')) fail('Resolve pending artifact reviews in the studio before starting a graph run');
    const snapshot = this.snapshot(p); this.sources(p, snapshot);
    if (parsed.graph.nodes.some(n => n.type === 'base') && (!snapshot.base || snapshot.base.review !== 'approved')) fail('Select and authorize a complete editable base in the studio');
    const run = { id: randomUUID(), graph: parsed.graph, graphRevision: p.workflow?.revision || 0, graphHash: hash(parsed.graph), snapshot, implementationSources: this.implementationSources, implementationHash: this.implementationHash, status: 'running', nodes: {}, checkpoints: [], decisions: [], parentRunId: input.runId || null, parentCheckpointId: input.checkpointId || null, createdAt: new Date().toISOString() };
    for (const n of parsed.graph.nodes) run.nodes[n.id] = { status: 'pending' };
    if (input.runId || input.checkpointId) {
      const parent = p.workflowRuns?.find(r => r.id === input.runId);
      if (!parent || !input.checkpointId) fail('Fork requires a saved run and checkpoint');
      const chosen = this.checkpoint(p, parent, input.checkpointId);
      const reuse = nodeId => {
        if (run.nodes[nodeId]?.status === 'completed') return;
        const node = parsed.ids.get(nodeId), state = parent.nodes[nodeId];
        if (!node || state?.status !== 'completed' || !state.checkpointId) fail('Checkpoint has pending approval, failed dependencies or changed wiring');
        const old = this.checkpoint(p, parent, state.checkpointId);
        const parents = {};
        for (const [port, dep] of Object.entries(parsed.incoming.get(nodeId))) { reuse(dep); parents[port] = { nodeId: dep, fingerprint: run.nodes[dep].fingerprint }; }
        const fingerprint = this.fingerprint(node, snapshot, parents);
        if (old.fingerprint !== fingerprint) fail(`${nodeId}: upstream input/settings/connections changed; choose an earlier valid checkpoint or start a new run`);
        const copy = structuredClone(old);
        run.checkpoints.push(copy); run.nodes[nodeId] = { status: 'completed', checkpointId: copy.id, fingerprint, reusedFrom: parent.id };
      };
      reuse(chosen.nodeId);
      if (parent.nodes[chosen.nodeId].checkpointId !== chosen.id) fail('Choose the saved output for this node');
      // A selected base can be parallel to concept/views. Reuse other valid
      // preceding paths as well, while deliberately rerunning its descendants.
      const descendants = new Set([chosen.nodeId]);
      for (const nodeId of parsed.order) if (Object.values(parsed.incoming.get(nodeId)).some(dep => descendants.has(dep))) descendants.add(nodeId);
      for (const nodeId of parsed.order) {
        if (descendants.has(nodeId) || run.nodes[nodeId].status === 'completed' || parent.nodes[nodeId]?.status !== 'completed') continue;
        try { reuse(nodeId); } catch { /* Changed parallel evidence is recomputed in the new run. */ }
      }
    }
    p.workflowRuns ??= []; p.workflowRuns.push(run);
    this.store.event(p, actor, 'workflow_started', { runId: run.id, parentRunId: run.parentRunId, parentCheckpointId: run.parentCheckpointId });
    this.store.save(p); this.launch(p, run); return p;
  }
  launch(p, run) {
    this.runner.active = true;
    this.runner.pending = this.execute(p, run).finally(() => { this.runner.active = false; });
  }
  async execute(p, run) {
    let current, currentDir;
    try {
      const parsed = validateGraph(run.graph);
      for (const id of parsed.order) {
        current = run.nodes[id]; if (current.status === 'completed') continue;
        this.sources(p, run.snapshot);
        const node = parsed.ids.get(id), inputs = {}, parents = {}, dependencyIds = {};
        for (const [port, dep] of Object.entries(parsed.incoming.get(id))) {
          const cp = this.checkpoint(p, run, run.nodes[dep].checkpointId);
          if (run.nodes[dep].status !== 'completed') fail('Unapproved dependency cannot execute');
          inputs[port] = structuredClone(cp.data); parents[port] = { nodeId: dep, fingerprint: cp.fingerprint }; dependencyIds[port] = cp.id;
        }
        const fingerprint = this.fingerprint(node, run.snapshot, parents);
        current.status = 'running'; current.fingerprint = fingerprint; this.store.save(p);
        const dir = path.join(this.store.dir(p.id), 'runs', run.id, id); currentDir = dir; fs.mkdirSync(dir, { recursive: true });
        const result = await this.operations[node.type]({ p, run, node, inputs, dir, context: this.context(node, run.snapshot) });
        this.sources(p, run.snapshot);
        for (const dependency of Object.values(dependencyIds)) this.checkpoint(p, run, dependency);
        validateNodeOutput(node.type, result.data);
        run.artifacts ??= []; run.artifacts.push(...(result.files || []).filter(f => !run.artifacts.includes(f)));
        const files = [...new Set(result.files || [])].map(file => ({ file, sha256: fileHash(this.store.artifact(p.id, file)), type: path.extname(file).slice(1) || 'file' }));
        const cp = { id: randomUUID(), runId: run.id, nodeId: id, type: nodeCatalog[node.type].output, graphRevision: run.graphRevision, graphHash: run.graphHash, implementationHash: run.implementationHash, fingerprint, settings: structuredClone(node.settings), configuration: this.context(node, run.snapshot), dependencyIds, sourceIdentities: structuredClone(result.sources || []), data: structuredClone(result.data), dataHash: hash(result.data), files, createdAt: new Date().toISOString() };
        const record = `runs/${run.id}/${id}/checkpoint.json`; fs.writeFileSync(path.join(this.store.dir(p.id), record), JSON.stringify(cp, null, 2), { flag: 'wx' });
        run.checkpoints.push({ ...cp, record, recordHash: hash(cp) }); current.checkpointId = cp.id;
        current.status = result.review ? 'waiting-review' : 'completed';
        this.store.event(p, 'workflow', 'node_checkpoint_saved', { runId: run.id, nodeId: id, checkpointId: cp.id, status: current.status }); this.store.save(p);
        if (result.review) { run.status = 'waiting-review'; this.store.save(p); return; }
      }
      run.status = 'completed'; run.finishedAt = new Date().toISOString();
    } catch (e) {
      if (currentDir) {
        run.artifacts ??= [];
        const partial = (dir, depth = 0) => {
          if (depth > 8 || run.artifacts.length > 3000) return;
          for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, item.name);
            if (item.isDirectory()) partial(file, depth + 1);
            else if (item.isFile() && /\.(png|jpg|webp|glb|blend|json|jsonl|md|txt)$/.test(item.name)) {
              const relative = path.relative(this.store.dir(p.id), file).split(path.sep).join('/');
              if (!run.artifacts.includes(relative)) run.artifacts.push(relative);
            }
          }
        };
        partial(currentDir);
      }
      if (current) { current.status = 'failed'; current.error = e.message; }
      run.status = e.usageLimited || this.runner.usageLimited ? 'usage-limit' : 'failed'; run.error = e.message;
      if (e.usageLimited) this.runner.usageLimited = true;
      for (const v of p.versions.filter(v => v.workflowRunId === run.id && v.status === 'running')) { v.status = 'failed'; v.error = e.message; if (v.refinement?.status === 'running') v.refinement.status = e.usageLimited ? 'usage-limit' : 'failed'; }
      this.store.event(p, 'workflow', 'workflow_failed', { runId: run.id, message: e.message });
    } finally { this.store.save(p); }
  }
  review(id, runId, nodeId, decision, actor) {
    const p = this.store.get(id), run = p.workflowRuns?.find(r => r.id === runId), state = run?.nodes[nodeId];
    if (actor !== 'web') throw new AppError('Workflow approval requires a human in the web UI', 403);
    if (!['approved', 'rejected'].includes(decision) || run?.status !== 'waiting-review' || state?.status !== 'waiting-review') fail('Choose a pending node and approve or reject it');
    if (this.runner.active) fail('Wait for the active job');
    if (decision === 'approved' && run.implementationHash !== this.implementationHash) fail('Implementation changed since this run; reject the pending review and start a new run');
    const cp = decision === 'approved' ? this.checkpoint(p, run, state.checkpointId) : run.checkpoints.find(c => c.id === state.checkpointId);
    if (decision === 'approved') this.sources(p, run.snapshot);
    if (cp.type === 'reviewedModel') this.store.reviewVersion(id, cp.data.versionId, decision, actor);
    state.status = decision === 'approved' ? 'completed' : 'rejected';
    run.decisions.push({ nodeId, checkpointId: cp.id, decision, actor, at: new Date().toISOString() });
    run.status = decision === 'approved' ? 'running' : 'rejected';
    this.store.event(p, actor, 'workflow_reviewed', { runId, nodeId, decision }); this.store.save(p);
    if (decision === 'approved') {
      if (this.runner.usageLimited) { run.status = 'usage-limit'; run.error = 'Usage limit reached; no automatic continuation'; this.store.save(p); }
      else this.launch(p, run);
    }
    return p;
  }
}
