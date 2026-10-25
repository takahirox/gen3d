import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { refinementSettings } from './refinement.js';
import { crc32 } from 'node:zlib';
import { Transformer } from '@napi-rs/image';
import { referenceProfile, validateViewSet, consistencySettings, consistencyAllowsModeling } from './reference-set.js';

import { AppError } from './errors.js';
export { AppError } from './errors.js';
import { workflowPreset, fileHash, hash } from './workflow.js';
import { AssetLibrary } from './asset-library.js';
const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function text(value, name, max = 12000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(`${name} must contain 1–${max} characters`);
  return value.trim();
}
export function imageData(value) {
  if (typeof value !== 'string') throw new AppError('Provide a PNG, JPEG or WebP data URL');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > 14_000_000) throw new AppError('Image must be PNG, JPEG or WebP, at most 10 MB');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid || bytes.length > 10_000_000) throw new AppError('Invalid or oversized image');
  try {
    // Decoders can tolerate missing trailers. Require a complete container too.
    if (match[1] === 'png') {
      let offset = 8, ended = false;
      while (offset + 12 <= bytes.length) {
        const start = offset, size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
        offset += 12 + size;
        if (offset > bytes.length) throw new Error('Truncated PNG chunk');
        if (crc32(bytes.subarray(start + 4, offset - 4)) !== bytes.readUInt32BE(offset - 4)) throw new Error('Corrupted PNG chunk');
        if (type === 'IEND') { ended = size === 0 && offset === bytes.length; break; }
      }
      if (!ended) throw new Error('Missing PNG end');
    } else if (match[1] === 'jpeg') {
      if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('Missing JPEG end');
    } else if (bytes.length < 12 || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Truncated WebP container');
    // Read every pixel, not just metadata/signatures. Preserve the original bytes.
    if (!new Transformer(bytes).rawPixelsSync().length) throw new Error('Empty image');
  } catch {
    throw new AppError('Invalid image contents');
  }
  return { bytes, ext: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

export function checkpoints(value = {}, previous = { input: false, concept: false, multiView: false, preview: false }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.entries(value).some(([key, v]) => !['input', 'concept', 'multiView', 'preview'].includes(key) || typeof v !== 'boolean')) throw new AppError('Checkpoint settings must be input, concept, multiView and preview booleans');
  return { ...previous, ...value };
}

export function currentConcept(p, c) {
  return c.prompt === p.prompt && c.profile === p.profile;
}
export function currentReferenceSet(p, set) {
  return set.conceptId === p.selectedConceptId && set.prompt === p.prompt && set.profile === p.profile;
}

// Only the HTTP server owns this store. MCP clients always use that server's API.
export class Store {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this.root = fs.realpathSync(this.root);
    this.projects = new Map();
    this.operations = new Map();
    this.library = new AssetLibrary(this.root, options);
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.root, entry.name, 'project.json');
      if (!fs.existsSync(file)) continue;
      this.verifyProjectDirectory(entry.name, { id: entry.name });
      const project = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.verifyProjectDirectory(entry.name, project);
      if (project.schemaVersion !== 3) throw new AppError('Unsupported project schema. Start fresh by clearing only the gen3d-managed data store; see docs/local-setup.md#start-fresh.');
      this.projects.set(project.id, project);
      for (const set of project.referenceSets) {
        if (set.status === 'running') {
          set.status = 'failed'; set.error = 'Server stopped during reference generation/inspection. Regenerate manually.';
          if (set.consistency?.status === 'running') set.consistency = { ...set.consistency, status: 'error', outcome: 'blocked', error: set.error };
          this.event(project, 'server', 'reference_set_interrupted', { referenceSetId: set.id });
        }
      }
      for (const concept of project.concepts) {
        if (concept.status === 'running') {
          concept.status = 'failed'; concept.error = 'Server stopped during concept generation. Regenerate manually.';
          this.event(project, 'server', 'concept_interrupted', { conceptId: concept.id });
        }
      }
      for (const version of project.versions) {
        if (version.status === 'running') {
          if (version.refinement?.status === 'running') {
            version.refinement.status = 'interrupted'; version.refinement.error = 'Server stopped; no automatic resume.';
            for (const cycle of version.refinement.iterations) if (cycle.status === 'running') cycle.status = 'interrupted';
          }
          version.status = 'failed'; version.error = 'Server stopped during generation. Retry to create a new version.';
          this.event(project, 'server', 'generation_interrupted', { versionId: version.id });
        }
      }
      for (const run of project.workflowRuns || []) {
        if (run.status === 'running') {
          run.status = 'interrupted'; run.error = 'Server stopped; fork a completed checkpoint to resume explicitly.';
          for (const node of Object.values(run.nodes)) if (node.status === 'running') node.status = 'interrupted';
          this.event(project, 'server', 'workflow_interrupted', { runId: run.id });
        }
      }
      this.save(project);
    }
  }
  dir(id) {
    this.get(id);
    const dir = path.join(this.root, id);
    if (!fs.lstatSync(dir).isDirectory() || fs.realpathSync(dir) !== dir) throw new AppError('Unsafe project directory', 409);
    return dir;
  }
  get(id) {
    if (!projectIdPattern.test(id)) throw new AppError('Project not found', 404);
    const p = this.projects.get(id);
    if (!p) throw new AppError('Project not found', 404);
    return p;
  }
  list() { return [...this.projects.values()].map(p => structuredClone(p)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  verifyProjectDirectory(id, p) {
    if (!projectIdPattern.test(id) || p.id !== id) throw new AppError('Unsafe project identity', 409);
    const dir = path.join(this.root, id), manifest = path.join(dir, 'project.json');
    if (!fs.lstatSync(dir).isDirectory() || fs.realpathSync(dir) !== dir
      || !fs.lstatSync(manifest).isFile() || fs.realpathSync(manifest) !== manifest) throw new AppError('Unsafe project directory', 409);
    return dir;
  }
  beginOperation(id) {
    this.get(id);
    this.operations.set(id, (this.operations.get(id) || 0) + 1);
    return () => {
      const remaining = this.operations.get(id) - 1;
      if (remaining) this.operations.set(id, remaining); else this.operations.delete(id);
    };
  }
  delete(id, actor) {
    if (actor !== 'web') throw new AppError('Project deletion requires a human in the web UI', 403);
    const p = this.get(id); this.idle(p);
    if (this.operations.has(id)) throw new AppError('Wait for this project’s current operation to finish, then delete again', 409);
    const dir = this.verifyProjectDirectory(id, p);
    const manifest = path.join(dir, 'project.json'), savedManifest = fs.readFileSync(manifest, 'utf8');
    const saved = JSON.parse(savedManifest);
    if (saved.id !== id || saved.schemaVersion !== 3) throw new AppError('Unsafe project identity', 409);
    // Synchronous validation/removal cannot interleave with a new server writer.
    // rm unlinks nested symlinks; it never follows them into shared/external assets.
    try {
      // Keep the identity manifest until the contents are gone, so a partial
      // filesystem failure remains recognizable and deletion can be retried.
      for (const name of fs.readdirSync(dir)) if (name !== 'project.json') fs.rmSync(path.join(dir, name), { recursive: true });
      if (fs.readdirSync(dir).some(name => name !== 'project.json')) throw new Error('Project files remain');
      fs.unlinkSync(manifest);
      try { fs.rmdirSync(dir); }
      catch (e) { fs.writeFileSync(manifest, savedManifest, { flag: 'wx' }); throw e; }
    }
    catch { throw new AppError('Could not delete all project files. Check folder permissions and try again.', 500); }
    if (fs.existsSync(dir)) throw new AppError('Project files remain; try deleting again', 500);
    this.projects.delete(id);
    return { id };
  }
  event(p, actor, type, details = {}) {
    p.updatedAt = new Date().toISOString();
    p.activity.push({ id: randomUUID(), at: p.updatedAt, actor, type, ...details });
  }
  save(p) {
    // A stale async callback must never recreate a deleted project.
    if (this.get(p.id) !== p) throw new AppError('Project is no longer current', 409);
    const dir = this.dir(p.id);
    fs.writeFileSync(path.join(dir, 'project.json.tmp'), JSON.stringify(p, null, 2));
    fs.renameSync(path.join(dir, 'project.json.tmp'), path.join(dir, 'project.json'));
  }
  create(input, actor) {
    const name = text(input.name, 'Name', 160);
    if (!['text', 'image'].includes(input.mode)) throw new AppError('Mode must be text or image');
    const prompt = input.mode === 'text' ? text(input.prompt, 'Prompt') : (input.prompt ? text(input.prompt, 'Prompt') : 'Create a 3D model of the subject in the input image.');
    const image = input.mode === 'image' ? imageData(input.image) : null;
    const settings = checkpoints(input.checkpoints);
    const profile = referenceProfile(input.profile, prompt);
    const p = { schemaVersion: 3, workflow: { ...workflowPreset(input.workflowType || 'object'), revision: 1 }, workflowRuns: [], acceptedVersionId: null, editableBase: null, id: randomUUID(), name, mode: input.mode, prompt, profile, inputImage: null, checkpoints: settings, consistencySettings: consistencySettings(input.consistencySettings), refinementSettings: refinementSettings(input.refinementSettings), inputReview: 'pending', inputCheckpoint: settings.input, concepts: [], selectedConceptId: null, referenceSets: [], selectedReferenceSetId: null, references: [], modelReferences: [], versions: [], activity: [], updatedAt: '' };
    this.projects.set(p.id, p);
    fs.mkdirSync(path.join(this.root, p.id));
    if (image) {
      p.inputImage = `input.${image.ext}`;
      fs.writeFileSync(path.join(this.dir(p.id), p.inputImage), image.bytes);
    }
    this.event(p, actor, 'project_created'); this.save(p); return p;
  }
  idle(p) {
    if (p.workflowRuns?.some(r => r.status === 'running') || p.versions.some(v => v.status === 'running') || p.concepts.some(c => c.status === 'running') || p.referenceSets.some(s => s.status === 'running')) throw new AppError('Wait for the current generation to finish', 409);
  }
  update(id, input, actor) {
    const p = this.get(id); this.idle(p);
    const name = input.name === undefined ? p.name : text(input.name, 'Name', 160);
    const prompt = input.prompt === undefined ? p.prompt : text(input.prompt, 'Prompt');
    const profile = referenceProfile(input.profile ?? (prompt === p.prompt ? p.profile : undefined), prompt);
    if (input.checkpoints !== undefined && actor !== 'web') throw new AppError('Change checkpoint settings in the web UI', 403);
    const settings = checkpoints(input.checkpoints, p.checkpoints);
    const consistency = consistencySettings(input.consistencySettings, p.consistencySettings);
    const refinement = refinementSettings(input.refinementSettings, p.refinementSettings);
    if (prompt !== p.prompt || profile !== p.profile) { p.inputReview = 'pending'; p.inputCheckpoint = settings.input; p.selectedConceptId = null; p.selectedReferenceSetId = null; }
    // Changing settings never silently approves an already waiting checkpoint.
    if (settings.input && !p.checkpoints.input) { p.inputReview = 'pending'; p.inputCheckpoint = true; }
    p.checkpoints = settings;
    const consistencyChanged = JSON.stringify(consistency) !== JSON.stringify(p.consistencySettings);
    p.consistencySettings = consistency;
    if (JSON.stringify(refinement) !== JSON.stringify(p.refinementSettings)) this.event(p, actor, 'refinement_settings_updated', { refinementSettings: refinement });
    p.refinementSettings = refinement;
    p.name = name; p.prompt = prompt; p.profile = profile;
    this.event(p, actor, 'project_updated');
    if (consistencyChanged) this.event(p, actor, 'consistency_settings_updated', { consistencySettings: { ...consistency } });
    this.save(p); return p;
  }
  addReference(id, input, actor) {
    const p = this.get(id); this.idle(p);
    const { bytes, ext } = imageData(input.image);
    const label = text(input.label, 'Reference label', 200);
    const r = { id: randomUUID(), label, file: '', review: 'pending' };
    r.file = `reference-${r.id}.${ext}`;
    fs.writeFileSync(path.join(this.dir(id), r.file), bytes);
    p.references.push(r); this.event(p, actor, 'reference_added', { referenceId: r.id }); this.save(p); return p;
  }
  reviewReference(id, refId, decision, actor) {
    const p = this.get(id); this.idle(p);
    const r = p.references.find(r => r.id === refId);
    if (!r) throw new AppError('Reference not found', 404);
    if (!['approved', 'rejected'].includes(decision)) throw new AppError('Choose approved or rejected');
    // This boundary is human review, even when the reference was supplied by an AI.
    if (actor !== 'web') throw new AppError('Reference approval requires the web UI', 403);
    r.review = decision; this.event(p, actor, 'reference_reviewed', { referenceId: refId, decision }); this.save(p); return p;
  }
  async selectModels(id, input, actor) {
    const release = this.beginOperation(id);
    try {
      const p = this.get(id); this.idle(p);
      if (!Array.isArray(input.models) || input.models.length > 32) throw new AppError('Select zero to 32 library models');
      const seen = new Set();
      const selections = [];
      for (const item of input.models) {
        if (!item || typeof item.assetId !== 'string' || seen.has(item.assetId)) throw new AppError('Choose unique library model IDs');
        seen.add(item.assetId);
        if (!['reference-only', 'reuse-edit'].includes(item.permission)) throw new AppError('Specify reference-only or reuse-edit permission');
        if (item.role !== undefined && (typeof item.role !== 'string' || item.role.length > 1000)) throw new AppError('Role must contain at most 1000 characters');
        const a = await this.library.inspected(item.assetId);
        const selection = { assetId: a.id, name: a.name, origin: a.sourceId ? 'folder' : 'managed', role: (item.role || '').trim(), permission: item.permission, sha256: a.sha256, review: 'pending' };
        const previous = p.modelReferences.find(r => r.assetId === a.id);
        if (previous && previous.role === selection.role && previous.permission === selection.permission && previous.sha256 === a.sha256) selection.review = previous.review;
        selections.push(selection);
      }
      // An asynchronous inspection must not mutate a newly running project.
      this.idle(p);
      p.modelReferences = selections;
      this.event(p, actor, 'model_references_selected', { models: structuredClone(selections) }); this.save(p); return p;
    } finally { release(); }
  }
  // A deliberate studio action selects and approves only this exact source.
  // Inspection/validation finish before either selections or audit history change.
  async useModel(id, input, actor) {
    if (actor !== 'web') throw new AppError('Source use requires a human in the web UI', 403);
    const release = this.beginOperation(id);
    try {
      const p = this.get(id); this.idle(p);
      if (!['reference', 'parts', 'remove'].includes(input.use)) throw new AppError('Choose how to use this model');
      if (typeof input.assetId !== 'string') throw new AppError('Choose a model');
      if (input.use === 'remove') {
        p.modelReferences = p.modelReferences.filter(r => r.assetId !== input.assetId);
        this.event(p, actor, 'model_reference_removed', { assetId: input.assetId }); this.save(p); return p;
      }
      if (input.use === 'parts' && input.copyConsent !== true) throw new AppError('Confirm that you can copy and change parts of this model', 403);
      if (input.role !== undefined && (typeof input.role !== 'string' || input.role.length > 1000)) throw new AppError('Role must contain at most 1000 characters');
      if (!p.modelReferences.some(r => r.assetId === input.assetId) && p.modelReferences.length >= 32) throw new AppError('Select at most 32 models');
      const a = await this.library.inspected(input.assetId);
      if (a.sha256 !== input.sha256 || this.library.verify(this.library.get(a.id)).sha256 !== a.sha256) throw new AppError('Model changed; choose it again', 409);
      this.idle(p);
      const selection = { assetId: a.id, name: a.name, origin: a.sourceId ? 'folder' : 'managed', role: (input.role || '').trim(), permission: input.use === 'parts' ? 'reuse-edit' : 'reference-only', sha256: a.sha256, review: 'approved' };
      const index = p.modelReferences.findIndex(r => r.assetId === a.id);
      if (index < 0 && p.modelReferences.length >= 32) throw new AppError('Select at most 32 models');
      if (index < 0) p.modelReferences.push(selection); else p.modelReferences[index] = selection;
      this.event(p, actor, 'model_references_selected', { models: structuredClone(p.modelReferences) });
      this.event(p, actor, 'model_reference_reviewed', { ...selection, decision: 'approved', intent: input.use });
      this.save(p); return p;
    } finally { release(); }
  }
  reviewModelReference(id, assetId, decision, actor) {
    const p = this.get(id); this.idle(p);
    if (actor !== 'web') throw new AppError('3D reference and reuse permission approval requires the web UI', 403);
    if (!['approved', 'rejected'].includes(decision)) throw new AppError('Choose approved or rejected');
    const r = p.modelReferences.find(r => r.assetId === assetId);
    if (!r) throw new AppError('Selected model not found', 404);
    if (decision === 'approved' && this.library.verify(this.library.get(assetId)).sha256 !== r.sha256) throw new AppError('Model changed; reselect it before approval', 409);
    r.review = decision;
    this.event(p, actor, 'model_reference_reviewed', { assetId, role: r.role, permission: r.permission, sha256: r.sha256, decision }); this.save(p); return p;
  }
  reviewVersion(id, versionId, decision, actor) {
    const p = this.get(id);
    const v = p.versions.find(v => v.id === versionId);
    if (!v || v.status !== 'ready') throw new AppError('Choose a completed version');
    if (!['approved', 'rejected'].includes(decision)) throw new AppError('Choose approved or rejected');
    if (v.checkpoints?.preview && actor !== 'web') throw new AppError('Preview checkpoint requires a decision in the web UI', 403);
    if (v.workflowRunId && !v.workflowReviewed) throw new AppError('Review this candidate through its workflow node', 409);
    if (decision === 'approved' && v.editableBase && (v.preservation?.passed !== true || v.preservation?.roundtrip?.passed !== true)) throw new AppError('Candidate violates protected base features', 409);
    v.review = decision;
    if (decision === 'approved') p.acceptedVersionId = v.id;
    else if (p.acceptedVersionId === v.id) p.acceptedVersionId = null;
    this.event(p, actor, 'model_reviewed', { versionId, decision }); this.save(p); return p;
  }
  reviewInput(id, decision, actor) {
    const p = this.get(id); this.idle(p);
    if (actor !== 'web') throw new AppError('Input checkpoint requires the web UI', 403);
    if (!['approved', 'rejected'].includes(decision)) throw new AppError('Choose approved or rejected');
    p.inputReview = decision;
    this.event(p, actor, 'input_reviewed', { decision }); this.save(p); return p;
  }
  reviewConcept(id, conceptId, decision, actor) {
    const p = this.get(id); this.idle(p);
    if (actor !== 'web') throw new AppError('Concept checkpoint requires the web UI', 403);
    const c = p.concepts.find(c => c.id === conceptId && c.status === 'ready');
    if (!c || !currentConcept(p, c)) throw new AppError('Choose a completed concept for the current input');
    if (!['approved', 'rejected'].includes(decision)) throw new AppError('Choose approved or rejected');
    c.review = decision;
    if (decision === 'approved') { if (p.selectedConceptId !== c.id) p.selectedReferenceSetId = null; p.selectedConceptId = c.id; }
    else if (p.selectedConceptId === c.id) { p.selectedConceptId = null; p.selectedReferenceSetId = null; }
    this.event(p, actor, 'concept_reviewed', { conceptId, decision }); this.save(p); return p;
  }
  reviewReferenceSet(id, setId, decision, actor) {
    const p = this.get(id); this.idle(p);
    if (actor !== 'web') throw new AppError('Multi-view checkpoint requires the web UI', 403);
    const set = p.referenceSets.find(s => s.id === setId && s.status === 'ready');
    if (!set || !currentReferenceSet(p, set)) throw new AppError('Choose a completed reference set for the selected concept');
    if (!['approved', 'rejected'].includes(decision)) throw new AppError('Choose approved or rejected');
    if (decision === 'approved') {
      validateViewSet(set);
      if (!consistencyAllowsModeling(set)) throw new AppError('Resolve reference contradictions or inspection errors by regenerating the set before modeling', 409);
      if (currentReferenceSet(p, set)) p.selectedReferenceSetId = set.id;
    } else if (p.selectedReferenceSetId === set.id) p.selectedReferenceSetId = null;
    set.review = decision;
    this.event(p, actor, 'reference_set_reviewed', { referenceSetId: set.id, conceptId: set.conceptId, decision }); this.save(p); return p;
  }
  canExport(id, versionId) {
    const p = this.get(id), v = p.versions.find(v => v.id === versionId && v.status === 'ready');
    if (!v) throw new AppError('Choose a completed version');
    if (v.workflowRunId && (!v.workflowReviewed || v.review !== 'approved')) throw new AppError('Approve the workflow candidate before export', 409);
    if (v.editableBase && v.preservation?.passed !== true) throw new AppError('Candidate lacks preservation evidence', 409);
    if (v.workflowRunId) {
      const run = p.workflowRuns.find(r => r.id === v.workflowRunId);
      for (const cp of run.checkpoints) {
        const { record, recordHash, ...saved } = cp;
        if (hash(saved) !== recordHash || hash(JSON.parse(fs.readFileSync(this.artifact(id, record), 'utf8'))) !== recordHash) throw new AppError('Checkpoint record changed; export blocked', 409);
        for (const f of cp.files) if (fileHash(this.artifact(id, f.file)) !== f.sha256) throw new AppError('Checkpoint artifact changed; export blocked', 409);
      }
    }
    if (v.checkpoints?.preview && v.review !== 'approved') throw new AppError('Approve the 3D preview in the web UI before export', 409);
    return v;
  }
  artifact(id, relative) {
    const p = this.get(id);
    const files = [...(p.workflowRuns || []).flatMap(r => [...(r.artifacts || []), ...r.checkpoints.flatMap(c => [c.record, ...c.files.map(f => f.file)])]), p.inputImage, ...p.references.map(r => r.file), ...p.concepts.flatMap(c => Object.values(c.artifacts || {})), ...p.referenceSets.flatMap(s => [...s.images.map(i => i.file), ...Object.values(s.artifacts || {})]), ...p.versions.flatMap(v => [...Object.values(v.artifacts || {}), ...(v.modelReferenceVisuals || []).flatMap(r => [r.sheet, ...r.views.map(view => view.image)]), ...(v.refinement?.iterations || []).flatMap(c => Object.values(c.artifacts || {}))])].filter(Boolean);
    if (!files.includes(relative)) throw new AppError('Artifact not found', 404);
    const file = path.resolve(this.dir(id), relative);
    if (!file.startsWith(this.dir(id) + path.sep) || !fs.lstatSync(file).isFile()
      || !fs.realpathSync(file).startsWith(fs.realpathSync(this.dir(id)) + path.sep)) throw new AppError('Invalid artifact');
    return file;
  }
  imageArtifact(id, relative) {
    const file = this.artifact(id, relative), ext = path.extname(file).slice(1);
    if (!['png', 'jpg', 'webp'].includes(ext) || fs.statSync(file).size > 10_000_000) throw new AppError('Invalid or oversized image artifact', 409);
    imageData(`data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(file).toString('base64')}`);
    return file;
  }
}
