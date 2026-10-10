import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store, AppError } from './store.js';
import { Runner } from './runner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.json': 'application/json', '.jsonl': 'text/plain', '.md': 'text/plain', '.txt': 'text/plain' };
async function body(req, maxBytes = 14_100_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError('Request too large', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return value;
  }
  catch { throw new AppError('Invalid JSON'); }
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
}
function sendFile(res, file, download) {
  const stat = fs.statSync(file);
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache', ...(download ? { 'Content-Disposition': `attachment; filename="${path.basename(file)}"` } : {}) });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

export function createApp({ dataDir = process.env.GEN3D_DATA_DIR || path.join(os.homedir(), '.gen3d'), generate, conceptGenerator, inspectReferences, inspectModel, inspectAsset, env = process.env } = {}) {
  // A single server owns the data directory, even if a second process starts.
  fs.mkdirSync(dataDir, { recursive: true });
  const lockFile = path.join(path.resolve(dataDir), 'server.lock');
  if (fs.existsSync(lockFile)) {
    const pid = Number(fs.readFileSync(lockFile, 'utf8'));
    try { process.kill(pid, 0); throw new AppError('This data directory already has a running gen3d server', 409); }
    catch (e) { if (e.code !== 'ESRCH') throw e; fs.unlinkSync(lockFile); }
  }
  fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
  let store;
  try { store = new Store(dataDir, { env, inspect: inspectAsset }); }
  catch (e) { fs.unlinkSync(lockFile); throw e; }
  const runner = new Runner(store, { generate, conceptGenerator, inspectReferences, inspectModel, env });
  const server = http.createServer(async (req, res) => {
    try {
      const address = server.address();
      const expectedHost = `127.0.0.1:${address.port}`;
      // Block cross-site writes and DNS rebinding to the local execution API.
      if (req.headers.host !== expectedHost && req.headers.host !== `localhost:${address.port}`) throw new AppError('Invalid host', 403);
      if (req.headers.origin && ![`http://${expectedHost}`, `http://localhost:${address.port}`].includes(req.headers.origin)) throw new AppError('Cross-origin requests are not allowed', 403);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      const url = new URL(req.url, `http://${expectedHost}`);
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] === 'api') {
        const actor = req.headers['x-gen3d-client'] === 'mcp' ? 'mcp' : 'web';
        if (req.method !== 'GET' && !req.headers['content-type']?.startsWith('application/json')) throw new AppError('Use application/json', 415);
        if (parts[1] === 'status' && req.method === 'GET') return json(res, 200, { busy: runner.active, usageLimited: runner.usageLimited, blenderPort: Number(env.GEN3D_BLENDER_PORT || 9877) });
        if (parts[1] === 'library') {
          const library = store.library;
          if (parts.length === 2 && req.method === 'GET') return json(res, 200, library.list(Object.fromEntries(url.searchParams)));
          if (parts[2] === 'imports' && req.method === 'POST') return json(res, 201, await library.import(await body(req, 90_000_000)));
          if (parts[2] === 'sources' && parts.length === 3 && req.method === 'POST') return json(res, 201, library.addSource(await body(req), actor));
          if (parts[2] === 'sources' && parts[4] === 'scan' && req.method === 'POST') return json(res, 200, library.scan(parts[3]));
          if (parts[2] === 'assets' && parts.length === 4 && req.method === 'GET') return json(res, 200, library.get(parts[3]));
          if (parts[2] === 'assets' && parts[4] === 'inspect' && req.method === 'POST') return json(res, 200, await library.inspected(parts[3]));
          if (parts[2] === 'assets' && parts[4] === 'preview' && req.method === 'GET') return sendFile(res, library.preview(parts[3]));
          throw new AppError('Library route not found', 404);
        }
        if (parts[1] === 'projects' && parts[3] === 'model-references' && req.method === 'POST') {
          if (parts.length === 4) return json(res, 200, await store.selectModels(parts[2], await body(req), actor));
          if (parts[5] === 'review') return json(res, 200, store.reviewModelReference(parts[2], parts[4], (await body(req)).decision, actor));
        }
        if (parts[1] !== 'projects') throw new AppError('Route not found', 404);
        const id = parts[2];
        if (!id && req.method === 'GET') return json(res, 200, store.list());
        if (!id && req.method === 'POST') return json(res, 201, store.create(await body(req), actor));
        if (id && parts.length === 3 && req.method === 'GET') return json(res, 200, store.get(id));
        if (id && parts.length === 3 && req.method === 'PATCH') return json(res, 200, store.update(id, await body(req), actor));
        if (parts[3] === 'artifacts' && req.method === 'GET') {
          const relative = parts.slice(4).join('/');
          if (url.searchParams.has('download') && parts[4] === 'versions') store.canExport(id, parts[5]);
          return sendFile(res, store.artifact(id, relative), url.searchParams.has('download'));
        }
        if (req.method === 'POST' && parts[3] === 'input' && parts[4] === 'review') return json(res, 200, store.reviewInput(id, (await body(req)).decision, actor));
        if (req.method === 'POST' && parts[3] === 'concepts' && parts.length === 4) return json(res, 202, runner.regenerateConcept(id, await body(req), actor));
        if (req.method === 'POST' && parts[3] === 'concepts' && parts[5] === 'review') return json(res, 200, runner.reviewConcept(id, parts[4], (await body(req)).decision, actor));
        if (req.method === 'POST' && parts[3] === 'reference-sets' && parts.length === 4) return json(res, 202, runner.regenerateReferenceSet(id, await body(req), actor));
        if (req.method === 'POST' && parts[3] === 'reference-sets' && parts[5] === 'review') return json(res, 200, runner.reviewReferenceSet(id, parts[4], (await body(req)).decision, actor));
        if (req.method === 'GET' && parts[3] === 'versions' && parts[5] === 'export') return json(res, 200, store.canExport(id, parts[4]).artifacts);
        if (req.method === 'POST' && parts[3] === 'versions' && parts[5] === 'refinement-review') return json(res, 200, runner.requestRefinementReview(id, parts[4], actor));
        if (req.method === 'POST' && parts[3] === 'generate') return json(res, 202, runner.start(id, await body(req), actor));
        if (req.method === 'POST' && parts[3] === 'references' && parts.length === 4) return json(res, 201, store.addReference(id, await body(req), actor));
        if (req.method === 'POST' && parts[3] === 'references' && parts[5] === 'review') return json(res, 200, store.reviewReference(id, parts[4], (await body(req)).decision, actor));
        if (req.method === 'POST' && parts[3] === 'versions' && parts[5] === 'review') return json(res, 200, store.reviewVersion(id, parts[4], (await body(req)).decision, actor));
        throw new AppError('Route not found', 404);
      }
      if (req.method !== 'GET') throw new AppError('Method not allowed', 405);
      const file = url.pathname === '/' ? path.join(root, 'web/index.html')
        : url.pathname.startsWith('/vendor/three/') ? path.resolve(root, 'node_modules/three', url.pathname.slice('/vendor/three/'.length))
          : path.resolve(root, 'web', '.' + url.pathname);
      const allowed = url.pathname.startsWith('/vendor/three/') ? path.join(root, 'node_modules/three') : path.join(root, 'web');
      if (!file.startsWith(allowed + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new AppError('File not found', 404);
      return sendFile(res, file);
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Local server error. Check artifact files and server output.' });
      else res.destroy();
      if (!e.status) console.error(e.message);
    }
  });
  // Closing HTTP stops requests, but modeling may still be saving project state.
  const closed = new Promise((resolve, reject) => {
    server.once('close', () => {
      Promise.resolve(runner.pending).then(() => {
        if (fs.existsSync(lockFile) && fs.readFileSync(lockFile, 'utf8') === String(process.pid)) fs.unlinkSync(lockFile);
      }).then(resolve, reject);
    });
  });
  return { server, store, runner, closed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.GEN3D_PORT || 3333);
  app.server.listen(port, '127.0.0.1', () => console.log(`gen3d: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    // Do not let a restarted server overlap a modeling job still using Blender.
    app.server.close(async () => { await app.closed; process.exit(0); });
  });
}
