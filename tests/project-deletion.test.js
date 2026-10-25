import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { authorizeBase } from '../src/base-model.js';
import { createApp } from '../src/server.js';

const input = { name: 'Delete only me', mode: 'text', prompt: 'A cabinet' };
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen3d-delete-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
function gate() { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; }

test('deletion removes all project-owned data, persists across restart, and preserves shared/external data', t => {
  const root = temporary(t), store = new Store(root), p = store.create(input, 'web'), other = store.create(input, 'web');
  const external = temporary(t), externalFile = path.join(external, 'source.glb'); fs.writeFileSync(externalFile, 'original');
  const shared = path.join(store.library.root, 'shared.glb'); fs.writeFileSync(shared, 'shared');
  fs.writeFileSync(path.join(root, 'workflow-presets.json'), '[{"name":"keep"}]');
  p.modelReferences = other.modelReferences = [{ assetId: 'shared', origin: 'folder', file: externalFile }];
  store.save(p); store.save(other);
  const otherBytes = fs.readFileSync(path.join(store.dir(other.id), 'project.json'));
  for (const file of ['runs/run/node/checkpoint.json', 'versions/version/model.glb', 'versions/version/scene.blend', 'versions/version/refinement/1/review.json', 'concepts/concept/image.png', 'reference-sets/set/front.png']) {
    const target = path.join(store.dir(p.id), file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'generated');
  }
  // Nested links are unlinked, never recursively followed into asset sources.
  fs.symlinkSync(external, path.join(store.dir(p.id), 'external-link'));
  const dir = store.dir(p.id);
  assert.deepEqual(store.delete(p.id, 'web'), { id: p.id });
  assert.equal(fs.existsSync(dir), false);
  assert.throws(() => store.save(p), /not found/);
  assert.throws(() => store.dir(p.id), /not found/);
  assert.deepEqual(new Store(root).list().map(p => p.id), [other.id]);
  assert.deepEqual(fs.readFileSync(path.join(store.dir(other.id), 'project.json')), otherBytes);
  assert.equal(fs.readFileSync(shared, 'utf8'), 'shared');
  assert.equal(fs.readFileSync(externalFile, 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(root, 'workflow-presets.json'), 'utf8'), '[{"name":"keep"}]');
});

test('unknown IDs, traversal, substituted directories/manifests and identity mismatches cannot be deleted', t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web'), dir = store.dir(p.id), external = temporary(t);
  for (const id of [randomUUID(), '..', '../library', 'library', '', external, p.id + '/..']) assert.throws(() => store.delete(id, 'web'), /not found/);
  fs.renameSync(dir, path.join(external, p.id)); fs.symlinkSync(external, dir);
  assert.throws(() => store.delete(p.id, 'web'), /Unsafe/);
  assert.equal(fs.existsSync(path.join(external, p.id, 'project.json')), true);
  fs.unlinkSync(dir); fs.renameSync(path.join(external, p.id), dir);
  const manifest = path.join(dir, 'project.json'), moved = path.join(external, 'project.json');
  fs.renameSync(manifest, moved); fs.symlinkSync(moved, manifest);
  assert.throws(() => store.delete(p.id, 'web'), /Unsafe/);
  assert.throws(() => new Store(store.root), /Unsafe/);
  fs.unlinkSync(manifest); fs.renameSync(moved, manifest);
  fs.writeFileSync(manifest, JSON.stringify({ ...p, id: randomUUID() }));
  assert.throws(() => store.delete(p.id, 'web'), /Unsafe/);
  assert.throws(() => new Store(store.root), /Unsafe/);
  assert.equal(fs.existsSync(dir), true);
});

