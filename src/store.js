import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
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
  return { bytes, ext: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

// Only the HTTP server owns this store. MCP clients always use that server's API.
export class Store {
  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this.projects = new Map();
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.root, entry.name, 'project.json');
      if (!fs.existsSync(file)) continue;
      const project = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.projects.set(project.id, project);
      for (const version of project.versions) {
        if (version.status === 'running') {
          version.status = 'failed'; version.error = 'Server stopped during generation. Retry to create a new version.';
          this.event(project, 'server', 'generation_interrupted', { versionId: version.id });
        }
      }
      this.save(project);
    }
  }
  dir(id) { this.get(id); return path.join(this.root, id); }
  get(id) {
    const p = this.projects.get(id);
    if (!p) throw new AppError('Project not found', 404);
    return p;
  }
  list() { return [...this.projects.values()].map(p => structuredClone(p)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  event(p, actor, type, details = {}) {
    p.updatedAt = new Date().toISOString();
    p.activity.push({ id: randomUUID(), at: p.updatedAt, actor, type, ...details });
  }
  save(p) {
    const dir = path.join(this.root, p.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.json.tmp'), JSON.stringify(p, null, 2));
    fs.renameSync(path.join(dir, 'project.json.tmp'), path.join(dir, 'project.json'));
  }
  create(input, actor) {
    const name = text(input.name, 'Name', 160);
    if (!['text', 'image'].includes(input.mode)) throw new AppError('Mode must be text or image');
    const prompt = input.mode === 'text' ? text(input.prompt, 'Prompt') : (input.prompt ? text(input.prompt, 'Prompt') : 'Create a 3D model of the subject in the input image.');
    const image = input.mode === 'image' ? imageData(input.image) : null;
    const p = { id: randomUUID(), name, mode: input.mode, prompt, inputImage: null, references: [], versions: [], activity: [], updatedAt: '' };
    this.projects.set(p.id, p);
    if (image) {
      fs.mkdirSync(this.dir(p.id), { recursive: true });
      p.inputImage = `input.${image.ext}`;
      fs.writeFileSync(path.join(this.dir(p.id), p.inputImage), image.bytes);
    }
    this.event(p, actor, 'project_created'); this.save(p); return p;
  }
  idle(p) {
    if (p.versions.some(v => v.status === 'running')) throw new AppError('Wait for the current generation to finish', 409);
  }
  update(id, input, actor) {
    const p = this.get(id); this.idle(p);
    const name = input.name === undefined ? p.name : text(input.name, 'Name', 160);
    const prompt = input.prompt === undefined ? p.prompt : text(input.prompt, 'Prompt');
    p.name = name; p.prompt = prompt;
    this.event(p, actor, 'project_updated'); this.save(p); return p;
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
  reviewVersion(id, versionId, decision, actor) {
    const p = this.get(id);
    const v = p.versions.find(v => v.id === versionId);
    if (!v || v.status !== 'ready') throw new AppError('Choose a completed version');
    if (!['approved', 'rejected'].includes(decision)) throw new AppError('Choose approved or rejected');
    v.review = decision; this.event(p, actor, 'model_reviewed', { versionId, decision }); this.save(p); return p;
  }
  artifact(id, relative) {
    const p = this.get(id);
    const files = [p.inputImage, ...p.references.map(r => r.file), ...p.versions.flatMap(v => Object.values(v.artifacts || {}))].filter(Boolean);
    if (!files.includes(relative)) throw new AppError('Artifact not found', 404);
    const file = path.resolve(this.dir(id), relative);
    if (!file.startsWith(this.dir(id) + path.sep) || fs.lstatSync(file).isSymbolicLink()
      || !fs.realpathSync(file).startsWith(fs.realpathSync(this.dir(id)) + path.sep)) throw new AppError('Invalid artifact');
    return file;
  }
}
