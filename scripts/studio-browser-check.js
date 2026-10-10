// Deterministic browser regression using injected providers and previously recorded
// assets. No Codex, Blender process, external service or allowance is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { categories, anatomyCategories } from '../src/refinement.js';
import { createApp } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.GEN3D_BROWSER_OUTPUT || '.gen3d/studio-browser-check');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen3d-studio-browser-'));
const assets = path.join(root, 'docs/validation/issue10/prop');
const checkpoints = { input: false, concept: false, multiView: false, preview: false };
const png = fs.readFileSync(path.join(assets, 'concept-1/concept.png'));
let refinementPass = true, partialModelState;
let inspection = { consistent: true, issues: [] }, releaseModel, failConcept = false, failModel = false, partialViews = false;
const app = createApp({
  dataDir: path.join(temp, 'data'),
  conceptGenerator: {
    async generate() { if (failConcept) throw new Error('Fixture image provider unavailable'); return { bytes: png, ext: 'png' }; },
    async generateViews({ onImage }) {
      for (const view of ['front', 'side', 'back', 'three-quarter']) {
        await onImage({ view, side: view === 'side' ? 'left' : undefined, bytes: fs.readFileSync(path.join(assets, `set-1/${view}.png`)), ext: 'png' });
        if (partialViews) throw new Error('Fixture stopped after first view');
      }
    }
  },
  inspectReferences: async () => inspection,
  inspectModel: async ({ dir, renders, profile }) => {
    const acceptable = refinementPass && path.basename(dir) === '1';
    return { acceptable, summary: acceptable ? 'Fixture visual pass.' : 'Fixture torso discrepancy.', revisionTargets: acceptable ? [] : ['geometry'], revisionInstructions: acceptable ? [] : ['Narrow the torso mesh.'],
      views: renders.map(r => ({ view: r.view, observations: [...categories, ...(profile === 'character' ? anatomyCategories : [])].map((category, i) => ({ category, status: !acceptable && i === 1 ? 'discrepancy' : 'acceptable', detail: 'Synthetic browser fixture observation.' })) })) };
  },
  generate: async (p, v, dir) => {
    if (releaseModel) await new Promise(resolve => { releaseModel = resolve; });
    if (failModel) throw new Error('Fixture Blender bridge unavailable');
    for (const name of ['model.glb', 'scene.blend', 'preview.png', 'mcp-audit.jsonl']) fs.copyFileSync(path.join(assets, 'model-1', name), path.join(dir, name));
    if (v.refinementSettings?.enabled) {
      fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify({ sha256: (v.refinementCycle ? 'b' : 'a').repeat(64) }));
      for (const view of ['input', 'front', 'side', 'back', 'three-quarter']) fs.copyFileSync(path.join(assets, 'model-1/preview.png'), path.join(dir, view + '.png'));
    }
    if (partialModelState) {
      partialModelState.entered(); await partialModelState.gate;
      throw new Error('Fixture failure after partial model export');
    }
  }
});
let chrome, ws, page;
const checks = [], exceptions = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error('Timed out: ' + message);
}
try {
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function request(route, method = 'GET', input, mcp = false) {
    const res = await fetch(url + '/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(mcp ? { 'x-gen3d-client': 'mcp' } : {}) }, body: input ? JSON.stringify(input) : undefined });
    const data = await res.json(); assert.ok(res.ok, `${route}: ${JSON.stringify(data)}`); return data;
  }
  const automatic = await request('/projects', 'POST', { name: 'Workshop cabinet', mode: 'text', prompt: 'A teal cabinet with orange knobs and feet', checkpoints });
  await request(`/projects/${automatic.id}/generate`, 'POST', {}); await app.runner.pending;
  const browserBinary = process.env.GEN3D_CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
  assert.ok(browserBinary, 'Install Chrome/Chromium or set GEN3D_CHROME_BIN');
  const chromeDir = path.join(temp, 'chrome');
  chrome = spawn(browserBinary, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${chromeDir}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(chromeDir, 'DevToolsActivePort');
  await until(() => fs.existsSync(portFile), 'Chrome debugging port');
  const chromeUrl = `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8').split('\n')[0]}`;
  page = await (await fetch(chromeUrl + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0; const pending = new Map();
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
    if (m.id) { const item = pending.get(m.id); pending.delete(m.id); m.error ? item.reject(new Error(m.error.message)) : item.resolve(m.result); }
  };
  function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, result.exceptionDetails?.text); return result.result.value;
  }
  const visible = id => `!!document.getElementById(${JSON.stringify(id)})?.getClientRects().length`;
  const wait = expression => until(() => evaluate(expression), expression);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const select = (selector, value) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  async function fill(selector, values) {
    await evaluate(`(() => { const f = document.querySelector(${JSON.stringify(selector)}); for (const [key,value] of Object.entries(${JSON.stringify(values)})) { const e = f.elements[key]; if (e.type === 'checkbox') e.checked = value; else e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  }
  const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
  const stage = key => click('#nav-' + key);
  async function chooseProject(id) { await wait(visible('project-' + id)); await click('#project-' + id); await wait(`document.querySelector('#title').textContent === ${JSON.stringify(app.store.get(id).name)}`); }
  async function screenshot(name) {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  }
  const check = name => { checks.push(name); console.log('PASS ' + name); };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await chooseProject(automatic.id);
  await wait('document.querySelector("#viewer-message").hidden');
  assert.equal(await evaluate('document.querySelectorAll("#stages button").length'), 4);
  assert.equal(await evaluate('document.querySelectorAll(".stage-panel:not([hidden])").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll("#model-sources button").length'), 2);
  assert.ok(await evaluate(visible('download')));
  await screenshot('desktop-model');
  check('automatic text workflow, dominant GLB preview, source links and exports');

  const box = await evaluate(`(() => { const r = document.querySelector('#viewer canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const imageHash = async () => (await call('Page.captureScreenshot', { format: 'png' })).data;
  let before = await imageHash();
  for (const [name, button, dx, dy] of [['orbit', 'left', 100, 40], ['pan', 'right', 35, 0]]) {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + dx, y: box.y + dy, button, buttons: button === 'left' ? 1 : 2 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + dx, y: box.y + dy, button, clickCount: 1 });
    await pause(300); const after = await imageHash(); assert.notEqual(after, before, name); before = after;
  }
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...box, deltaX: 0, deltaY: -150 }); await pause(300); assert.notEqual(await imageHash(), before);
  await click('#fit');
  check('orbit, pan, zoom and fit-to-model');
  const download = await evaluate('document.querySelector("#download").href');
  const glb = await fetch(download); assert.ok(glb.ok); assert.equal(Buffer.from(await glb.arrayBuffer()).subarray(0, 4).toString(), 'glTF');
  assert.ok((await fetch(await evaluate('document.querySelector("#blend-download").href'))).ok);
  check('GLB and Blender scene download');
  const viewerCheck = spawn(process.execPath, [path.join(root, 'scripts/browser-check.js')], { env: { ...process.env, GEN3D_URL: url, GEN3D_CHROME_URL: chromeUrl, GEN3D_PROJECT_ID: automatic.id, GEN3D_BROWSER_OUTPUT: path.join(temp, 'viewer-browser-check') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let viewerError = ''; viewerCheck.stdout.resume(); viewerCheck.stderr.on('data', chunk => { viewerError = (viewerError + chunk.toString()).slice(-4000); });
  const [viewerExit] = await once(viewerCheck, 'exit'); assert.equal(viewerExit, 0, viewerError);
  await call('Page.bringToFront');
  check('existing browser validator adapted to stage selectors (recorded fixture assets)');
  await click('#model-sources button'); await wait(visible('stage-concept'));
  await wait('document.querySelector("#concepts img").naturalWidth > 0');
  await stage('views'); await wait('[...document.querySelectorAll("#reference-sets img")].every(i => i.complete && i.naturalWidth > 0)');
  assert.equal(await evaluate('document.querySelectorAll("#reference-sets img").length'), 5);
  await screenshot('desktop-views');
  check('concept and base/front/side/back/three-quarter images accessible after automatic generation');

  await stage('input');
  await fill('#edit', { prompt: 'Unsaved local design' });
  await request(`/projects/${automatic.id}`, 'PATCH', { name: 'MCP renamed cabinet' }, true);
  await wait('document.querySelector("#title").textContent === "MCP renamed cabinet"');
  assert.equal(await evaluate('document.querySelector("#edit").elements.prompt.value'), 'Unsaved local design');
  await fill('#edit', { prompt: 'A teal cabinet with orange knobs and feet', name: 'Workshop cabinet' }); await submit('#edit');
  await wait('document.querySelector("#title").textContent === "Workshop cabinet"');
  check('MCP polling updates header while preserving unsaved form edits');

  const review = await request('/projects', 'POST', { name: 'Review every stage', mode: 'text', prompt: 'A teal cabinet with orange knobs and feet', checkpoints: { input: true, concept: true, multiView: true, preview: true } });
  await chooseProject(review.id);
  assert.equal(await evaluate('document.querySelector("#next-action").textContent'), 'Review input');
  assert.ok(await evaluate('document.querySelector("#generate").disabled'));
  await click('#input-review button'); await wait('!document.querySelector("#generate").disabled');
  await click('#generate'); await wait(visible('stage-concept')); await wait('document.querySelector("#concept-review button") && !document.querySelector("#concept-review button").disabled');
  assert.equal(app.store.get(review.id).referenceSets.length, 0);
  await click('#concept-review button:nth-child(2)'); await wait('document.querySelector("#concept-info").textContent.includes("rejected")');
  await fill('#concept-retry', { feedback: 'Preserve the handle' }); await submit('#concept-retry');
  await wait('document.querySelector("#concept-selection").options.length === 2');
  await wait('document.querySelector("#concept-info").textContent.includes("ready")');
  await click('#concept-review button'); await wait(visible('stage-views'));
  await wait('document.querySelector("#view-review button") && !document.querySelector("#view-review button").disabled');
  assert.equal(app.store.get(review.id).versions.length, 0);
  await click('#view-review button:nth-child(2)'); await wait('document.querySelector("#view-info").textContent.includes("rejected")');
  await fill('#views-retry', { feedback: 'Keep the proportions' }); await submit('#views-retry');
  await wait('document.querySelector("#view-selection").options.length === 2'); await wait('document.querySelector("#view-info").textContent.includes("ready")');
  await click('#view-review button'); await wait(visible('stage-model')); await wait('document.querySelector("#viewer-message").hidden');
  assert.ok(await evaluate('document.querySelector("#download").hidden'));
  // Disabling future checkpoints must not approve the current preview.
  await evaluate('document.querySelector("#advanced").open = true');
  await fill('#checkpoints', { preview: false }); await submit('#checkpoints');
  await wait('document.querySelector("#checkpoints").elements.preview.checked === false');
  await pause(1700); assert.equal(app.store.get(review.id).versions[0].review, 'pending');
  assert.ok(await evaluate('document.querySelector("#download").hidden'));
  await click('#approve'); await wait(visible('download'));
  check('input, concept, view and preview approval/rejection/regeneration; settings cannot dismiss pending checkpoint');

  await fill('#revise', { feedback: 'Make the handle taller' }); await submit('#revise');
  await wait('document.querySelector("#versions").options.length === 2'); await wait('document.querySelector("#viewer-message").hidden');
  const previousVersion = app.store.get(review.id).versions[0];
  await select('#versions', previousVersion.id);
  releaseModel = true;
  await request(`/projects/${review.id}/generate`, 'POST', { kind: 'revision', sourceVersionId: previousVersion.id, feedback: 'MCP background revision' }, true);
  await wait('document.querySelector("#project-state").textContent.includes("running")');
  assert.equal(await evaluate('document.querySelector("#versions").value'), previousVersion.id);
  const release = releaseModel; releaseModel = null; release(); await app.runner.pending;
  await wait('document.querySelector("#versions").options.length === 3');
  assert.equal(await evaluate('document.querySelector("#versions").value'), previousVersion.id);
  assert.ok(await evaluate('document.querySelector("#render-image figcaption").textContent.includes("v1")'));
  await stage('concept'); await select('#concept-selection', app.store.get(review.id).concepts[0].id);
  await request(`/projects/${review.id}`, 'PATCH', { name: 'Review every stage updated by MCP' }, true);
  await wait('document.querySelector("#title").textContent.includes("updated by MCP")');
  assert.equal(await evaluate('document.querySelector("#concept-selection").value'), app.store.get(review.id).concepts[0].id);
  await stage('views'); await select('#view-selection', app.store.get(review.id).referenceSets[0].id);
  assert.ok(await evaluate('document.querySelector("#view-info").textContent.includes("View set 1")'));
  check('revision requests, historic concept/view/model selection stable during MCP generation and polling');

  const consistencyProject = await request('/projects', 'POST', { name: 'Consistency decisions', mode: 'text', prompt: 'A teal cabinet with orange knobs and feet', checkpoints });
  inspection = { consistent: false, issues: ['Fixture: side handle differs from base'] };
  await request(`/projects/${consistencyProject.id}/generate`, 'POST', {}); await app.runner.pending;
  await chooseProject(consistencyProject.id); await wait(visible('stage-views'));
  assert.equal(await evaluate('document.querySelector("#nav-views").dataset.state'), 'Failed');
  assert.ok(await evaluate('document.querySelector("#view-review button").disabled'));
  assert.ok(await evaluate('document.querySelector("#reference-sets").textContent.includes("blocked")'));
  await evaluate('document.querySelector("#reference-sets details").open = true');
  assert.ok(await evaluate('document.querySelector("#reference-sets").textContent.includes("side handle")'));
  assert.ok((await fetch(await evaluate('document.querySelector("#reference-sets a[href*=consistency]").href'))).ok);
  await evaluate('document.querySelector("#advanced").open = true');
  await fill('#consistency', { onFailure: 'continue' }); await submit('#consistency');
  await until(() => app.store.get(consistencyProject.id).consistencySettings.onFailure === 'continue', 'consistency save');
  assert.equal(app.store.get(consistencyProject.id).referenceSets[0].consistency.outcome, 'blocked');
  await submit('#views-retry'); await wait('document.querySelector("#view-selection").options.length === 2');
  await until(() => app.store.get(consistencyProject.id).versions[0]?.status === 'ready', 'continued model');
  await wait(visible('stage-model')); assert.ok(await evaluate('document.querySelector("#version-info").textContent.includes("WARNING")'));
  await stage('views'); assert.ok(await evaluate('document.querySelector("#reference-sets .warning").textContent.includes("Warn and continue")'));
  await fill('#consistency', { enabled: 'false' });
  assert.ok(await evaluate('document.querySelector("#consistency").elements.onFailure.disabled'));
  await submit('#consistency'); await until(() => !app.store.get(consistencyProject.id).consistencySettings.enabled, 'check off');
  await submit('#views-retry'); await until(() => app.store.get(consistencyProject.id).versions.length === 2 && app.store.get(consistencyProject.id).versions[1].status === 'ready', 'skipped model');
  await wait('document.querySelector("#view-selection").options.length === 3');
  await stage('views'); assert.ok(await evaluate('document.querySelector("#reference-sets").textContent.includes("skipped")'));
  check('Stop/continued/skipped consistency, effective policy, report access and saved settings');


  const humanoid = await request('/projects', 'POST', { name: 'Humanoid fixture', mode: 'image', prompt: 'A fictional adult human', image: 'data:image/png;base64,' + png.toString('base64'), profile: 'character', checkpoints });
  await request(`/projects/${humanoid.id}/generate`, 'POST', {}); await app.runner.pending;
  await chooseProject(humanoid.id); await wait(visible('stage-model'));
  assert.ok(await evaluate('!document.querySelector("[name=modelingMode]") && !document.querySelector("#comparison")'));
  await click('#retry');
  await until(() => app.store.get(humanoid.id).versions.length === 2 && app.store.get(humanoid.id).versions[1].status === 'ready', 'humanoid retry ready');
  await wait('document.querySelector("#versions").options.length === 2');
  await stage('input');
  assert.ok(await evaluate('!document.querySelector("#edit").elements.profile.closest("label").hidden'));
  await fill('#edit', { profile: 'object' }); await submit('#edit');
  await until(() => app.store.get(humanoid.id).profile === 'object', 'image profile saved');
  check('single Blender flow, humanoid retry and editable image profile (injected fixtures)');

  const refining = await request('/projects', 'POST', { name: 'Refinement fixture', mode: 'image', image: 'data:image/png;base64,' + png.toString('base64'), profile: 'object', checkpoints: { ...checkpoints, preview: true } });
  await chooseProject(refining.id); await click('#show-settings');
  assert.equal(await evaluate('document.querySelector("#refinement").elements.refinementEnabled.value'), 'false');
  await fill('#refinement', { refinementEnabled: 'true', maxIterations: 1 }); await submit('#refinement');
  await until(() => app.store.get(refining.id).refinementSettings.enabled, 'refinement enabled');
  await click('#generate'); await until(() => app.store.get(refining.id).versions[0]?.status === 'ready', 'refinement complete');
  await stage('model'); await wait('document.querySelector("#refinement-info").textContent.includes("passed")');
  await evaluate('document.querySelector("#refinement-history").open = true; document.querySelectorAll("#refinement-cycles details").forEach(e => e.open = true)');
  assert.equal(await evaluate('document.querySelectorAll("#refinement-cycles details").length'), 2);
  assert.equal(await evaluate('document.querySelectorAll("#refinement-cycles img").length'), 4);
  assert.ok(await evaluate('document.querySelector("#refinement-cycles").textContent.includes("Mesh change verified")'));
  assert.ok(await evaluate('document.querySelector("#download").hidden'));
  const reportLink = await evaluate('Array.from(document.querySelectorAll("#refinement-cycles a")).find(a => a.textContent === "comparison.json").href');
  assert.ok((await fetch(reportLink)).ok);
  async function inspectHistoryModels() {
    const links = await evaluate('Array.from(document.querySelectorAll("#refinement-cycles a")).filter(a => /\\.(glb|blend)$/.test(a.textContent)).map(a => a.href)');
    assert.ok(links.length >= 2);
    for (const href of links) { assert.equal(new URL(href).search, ''); assert.equal((await fetch(href)).status, 200); }
  }
  await inspectHistoryModels();
  assert.equal((await fetch(reportLink.replace('comparison.json', 'model.glb') + '?download=1')).status, 409);
  await evaluate('document.querySelector("#refinement-history").scrollIntoView()');
  await screenshot('refinement-history');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
  await screenshot('refinement-narrow');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await click('#approve'); await wait('!document.querySelector("#download").hidden');
  refinementPass = false;
  await click('#retry');
  await until(() => app.store.get(refining.id).versions[1]?.status === 'ready', 'refinement cap');
  await wait('document.querySelector("#version-info").textContent.includes("iteration-limit")');
  assert.ok(await evaluate('document.querySelector("#version-info").textContent.includes("unresolved discrepancies")'));
  assert.ok(await evaluate('document.querySelector("#download").hidden'));
  refinementPass = true;
  check('refinement Off default, saved enable/cycle limit, original references, cycle renders/reports/mesh evidence and final human review (mocked)');

  let releasePartial, enteredPartial;
  const partialGate = new Promise(resolve => { releasePartial = resolve; });
  const partialStarted = new Promise(resolve => { enteredPartial = resolve; });
  partialModelState = { gate: partialGate, entered: enteredPartial };
  const partialModel = await request('/projects', 'POST', { name: 'Partial model history', mode: 'image', image: 'data:image/png;base64,' + png.toString('base64'), profile: 'object', checkpoints, refinementSettings: { enabled: true, maxIterations: 1 } });
  try {
    await request(`/projects/${partialModel.id}/generate`, 'POST', {}); await partialStarted;
    await chooseProject(partialModel.id); await stage('model');
    await wait('Array.from(document.querySelectorAll("#refinement-cycles a")).some(a => a.textContent === "model.glb")');
    await inspectHistoryModels();
    assert.ok(await evaluate('document.querySelector("#download").hidden'));
    const partialLink = await evaluate('Array.from(document.querySelectorAll("#refinement-cycles a")).find(a => a.textContent === "model.glb").href');
    assert.equal((await fetch(partialLink + '?download=1')).status, 400);
    releasePartial(); await app.runner.pending;
    await wait('document.querySelector("#version-info").textContent.includes("failed")');
    await inspectHistoryModels();
    assert.equal((await fetch(partialLink + '?download=1')).status, 400);
    assert.ok(await evaluate('document.querySelector("#download").hidden'));
  } finally { releasePartial(); await app.runner.pending; partialModelState = null; }
  check('actual running and failed GLB/Blender history links return 200; final download remains gated (mocked)');

  // Create and upload through the actual browser form.
  await click('#new-project'); await wait('document.querySelector("#create-dialog").open');
  await fill('#create', { name: 'Image path', mode: 'image', prompt: 'Use this silhouette', preview: false });
  assert.ok(await evaluate('document.querySelector("#create .concept-setting").hidden'));
  const dom = await call('DOM.getDocument');
  const upload = await call('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#create input[type=file]' });
  await call('DOM.setFileInputFiles', { nodeId: upload.nodeId, files: [path.join(assets, 'concept-1/concept.png')] });
  await submit('#create'); await wait('document.querySelector("#title").textContent === "Image path"');
  assert.equal(await evaluate('document.querySelectorAll("#stages button").length'), 2);
  await wait('document.querySelector("#input-image img").naturalWidth > 0');
  await click('#generate'); await wait(visible('stage-model')); await wait('document.querySelector("#viewer-message").hidden');
  await click('#reject'); await wait('document.querySelector("#version-info").textContent.includes("rejected")');
  await click('#retry'); await wait('document.querySelector("#versions").options.length === 2'); await wait('document.querySelector("#viewer-message").hidden');
  const imageProject = app.store.list().find(p => p.name === 'Image path');
  await request(`/projects/${imageProject.id}/references`, 'POST', { label: 'MCP supplement', image: 'data:image/png;base64,' + png.toString('base64') }, true);
  await wait('document.querySelector("#next-action").textContent === "Review references"'); await click('#next-action');
  assert.ok(await evaluate('document.querySelector("#references").closest("details").open'));
  await click('#references button'); await wait('document.querySelector("#references figcaption").textContent.includes("approved")');
  check('browser project creation/image upload, reduced image path, model rejection/retry and MCP supplementary review');

  failConcept = true;
  const failed = await request('/projects', 'POST', { name: 'Failure presentation', mode: 'text', prompt: 'Failure fixture', checkpoints });
  await request(`/projects/${failed.id}/generate`, 'POST', {}); await app.runner.pending; await chooseProject(failed.id);
  await wait('document.querySelector("#concept-info").textContent.includes("Fixture image provider unavailable")');
  assert.equal(await evaluate('document.querySelector("#nav-concept").dataset.state'), 'Failed');
  failConcept = false;
  failModel = true;
  await chooseProject(imageProject.id); await stage('model'); await click('#retry');
  await wait('document.querySelector("#version-info").textContent.includes("Fixture Blender bridge unavailable")');
  assert.ok(await evaluate('!document.querySelector("#viewer-message").hidden'));
  failModel = false;
  check('generation errors, failed stage states and empty GLB presentation');

  inspection = null;
  const inspectionError = await request('/projects', 'POST', { name: 'Inspection error', mode: 'text', prompt: 'Inspection error fixture', checkpoints });
  await request(`/projects/${inspectionError.id}/generate`, 'POST', {}); await app.runner.pending; await chooseProject(inspectionError.id);
  await wait('document.querySelector("#view-info").textContent.includes("Invalid reference consistency report")');
  assert.ok(await evaluate('document.querySelector("#reference-sets").textContent.includes("Consistency: error")'));
  inspection = { consistent: true, issues: [] }; partialViews = true;
  const partial = await request('/projects', 'POST', { name: 'Partial images', mode: 'text', prompt: 'Partial fixture', checkpoints });
  await request(`/projects/${partial.id}/generate`, 'POST', {}); await app.runner.pending; await chooseProject(partial.id);
  await wait('document.querySelector("#view-info").textContent.includes("Fixture stopped after first view")');
  assert.equal(await evaluate('document.querySelectorAll("#reference-sets img").length'), 2);
  partialViews = false;
  check('inspection errors and partially generated image sets remain accessible');

  await chooseProject(automatic.id); await stage('model'); await wait('document.querySelector("#viewer-message").hidden');
  await call('Page.reload'); await wait('document.querySelector("#title").textContent === "Workshop cabinet"'); await wait(visible('stage-model'));
  check('refresh restores selected project and current artifact');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await pause(300);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  for (const key of ['input', 'concept', 'views', 'model']) { await stage(key); assert.ok(await evaluate(visible('stage-' + key))); assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth')); }
  await wait('document.querySelector("#viewer-message").hidden'); await screenshot('narrow-model');
  await stage('views'); await screenshot('narrow-views');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await stage('input'); await evaluate('document.querySelector("#nav-input").focus()');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate('document.activeElement.id'), 'nav-concept');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(visible('stage-concept')); assert.equal(await evaluate('document.activeElement.id'), 'nav-concept');
  await click('#new-project'); await evaluate('document.querySelector("#create-dialog button").focus()');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("#create-dialog").open');
  check('390px responsive stages without overflow; keyboard stage navigation, focus retention and dialog dismissal');
  await click('#show-settings');
  assert.ok(await evaluate('document.querySelector("#advanced").open'));
  assert.equal(await evaluate('document.activeElement.tagName'), 'SUMMARY');
  await click('#show-history'); assert.ok(await evaluate('document.querySelector("#activity-details").open'));
  await stage('input'); await fill('#edit', { prompt: 'A taller teal cabinet with orange knobs and feet' }); await submit('#edit');
  await wait('document.querySelector("#next-action").textContent === "Start workflow"');
  assert.equal(app.store.get(automatic.id).concepts.length, 1);
  await stage('concept'); await wait('document.querySelector("#concepts img").naturalWidth > 0');
  await stage('input'); await fill('#edit', { prompt: 'A teal cabinet with orange knobs and feet' }); await submit('#edit');
  check('input edits offer a new workflow and retain earlier artifacts');
  await call('Network.enable');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await wait('document.querySelector("#connection").textContent.includes("disconnected")');
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await wait('document.querySelector("#connection").textContent === "Local server connected"');
  check('discoverable history/settings shortcuts and reconnect status');
  await stage('model');
  await call('Network.setBlockedURLs', { urls: ['*model.glb'] });
  await call('Page.reload'); await wait(visible('nav-model')); await stage('model'); await wait('document.querySelector("#viewer-message").textContent.includes("Unable to load model")');
  await wait('document.querySelector("#render-image img").naturalWidth > 0');
  await call('Network.setBlockedURLs', { urls: [] });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `const originalContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : originalContext.call(this, type, ...args); };` });
  await call('Page.reload'); await wait(visible('nav-model')); await stage('model'); await wait('document.querySelector("#viewer-message").textContent.includes("WebGL is unavailable")');
  await wait('document.querySelector("#render-image img").naturalWidth > 0');
  assert.ok(await evaluate(visible('download')));
  check('failed GLB load and unavailable WebGL retain render and downloads');
  assert.deepEqual(exceptions, []);
  const report = { fixture: 'Injected providers replay recorded Issue #10 images/models; no live generation', viewports: ['1440 × 1050', '390 × 844'], checks, exceptions, checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Saved evidence: ${output}`);
} finally {
  if (typeof releaseModel === 'function') releaseModel();
  ws?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await once(chrome, 'exit'); }
  await app.runner.pending; await new Promise(resolve => app.server.close(resolve)); await app.closed;
  fs.rmSync(temp, { recursive: true, force: true });
}
