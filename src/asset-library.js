import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import { runProcess } from './codex.js';

export const maxAssetBytes = 64 * 1024 * 1024;
const runtime = fileURLToPath(new URL('../blender/reference_runtime.py', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const validBlendHeader = bytes => /^BLENDER(?:[_-][vV][0-9]{3}|17-01[vV][0-9]{4})$/.test(bytes.subarray(0, bytes.toString('ascii', 0, 9) === 'BLENDER17' ? 17 : 12).toString());
const inside = (root, file) => file.startsWith(root + path.sep);
export function validateModel(bytes, filename) {
  const format = path.extname(filename).toLowerCase().slice(1);
  if (!['glb', 'blend'].includes(format)) throw new AppError('Only self-contained GLB and uncompressed .blend models are supported');
  if (!bytes.length || bytes.length > maxAssetBytes) throw new AppError('Model must contain 1 byte–64 MiB');
  if (format === 'blend') {
    if (!validBlendHeader(bytes) || bytes.length < 32) throw new AppError('Invalid .blend header. Save an uncompressed, packed Blender file');
  } else {
    try {
      if (bytes.length < 28 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error();
      let offset = 12, json, binSize = 0;
      while (offset < bytes.length) {
        const size = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
        if (size % 4 || offset + 8 + size > bytes.length) throw Error();
        if (offset === 12 && type !== 0x4e4f534a) throw Error();
        if (type === 0x4e4f534a) { if (json) throw Error(); json = JSON.parse(bytes.toString('utf8', offset + 8, offset + 8 + size)); }
        else if (type === 0x004e4942) { if (binSize) throw Error(); binSize = size; }
        else throw Error();
        offset += 8 + size;
      }
      if (json?.asset?.version !== '2.0' || !json.meshes?.length) throw Error();
      for (const item of [...(json.buffers || []), ...(json.images || [])]) {
        if (item.uri !== undefined && (typeof item.uri !== 'string' || !/^data:[\w/+.-]+;base64,[A-Za-z0-9+/]*={0,2}$/.test(item.uri))) throw new AppError('GLB must embed every buffer and texture; external resources are unsupported');
      }
      const buffers = json.buffers || [], views = json.bufferViews || [];
      for (const [i, b] of buffers.entries()) {
        const available = b.uri ? Buffer.from(b.uri.split(',')[1], 'base64').length : binSize;
        if (!Number.isInteger(b.byteLength) || b.byteLength < 0 || b.byteLength > available || !b.uri && i !== 0) throw Error();
      }
      for (const view of views) {
        const offset = view.byteOffset || 0;
        if (!Number.isInteger(view.buffer) || !buffers[view.buffer] || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(view.byteLength) || view.byteLength <= 0 || offset + view.byteLength > buffers[view.buffer].byteLength) throw Error();
      }
      for (const image of json.images || []) {
        if (!image.uri && (!Number.isInteger(image.bufferView) || !views[image.bufferView] || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType))) throw Error();
      }
    } catch (e) { if (e instanceof AppError) throw e; throw new AppError('Invalid GLB 2.0 container or missing mesh/resources'); }
  }
  return { format, size: bytes.length, sha256: hash(bytes) };
}

export class AssetLibrary {
  constructor(root, { env = process.env, inspect } = {}) {
    this.root = path.join(root, 'library');
    fs.mkdirSync(this.root, { recursive: true });
    this.root = fs.realpathSync(this.root);
    this.file = path.join(this.root, 'library.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { schemaVersion: 1, sources: [], assets: [] };
    if (this.state.schemaVersion !== 1 || !Array.isArray(this.state.assets) || !Array.isArray(this.state.sources)) throw new AppError('Unsupported model library schema; use a fresh gen3d data directory');
    this.env = env;
    this.pendingInspections = new Map();
    this.inspect = inspect || (async (asset, file) => {
      const dir = path.join(this.root, asset.id); fs.mkdirSync(dir, { recursive: true });
      const script = path.join(dir, 'inspect.py');
      fs.writeFileSync(script, `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.dirname(runtime))})\nimport reference_runtime as refs\ninfo = refs.inspect_file(${JSON.stringify(file)}, ${JSON.stringify(path.join(dir, 'preview.png'))})\nwith open(${JSON.stringify(path.join(dir, 'inspection.json'))}, 'w') as f:\n    json.dump(info, f)\n`);
      try {
        await runProcess(env.GEN3D_BLENDER_BIN || 'blender', ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', script], { timeout: 60000, env });
        return JSON.parse(fs.readFileSync(path.join(dir, 'inspection.json'), 'utf8'));
      } catch { throw new AppError('Blender could not inspect this model. Check Blender installation, file compatibility, packed resources and mesh limits', 409); }
    });
  }
  save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 2)); fs.renameSync(this.file + '.tmp', this.file); }
  get(id) { const a = this.state.assets.find(a => a.id === id); if (!a) throw new AppError('Library model not found', 404); return a; }
  resolve(a) {
    try {
      const source = a.sourceId && this.state.sources.find(s => s.id === a.sourceId);
      const root = source ? source.directory : this.root;
      if (a.sourceId && !source) throw Error();
      if (fs.realpathSync(root) !== root) throw Error();
      const file = path.resolve(root, a.file);
      if (!inside(root, file) || !fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) throw Error();
      if (fs.statSync(file).size > maxAssetBytes) throw Error();
      return file;
    } catch { throw new AppError(`${a.name}: source unavailable, moved, unsafe or oversized. Restore it or rescan its configured folder`, 409); }
  }
  verify(a) { return validateModel(fs.readFileSync(this.resolve(a)), a.name); }
  list({ search = '', sourceId = '', offset = 0, limit = 40 } = {}) {
    offset = Number(offset); limit = Number(limit);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100 || search.length > 200) throw new AppError('Invalid library query');
    const filtered = this.state.assets.filter(a => (!sourceId || a.sourceId === sourceId || sourceId === 'managed' && !a.sourceId) && a.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const assets = filtered.slice(offset, offset + limit).map(a => {
      let error = a.error || null; try { this.resolve(a); } catch (e) { error = e.message; }
      return { ...a, inspection: a.inspection ? { meshes: a.inspection.meshes, vertices: a.inspection.vertices } : null, error, origin: a.sourceId ? 'folder' : 'managed', preview: a.inspection && fs.existsSync(path.join(this.root, a.id, 'preview.png')) ? `/api/library/assets/${a.id}/preview` : null };
    });
    return { assets, total: filtered.length, offset, limit, sources: this.state.sources.map(s => { let error = s.error || null; try { if (!fs.statSync(s.directory).isDirectory() || fs.realpathSync(s.directory) !== s.directory) throw Error(); } catch { error = 'Configured folder is unavailable'; } return { ...s, error }; }) };
  }
  async import(input) {
    if (typeof input.name !== 'string' || input.name.length > 200 || !input.name.trim() || /[\/\\\x00-\x1f]/.test(input.name) || input.name === '..') throw new AppError('Use a filename without paths or control characters');
    if (typeof input.data !== 'string' || input.data.length > Math.ceil(maxAssetBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) throw new AppError('Provide model bytes as base64, at most 64 MiB');
    const bytes = Buffer.from(input.data, 'base64'), details = validateModel(bytes, input.name);
    const a = { id: randomUUID(), name: input.name, sourceId: null, ...details, createdAt: new Date().toISOString(), inspection: null };
    a.file = `${a.id}/model.${a.format}`;
    fs.mkdirSync(path.join(this.root, a.id)); fs.writeFileSync(path.join(this.root, a.file), bytes);
    try { a.inspection = await this.inspect(a, this.resolve(a)); if (this.verify(a).sha256 !== a.sha256) throw new AppError('Model changed during import', 409); }
    catch (e) { fs.rmSync(path.join(this.root, a.id), { recursive: true, force: true }); throw e; }
    this.state.assets.push(a); this.save(); return a;
  }
  addSource(input, actor) {
    if (actor !== 'web') throw new AppError('Configure folder access in the web UI', 403);
    if (typeof input.directory !== 'string' || !path.isAbsolute(input.directory) || input.directory.includes('\0')) throw new AppError('Choose an absolute local folder path');
    let directory;
    try { directory = fs.realpathSync(input.directory); if (!fs.statSync(directory).isDirectory()) throw Error(); } catch { throw new AppError('Local asset folder is unavailable'); }
    if (this.state.sources.some(s => s.directory === directory)) throw new AppError('This folder is already configured');
    const s = { id: randomUUID(), directory, error: null };
    this.state.sources.push(s); this.save(); this.scan(s.id); return s;
  }
  scan(id) {
    const s = this.state.sources.find(s => s.id === id); if (!s) throw new AppError('Folder source not found', 404);
    let count = 0, models = 0; s.error = null;
    const walk = (dir, depth) => {
      if (depth > 8) { s.error = 'Scan limited to 8 folder levels'; return; }
      const entries = fs.opendirSync(dir);
      try {
        let entry;
        while ((entry = entries.readSync()) !== null) {
          const name = entry.name;
          if (++count > 20000 || models >= 5000) { s.error = 'Scan limited to 20,000 entries / 5,000 models'; return; }
          const file = path.join(dir, name), stat = fs.lstatSync(file);
          if (stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) walk(file, depth + 1);
          else if (stat.isFile() && /\.(glb|blend)$/i.test(name)) {
            models++;
            const relative = path.relative(s.directory, file);
            let a = this.state.assets.find(a => a.sourceId === id && a.file === relative);
            if (!a) { a = { id: randomUUID(), sourceId: id, name: relative, file: relative, inspection: null, createdAt: new Date().toISOString() }; this.state.assets.push(a); }
            try {
              if (stat.size < 32 || stat.size > maxAssetBytes) throw new AppError('Invalid or oversized model (64 MiB maximum)');
              const fd = fs.openSync(file, 'r'); const header = Buffer.alloc(17);
              try { fs.readSync(fd, header, 0, 17, 0); } finally { fs.closeSync(fd); }
              const format = path.extname(name).slice(1).toLowerCase();
              if (format === 'glb' ? header.toString('ascii', 0, 4) !== 'glTF' || header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== stat.size : !validBlendHeader(header)) throw new AppError('Invalid model header; .blend must be uncompressed');
              if (a.size !== stat.size || a.mtimeMs !== stat.mtimeMs) a.inspection = null;
              Object.assign(a, { format, size: stat.size, mtimeMs: stat.mtimeMs, error: null });
            }
            catch (e) { a.error = e.message; a.inspection = null; }
          }
        }
      } finally { entries.closeSync(); }
    };
    try { if (fs.realpathSync(s.directory) !== s.directory) throw Error(); walk(s.directory, 0); }
    catch { s.error = 'Configured folder is unavailable or unreadable'; }
    this.save(); return this.list({ sourceId: id });
  }
  inspected(id) {
    if (!this.pendingInspections.has(id)) {
      const pending = this.inspectEntry(id).finally(() => this.pendingInspections.delete(id));
      this.pendingInspections.set(id, pending);
    }
    return this.pendingInspections.get(id);
  }
  async inspectEntry(id) {
    const a = this.get(id), info = this.verify(a);
    if (!a.inspection || a.sha256 !== info.sha256) {
      a.inspection = null;
      try { a.inspection = await this.inspect(a, this.resolve(a)); Object.assign(a, info, { mtimeMs: fs.statSync(this.resolve(a)).mtimeMs }); a.error = null; }
      catch (e) { a.error = e.message; this.save(); throw e; }
      // Do not accept files replaced while Blender was inspecting them.
      if (this.verify(a).sha256 !== info.sha256) { a.inspection = null; this.save(); throw new AppError('Model changed during inspection', 409); }
      this.save();
    }
    return structuredClone(a);
  }
  snapshot(selections) {
    const snapshots = selections.filter(s => s.review === 'approved').map(s => {
      const a = this.get(s.assetId), info = this.verify(a);
      if (!a.inspection || s.sha256 !== info.sha256) throw new AppError(`${a.name}: content changed; reselect and approve it in the Web UI`, 409);
      return { ...structuredClone(s), name: a.name, format: a.format, sourceId: a.sourceId, origin: a.sourceId ? 'folder' : 'managed', file: a.file, inspection: structuredClone(a.inspection) };
    });
    if (snapshots.reduce((n, s) => n + this.get(s.assetId).size, 0) > 256 * 1024 * 1024 || snapshots.reduce((n, s) => n + s.inspection.vertices, 0) > 8_000_000 || snapshots.reduce((n, s) => n + s.inspection.objects.length, 0) > 8000) throw new AppError('Selected references exceed 256 MiB, 8 million vertices or 8,000 objects per job', 409);
    return snapshots;
  }
  jobFiles(snapshots) {
    return snapshots.map(s => { const a = this.get(s.assetId); if (this.verify(a).sha256 !== s.sha256) throw new AppError(`${s.name}: source changed since job approval`, 409); return { ...s, path: this.resolve(a) }; });
  }
  preview(id) { const a = this.get(id); this.resolve(a); const file = path.join(this.root, a.id, 'preview.png'); if (!a.inspection || !fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) throw new AppError('Preview unavailable', 404); return file; }
}
