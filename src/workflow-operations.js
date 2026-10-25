import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { imageData } from './store.js';
import { hash, fileHash } from './workflow.js';
import { taskPrompt } from './runner.js';
import { requiredViews, validWorkflowViews } from './reference-set.js';
import { referenceSheet, maxVisualReferences } from './model-reference-visuals.js';
import { prepareBase, validateBaseEdit } from './base-model.js';
const runtime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../blender');

export function workflowOperations(store, runner) {
  const relative = (p, file) => path.relative(store.dir(p.id), file).split(path.sep).join('/');
  function publish(p, run, file) {
    const rel = relative(p, file); run.artifacts ??= []; if (!run.artifacts.includes(rel)) run.artifacts.push(rel); store.save(p); return rel;
  }
  function json(ctx, name, value) {
    const file = path.join(ctx.dir, name); fs.writeFileSync(file, JSON.stringify(value, null, 2)); return publish(ctx.p, ctx.run, file);
  }
  function image(ctx, name, result) {
    const data = imageData(`data:image/${result.ext === 'jpg' ? 'jpeg' : result.ext};base64,${result.bytes.toString('base64')}`);
    const file = path.join(ctx.dir, name + '.' + data.ext); fs.writeFileSync(file, data.bytes); return publish(ctx.p, ctx.run, file);
  }
  function versionResult(p, v) {
    const dir = path.dirname(store.artifact(p.id, v.artifacts.blend));
    // These files are consumed by comparison and revision validation even when
    // refinement was Off at modeling time. Bind them to the model checkpoint.
    const evidence = Object.fromEntries(['geometry.json', 'materials.json', 'cameras.json', 'input.png', 'front.png', 'side.png', 'back.png', 'three-quarter.png']
      .filter(name => fs.existsSync(path.join(dir, name)))
      .map(name => [name, relative(p, path.join(dir, name))]));
    return { data: { versionId: v.id, artifacts: structuredClone(v.artifacts), evidence, preservation: structuredClone(v.preservation || null), reviewRequired: !!v.refinement?.reviewRequested }, files: [...Object.values(v.artifacts), ...Object.values(evidence)] };
  }
  function newVersion(ctx, source) {
    const { p, run, node, inputs } = ctx, snap = run.snapshot, view = inputs.views;
    const v = source ? { ...structuredClone(source), id: randomUUID(), sourceVersionId: source.id, artifacts: {}, review: 'pending', status: 'running', error: null } : {
      id: randomUUID(), kind: inputs.base ? 'revision' : 'generate', sourceVersionId: null, prompt: snap.prompt, profile: snap.profile,
      feedback: node.settings.instructions || '', status: 'running', review: 'pending', artifacts: {}, createdAt: new Date().toISOString(),
      visualInput: view.visual.file, conceptId: null, referenceSetId: view.images.length ? view.setId : null, modelingImages: view.images,
      referenceIds: snap.images.map(r => r.id), imageInputs: [view.visual.file, ...view.images.map(i => i.file), ...(inputs.references?.images || []).map(i => i.file)],
      modelReferences: structuredClone(inputs.references?.models || []), modelReferenceVisuals: structuredClone(inputs.references?.visuals || []),
      consistency: view.consistency, consistencySettings: view.consistencySettings,
      editableBase: structuredClone(inputs.base || null)
    };
    v.workflowRunId = run.id; v.workflowNodeId = node.id; v.workflowMode = snap.mode; v.workflowReviewed = false;
    v.number = p.versions.length + 1; v.checkpoints = { ...snap.checkpoints, preview: true };
    // Render evidence for a downstream refine node without running its loop early.
    v.refinementSettings = { ...snap.refinementSettings, enabled: true };
    const downstreamRefine = run.graph.nodes.filter(n => n.type === 'refine');
    if (downstreamRefine.some(n => n.settings.enabled === true)) v.refinementSettings.enabled = true;
    v.referenceFingerprint = hash(v.imageInputs.map(file => ({ file, sha256: fileHash(store.artifact(p.id, file)) })));
    const loopEnabled = downstreamRefine.some(n => n.settings.enabled ?? snap.refinementSettings.enabled);
    v.refinement = { status: loopEnabled ? 'running' : 'off', maxIterations: v.refinementSettings.maxIterations, iterations: [] };
    p.versions.push(v); store.save(p); return v;
  }
  return {
    async input(ctx) {
      const s = ctx.run.snapshot;
      return { data: { mode: s.mode, prompt: s.prompt, profile: s.profile, image: s.image }, files: s.image ? [s.image.file] : [], sources: s.image ? [s.image] : [], review: s.checkpoints.input && s.inputReview !== 'approved' };
    },
    async concept(ctx) {
      const d = ctx.inputs.design;
      if (d.mode === 'image') return { data: { ...d, file: d.image.file }, files: [d.image.file] };
      const result = await runner.conceptGenerator.generate({ prompt: d.prompt, profile: d.profile, feedback: ctx.node.settings.feedback || '', dir: ctx.dir });
      const file = image(ctx, 'concept', result);
      return { data: { ...d, file }, files: [file], review: ctx.run.snapshot.checkpoints.concept };
    },
    async views(ctx) {
      const visual = ctx.inputs.visual, images = [], setId = randomUUID();
      if (visual.mode === 'text') {
        await runner.conceptGenerator.generateViews({ prompt: visual.prompt, profile: visual.profile, feedback: ctx.node.settings.feedback || '', conceptFile: store.imageArtifact(ctx.p.id, visual.file), conceptId: setId, dir: ctx.dir, onImage: async result => {
          if (!requiredViews.includes(result.view) || images.some(i => i.view === result.view)) throw new Error('Invalid/duplicate modeling view');
          if (result.view === 'side' && !['left', 'right'].includes(result.side)) throw new Error('Side view must specify left or right');
          const file = image(ctx, result.view, result);
          images.push({ id: randomUUID(), role: 'modeling-view', view: result.view, side: result.side, label: result.view === 'side' ? `${result.side} side` : result.view, file, parentImage: visual.file, referenceSetId: setId });
        } });
        if (requiredViews.some(view => !images.some(i => i.view === view))) throw new Error('Generate all four modeling views before continuing');
      }
      return { data: { visual, images, setId }, files: [visual.file, ...images.map(i => i.file)], review: visual.mode === 'text' && ctx.run.snapshot.checkpoints.multiView };
    },
    async consistency(ctx) {
      const data = ctx.inputs.views, settings = ctx.context;
      if (!validWorkflowViews(data)) throw new Error('Invalid four-view evidence');
      // Validate decoded image evidence in every policy, before optional inspection.
      for (const file of [data.visual.file, ...data.images.map(i => i.file)]) store.imageArtifact(ctx.p.id, file);
      let report = { status: data.images.length ? 'skipped' : 'not-applicable', issues: [], outcome: 'allowed' };
      if (data.images.length && settings.enabled) {
        const checked = await runner.inspectReferences({ prompt: data.visual.prompt, profile: data.visual.profile, dir: ctx.dir, images: [{ label: 'base concept', file: store.imageArtifact(ctx.p.id, data.visual.file) }, ...data.images.map(i => ({ label: i.label, file: store.imageArtifact(ctx.p.id, i.file) }))] });
        if (typeof checked?.consistent !== 'boolean' || !Array.isArray(checked.issues) || checked.issues.some(x => typeof x !== 'string')) throw new Error('Invalid consistency inspection report');
        report = { status: checked.consistent && !checked.issues.length ? 'passed' : 'failed', issues: checked.issues, report: checked, outcome: checked.consistent && !checked.issues.length || settings.onFailure === 'continue' ? 'allowed' : 'blocked' };
      }
      const file = json(ctx, 'consistency.json', report);
      if (report.outcome === 'blocked') throw new Error('Consistency blocker: ' + report.issues.join('; '));
      return { data: { ...data, consistency: report, consistencySettings: settings }, files: [file, data.visual.file, ...data.images.map(i => i.file)] };
    },
    async references(ctx) {
      const { models, images } = ctx.run.snapshot, visuals = [];
      if (models.length > maxVisualReferences) throw new Error(`At most ${maxVisualReferences} visual model references are supported`);
      const files = store.library.jobFiles(models).map(({ assetId, name, role, permission, sha256, path: file }) => ({ assetId, name, role, permission, sha256, path: file }));
      if (files.length) {
        await runner.blender('execute_code', { code: `import sys, json\nsys.path.insert(0, ${JSON.stringify(runtime)})\nimport reference_runtime as refs\nrefs.remove_references()\nrefs.load_references(json.loads(${JSON.stringify(JSON.stringify(files))}))` }, { port: Number(runner.env.GEN3D_BLENDER_PORT || 9877) });
        try {
          for (const ref of files) {
            const directory = path.join(ctx.dir, ref.assetId);
            const result = await runner.blender('execute_code', { code: `import json, reference_runtime as refs\nprint('GEN3D_REFERENCE_VIEWS=' + json.dumps(refs.render_reference(${JSON.stringify(ref.assetId)}, ${JSON.stringify(directory)})))` }, { port: Number(runner.env.GEN3D_BLENDER_PORT || 9877) });
            const visual = await referenceSheet(ref, JSON.parse(result.output.trim().split('GEN3D_REFERENCE_VIEWS=').at(-1)), directory);
            visual.sheet = publish(ctx.p, ctx.run, visual.sheet); visual.views = visual.views.map(v => ({ ...v, image: publish(ctx.p, ctx.run, v.image) })); visuals.push(visual);
          }
        } finally { await runner.blender('execute_code', { code: 'import reference_runtime as refs; refs.remove_references()' }, { port: Number(runner.env.GEN3D_BLENDER_PORT || 9877) }); }
      }
      return { data: { models, images, visuals }, files: [...images.map(i => i.file), ...visuals.flatMap(v => [v.sheet, ...v.views.map(i => i.image)])], sources: [...models.map(({ assetId, sha256 }) => ({ assetId, sha256 })), ...images] };
    },
    async base(ctx) {
      const data = await prepareBase(store, runner, ctx.p, ctx.run.snapshot.base, ctx.dir);
      for (const file of [data.blend, data.baseline, data.validation, data.source, data.glb]) publish(ctx.p, ctx.run, path.join(store.dir(ctx.p.id), file));
      return { data, files: [data.blend, data.baseline, data.validation, data.source, data.glb], sources: [{ assetId: data.assetId, sha256: data.sha256, scope: data.scope }] };
    },
    async model(ctx) { return this.edit(ctx); },
    async edit(ctx) {
      const v = newVersion(ctx);
      if (v.editableBase) fs.copyFileSync(store.artifact(ctx.p.id, v.editableBase.blend), path.join(ctx.dir, 'source.blend'));
      fs.writeFileSync(path.join(ctx.dir, 'TASK.md'), taskPrompt(ctx.p, v));
      await runner.generate(ctx.p, v, ctx.dir); runner.validateModel(ctx.p, v, ctx.dir);
      await validateBaseEdit(store, runner, ctx.p, v, ctx.dir);
      if (v.refinement.status === 'running') v.refinement.status = v.refinement.reviewRequested ? 'review-requested' : 'prepared';
      v.status = 'ready'; store.save(ctx.p); return versionResult(ctx.p, v);
    },
    async refine(ctx) {
      const source = ctx.p.versions.find(v => v.id === ctx.inputs.model.versionId);
      if (!source || source.status !== 'ready') throw new Error('Refinement requires a completed model');
      if (!ctx.context.enabled || source.refinement?.reviewRequested || ctx.inputs.model.reviewRequired) return { data: ctx.inputs.model, files: [...Object.values(ctx.inputs.model.artifacts), ...Object.values(ctx.inputs.model.evidence || {})] };
      const v = newVersion(ctx, source);
      // The engine verifies these checkpoint files before execution. Never copy
      // an entire directory: newly injected, unrecorded files are not evidence.
      for (const file of new Set([...Object.values(ctx.inputs.model.artifacts), ...Object.values(ctx.inputs.model.evidence || {})])) {
        fs.copyFileSync(store.artifact(ctx.p.id, file), path.join(ctx.dir, path.basename(file)));
      }
      v.refinementSettings = ctx.context; v.refinement = { status: 'running', maxIterations: ctx.context.maxIterations, iterations: [{ number: 0, status: 'running', stage: 'comparing', views: v.modelingImages.length ? v.modelingImages.map(i => i.view) : ['input'], referenceFingerprint: v.referenceFingerprint, imageInputs: v.imageInputs, artifacts: {}, createdAt: new Date().toISOString() }] };
      runner.validateModel(ctx.p, v, ctx.dir);
      await runner.refine(ctx.p, v, ctx.dir);
      v.status = 'ready'; store.save(ctx.p);
      if (v.refinement.status === 'usage-limit') { const error = new Error(v.refinement.error); error.usageLimited = true; throw error; }
      await validateBaseEdit(store, runner, ctx.p, v, path.dirname(store.artifact(ctx.p.id, v.artifacts.blend)));
      const result = versionResult(ctx.p, v);
      return { ...result, files: [...result.files, ...v.refinement.iterations.flatMap(i => Object.values(i.artifacts))] };
    },
    async review(ctx) {
      let v = ctx.p.versions.find(v => v.id === ctx.inputs.model.versionId);
      if (v && v.workflowRunId !== ctx.run.id) {
        v = { ...structuredClone(v), id: randomUUID(), number: ctx.p.versions.length + 1, sourceVersionId: v.id, workflowRunId: ctx.run.id, workflowNodeId: ctx.node.id, workflowReviewed: false, review: 'pending' };
        ctx.p.versions.push(v);
      }
      if (!v || v.status !== 'ready' || v.editableBase && v.preservation?.passed !== true) throw new Error('Candidate lacks required validation/preservation evidence');
      const review = ctx.inputs.model.reviewRequired || ctx.run.snapshot.checkpoints.preview || v.refinement?.reviewRequested || ['failed', 'review-requested', 'iteration-limit'].includes(v.refinement?.status);
      v.workflowReviewed = true;
      if (!review) { v.checkpoints.preview = false; store.reviewVersion(ctx.p.id, v.id, 'approved', 'system'); }
      store.save(ctx.p); return { data: { ...ctx.inputs.model, versionId: v.id }, files: Object.values(ctx.inputs.model.artifacts), review };
    },
    async output(ctx) {
      const v = store.canExport(ctx.p.id, ctx.inputs.model.versionId);
      const data = { ...ctx.inputs.model, validation: { metrics: v.metrics, preservation: v.preservation || null, checkedAt: new Date().toISOString(), glbSha256: fileHash(store.artifact(ctx.p.id, v.artifacts.glb)), blendSha256: fileHash(store.artifact(ctx.p.id, v.artifacts.blend)) } };
      const report = json(ctx, 'validation.json', data.validation);
      return { data, files: [...Object.values(v.artifacts), report] };
    }
  };
}
