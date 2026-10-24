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
  inspectAsset: async a => {
    const dir = path.join(app.store.library.root, a.id); fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(assets, 'model-1/preview.png'), path.join(dir, 'preview.png'));
    return { meshes: 19, vertices: 5702, objects: [{ name: 'Hair', type: 'MESH' }, { name: 'Body', type: 'MESH' }] };
  },
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
    // UI fixtures stand in for saved sheets; real rendering is separately checked
    // by library-Blender/live validation, not claimed by this browser replay.
    if (v.modelReferences.length) v.modelReferenceVisuals = v.modelReferences.map(r => ({ assetId: r.assetId, name: r.name, role: r.role, permission: r.permission, sheet: v.visualInput, views: [] }));
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
  await request(`/projects/${automatic.id}/runs`, 'POST', {}); await app.runner.pending;
  assert.equal(app.store.get(automatic.id).workflowRuns[0].status, 'completed');
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
  async function screenshot(name) { await evaluate('window.scrollTo(0,0)'); fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64')); }
  const check=name=>{checks.push(name);console.log('PASS '+name);};
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await wait(visible('project-'+automatic.id));await click('#project-'+automatic.id);
  await wait('document.querySelector("#viewer-message").hidden');
  assert.ok(await evaluate(visible('viewer')));assert.ok(await evaluate('document.querySelector("#exports").textContent.includes("Download GLB")'));
  await screenshot('desktop-studio');check('shared project, interactive GLB preview, accepted candidate and exports');
  await click('#view-compare');await wait(visible('comparison'));assert.equal(await evaluate('document.querySelectorAll("#comparison img").length'),2);await screenshot('desktop-comparison');
  await click('#view-model');check('source and render comparison uses the candidate’s saved design input');
  await click('#nav-workflow');await wait(visible('graph'));
  assert.equal(await evaluate('document.querySelectorAll(".graph-node").length'),9);
  assert.equal(await evaluate('document.querySelectorAll("#graph path").length'),9);
  await click('#graph-node-model');await fill('#node-form',{'setting:instructions':'Make the cabinet taller'});await submit('#node-form');
  assert.ok(await evaluate('document.querySelector("#graph-warning").textContent.includes("Unsaved")'));
  await click('#save-graph');await until(()=>app.store.get(automatic.id).workflow.revision===2,'graph saved');
  await evaluate('document.querySelector("#preset-name").value="Browser duplicate"');await click('#save-preset');await wait('document.querySelector("#preset").textContent.includes("Browser duplicate")');
  await click('#graph-node-consistency');await screenshot('desktop-workflow');
  const original=app.store.get(automatic.id).workflowRuns[0], cp=original.checkpoints.find(c=>c.nodeId==='consistency');
  await evaluate('Array.from(document.querySelectorAll("#node-artifacts button")).find(b=>b.textContent==="Branch from here").click()');
  await until(()=>app.store.get(automatic.id).workflowRuns.length===2&&app.store.get(automatic.id).workflowRuns[1].status==='completed','fork completed');
  const fork=app.store.get(automatic.id).workflowRuns[1];assert.equal(fork.parentCheckpointId,cp.id);assert.equal(fork.nodes.concept.reusedFrom,original.id);assert.equal(app.store.get(automatic.id).versions.length,2);
  check('node settings, saved duplicate preset, actual downstream fork and upstream checkpoint reuse');
  // Rewire review directly to model, then remove the now-unused refine node.
  await click('#graph-node-review');await fill('#node-form',{'port:model':'model'});await submit('#node-form');
  await click('#graph-node-refine');await click('#remove-node');await click('#save-graph');
  await until(()=>app.store.get(automatic.id).workflow.nodes.length===8,'rewired graph');check('typed connection editor saves executable rewiring and node removal');
  await select('#theme','light');assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
  await click('#nav-home');await wait(visible('home'));await click('#project-'+automatic.id);assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
  await call('Page.reload');await pause(500);await wait('document.documentElement.dataset.theme === "light" && document.querySelector("#connection").textContent.includes("connected")');check('Light / Dark setting survives navigation and reload');
  await click('#open-library');await wait('document.querySelector("#library-dialog").open');
  await evaluate('document.querySelector("#library-import").closest("details").open=true');
  const dom=await call('DOM.getDocument');const fileNode=await call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#library-file'});
  await call('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[path.join(assets,'model-1/model.glb')]});await submit('#library-import');
  await wait('document.querySelectorAll("#library-assets input").length === 1');await click('#library-assets input');await submit('#library-selection');await wait('!document.querySelector("#library-dialog").open');
  assert.equal(app.store.get(automatic.id).modelReferences[0].review,'pending');
  await evaluate('document.querySelector("#model-references").closest("details").open=true');
  await evaluate('Array.from(document.querySelectorAll("#model-references button")).find(b=>b.textContent==="Approve reference permission").click()');
  await until(()=>app.store.get(automatic.id).modelReferences[0].review==='approved','reference approval');check('asset-library import, project selection and separate human permission review');
  await click('#reload-base');await wait('document.querySelector("#base-asset").options.length === 2');await select('#base-asset',app.store.library.state.assets[0].id);
  await wait('document.querySelector("#base-objects").textContent.includes("Hair")');await evaluate('document.querySelector("#base-settings").open=true');await fill('#base-form',{objects:'Hair'});await submit('#base-form');
  await until(()=>app.store.get(automatic.id).editableBase?.review==='approved','base authorization');
  assert.deepEqual(app.store.get(automatic.id).editableBase.scope.editableObjects,['Hair']);check('complete-base authorization is distinct from reference-only permission');
  await click('#nav-workflow');await select('#preset','humanoid');await click('#load-preset');await click('#save-graph');
  await until(()=>app.store.get(automatic.id).workflow.nodes.some(n=>n.type==='edit'),'humanoid preset saved');check('humanoid preset loads a real base → edit graph');
  // A second text project exercises the actual human node gate through the UI.
  const reviewProject=await request('/projects','POST',{name:'Human review',mode:'text',prompt:'A cabinet',checkpoints:{...checkpoints,concept:true,preview:true}});
  await request(`/projects/${reviewProject.id}/runs`,'POST',{});await app.runner.pending;
  await wait(visible('project-'+reviewProject.id));await click('#project-'+reviewProject.id);
  await wait('document.querySelector("#pending-reviews").textContent.includes("Human review: concept")');
  assert.ok(await evaluate('document.querySelector("#run-workflow").disabled'));
  await evaluate('Array.from(document.querySelectorAll("#pending-reviews button")).find(b=>b.textContent==="Accept & continue").click()');
  await until(()=>app.store.get(reviewProject.id).workflowRuns[0].nodes.review.status==='waiting-review','model review waiting');
  await wait('document.querySelector("#pending-reviews").textContent.includes("Human review: review")');
  await evaluate('Array.from(document.querySelectorAll("#pending-reviews button")).find(b=>b.textContent==="Reject").click()');
  await until(()=>app.store.get(reviewProject.id).workflowRuns[0].status==='rejected','rejection saved');check('human concept and model decisions gate execution without automatic bypass');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await click('#nav-studio');await wait(visible('viewer'));await screenshot('narrow-studio');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
  await click('#nav-workflow');await screenshot('narrow-workflow');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
  assert.ok(await evaluate('document.querySelector("#graph").scrollWidth > document.querySelector("#graph").clientWidth'));
  check('390px studio stacks controls, graph scrolls within its panel, no page overflow');
  // Keyboard focus, accessible labels, and browser runtime errors are checked.
  assert.ok(await evaluate('document.querySelector("#theme").getAttribute("aria-label")'));
  await evaluate('document.querySelector("#graph-node-input").focus()');assert.equal(await evaluate('document.activeElement.id'),'graph-node-input');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(exceptions.length,0,exceptions.join('\n'));check('keyboard node access and no uncaught browser exceptions');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({realBrowser:true,realBlender:false,codexUsed:false,checks,exceptions,limitation:'Injected providers and recorded GLBs; live generation/preservation are separately checked.'},null,2));
} finally { ws?.close();if(chrome&&chrome.exitCode===null){chrome.kill();await once(chrome,'exit');}app.server.close();await app.closed;fs.rmSync(temp,{recursive:true,force:true}); }