test('filesystem removal failures never report success or forget the project', t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web'), dir = store.dir(p.id);
  fs.writeFileSync(path.join(dir, 'model.glb'), 'generated');
  const original = fs.rmSync;
  try {
    fs.rmSync = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
    assert.throws(() => store.delete(p.id, 'web'), /Could not delete/);
    assert.equal(store.get(p.id), p); assert.equal(fs.existsSync(dir), true);
    fs.rmSync = () => {};
    assert.throws(() => store.delete(p.id, 'web'), /Could not delete/);
    assert.equal(store.get(p.id), p);
    fs.rmSync = (target, options) => { original(target, options); throw new Error('Partial removal failed'); };
    assert.throws(() => store.delete(p.id, 'web'), /Could not delete/);
    assert.equal(new Store(store.root).get(p.id).id, p.id, 'partial failure retains a restart-readable identity');
  } finally { fs.rmSync = original; }
  const originalRmdir = fs.rmdirSync;
  try {
    fs.rmdirSync = target => { if (target === dir) throw new Error('Directory removal failed'); return originalRmdir(target); };
    assert.throws(() => store.delete(p.id, 'web'), /Could not delete/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).id, p.id);
  } finally { fs.rmdirSync = originalRmdir; }
  store.delete(p.id, 'web');
});

test('all active project stages block deletion, while another project can be deleted', t => {
  const store = new Store(temporary(t)), p = store.create(input, 'web');
  for (const field of ['concepts', 'referenceSets', 'versions', 'workflowRuns']) {
    p[field].push({ status: 'running' });
    assert.throws(() => store.delete(p.id, 'web'), /Wait/);
    p[field].pop();
  }
  p.versions.push({ status: 'running', refinement: { status: 'running' } });
  const other = store.create(input, 'web'); store.delete(other.id, 'web');
  assert.equal(p.versions[0].status, 'running');
});

test('async library selection and base authorization block deletion until their final writes finish', async t => {
  for (const operation of ['selection', 'base']) {
    const store = new Store(temporary(t)), p = store.create(input, 'web'), barrier = gate();
    store.library.inspected = async () => { await barrier.promise; return { id: 'asset', name: 'Shared', sha256: 'hash', format: 'glb' }; };
    const pending = operation === 'selection' ? store.selectModels(p.id, { models: [{ assetId: 'asset', permission: 'reference-only' }] }, 'web')
      : authorizeBase(store, p.id, { assetId: 'asset', scope: { editableObjects: ['Mesh'] } }, 'web');
    assert.throws(() => store.delete(p.id, 'web'), /current operation/);
    barrier.release(); await pending;
    store.delete(p.id, 'web');
    assert.throws(() => store.save(p), /not found/);
    await assert.rejects(store.selectModels(p.id, { models: [] }, 'web'), /not found/);
    assert.equal(new Store(store.root).list().length, 0);
  }
});

test('a real in-flight generation cannot race deletion or restart and a deleted project cannot start writing again', async t => {
  const root = temporary(t), barrier = gate();
  const app = createApp({ dataDir: root, conceptGenerator: { generate: async () => { await barrier.promise; throw new Error('fixture stopped'); } } });
  t.after(async () => { barrier.release(); await app.runner.pending; app.server.close(); await app.closed; });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const p = app.store.create(input, 'web'); app.runner.start(p.id, {}, 'web');
  assert.throws(() => app.store.delete(p.id, 'web'), /Wait/);
  assert.throws(() => createApp({ dataDir: root }), /running gen3d server/);
  barrier.release(); await app.runner.pending;
  app.store.delete(p.id, 'web');
  assert.throws(() => app.runner.start(p.id, {}, 'web'), /not found/);
  assert.equal(new Store(root).list().length, 0);
});

test('HTTP deletion uses existing human actor, origin, content type and exact project route checks', async t => {
  const root = temporary(t), app = createApp({ dataDir: root });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.server.close(); await app.closed; });
  const url = `http://127.0.0.1:${app.server.address().port}`, p = app.store.create(input, 'web');
  const remove = (id, headers = {}) => fetch(url + '/api/projects/' + id, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers } });
  assert.equal((await remove(p.id, { 'x-gen3d-client': 'mcp' })).status, 403);
  assert.equal((await remove(p.id, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await remove(p.id, { 'Content-Type': 'text/plain' })).status, 415);
  for (const id of [randomUUID(), '%2e%2e%2flibrary', 'library', p.id + '/extra']) assert.equal((await remove(id)).status, 404);
  assert.equal((await fetch(url + '/api/projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })).status, 404);
  assert.throws(() => app.store.delete(p.id, 'mcp'), /human/);
  assert.throws(() => app.store.delete(p.id, 'system'), /human/);
  const response = await remove(p.id); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { id: p.id });
  assert.equal((await remove(p.id)).status, 404);
});
