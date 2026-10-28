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
import { Transformer } from '@napi-rs/image';
import { referenceViews } from '../src/model-reference-visuals.js';
import { createApp } from '../src/server.js';
import { blenderExecutor, deterministicEdit } from './posed-workflow-check.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.GEN3D_BROWSER_OUTPUT || '.gen3d/studio-browser-check');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen3d-studio-browser-'));
const assets = path.join(root, 'docs/validation/issue10/prop');
const posedFixtures = process.env.GEN3D_BROWSER_POSED_FIXTURES && path.resolve(process.env.GEN3D_BROWSER_POSED_FIXTURES);
let realPosed = false;
fs.mkdirSync(output, { recursive: true });
const posedBlender = blenderExecutor(output);
const checkpoints = { input: false, concept: false, multiView: false, preview: false };
const png = fs.readFileSync(path.join(assets, 'concept-1/concept.png'));
let generationNumber = 0;
let refinementPass = true, partialModelState, failPreservation = false, usageLimit = false;
let inspection = { consistent: true, issues: [] }, releaseModel, failConcept = false, failModel = false, partialViews = false, failInspection = false;
function selectionGLB() {
  const bytes=fs.readFileSync(realPosed ? path.join(posedFixtures,'blend/base.glb') : path.join(assets,'model-1/model.glb')), length=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.toString('utf8',20,20+length));
  json.nodes.filter(n=>n.mesh!==undefined).forEach((n,i)=>{n.extras={...n.extras,gen3d_part:realPosed?n.name:i===0?'Hair':'Body'};});
  const raw=Buffer.from(JSON.stringify(json)), padded=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(padded);
  const chunk=Buffer.alloc(8);chunk.writeUInt32LE(padded.length);chunk.writeUInt32LE(0x4e4f534a,4);
  const result=Buffer.concat([bytes.subarray(0,12),chunk,padded,bytes.subarray(20+length)]);result.writeUInt32LE(result.length,8);return result;
}
const providers = {
  dataDir: path.join(temp, 'data'),
  selectionPreview: async (a, source, output) => fs.writeFileSync(output,selectionGLB()),
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
  blender: async (tool, { code = '' }) => {
    if (realPosed) return posedBlender(tool, { code });
    const args = code.match(/refs.render_reference\(("[^"\n]*"), ("[^"\n]*")\)/);
    if (args) {
      const directory = JSON.parse(args[2]); fs.mkdirSync(directory, { recursive: true });
      const bytes = await new Transformer(png).resize(384,384).png();
      const views = referenceViews.map(view => { fs.writeFileSync(path.join(directory,view+'.png'),bytes); return {view,image:view+'.png',direction:[1,1,1],center:[0,0,0],orthoScale:2,projection:'orthographic'}; });
      return { output: 'GEN3D_REFERENCE_VIEWS='+JSON.stringify(views) };
    }
    const base = code.match(/preservation.prepare\("[^"\n]*", ("[^"\n]*")/);
    if (base) {
      const directory = JSON.parse(base[1]);
      fs.copyFileSync(path.join(assets,'model-1/scene.blend'),path.join(directory,'base.blend'));
      fs.copyFileSync(path.join(assets,'model-1/model.glb'),path.join(directory,'base.glb'));
      for (const file of ['baseline.json','base-validation.json']) fs.writeFileSync(path.join(directory,file),JSON.stringify({synthetic:true}));
    }
    if (code.includes('preservation.validate(')) {
      const report = code.match(/, ("[^"\n]*")\)\s*$/)[1];
      fs.writeFileSync(JSON.parse(report),JSON.stringify({passed:!failPreservation,roundtrip:{passed:!failPreservation},synthetic:true}));
    }
    return { output: '' };
  },
  inspectReferences: async () => { if (failInspection) throw new Error('Fixture inspection unavailable'); return inspection; },
  inspectModel: async ({ dir, renders, profile, modelReferences = [] }) => {
    const acceptable = refinementPass && path.basename(dir) === '1';
    return { acceptable, modelReferences:modelReferences.map(r=>({assetId:r.assetId,role:r.role,intendedTraits:'Fixture shape',deliberateDifferences:'Primary image remains authoritative',observations:[{trait:'shape',status:'acceptable',detail:'Synthetic role observation'}]})), summary: acceptable ? 'Fixture visual pass.' : 'Fixture torso discrepancy.', revisionTargets: acceptable ? [] : ['geometry'], revisionInstructions: acceptable ? [] : ['Narrow the torso mesh.'],
      views: renders.map(r => ({ view: r.view, observations: [...categories, ...(profile === 'character' ? anatomyCategories : [])].map((category, i) => ({ category, status: !acceptable && i === 1 ? 'discrepancy' : 'acceptable', detail: 'Synthetic browser fixture observation.' })) })) };
  },
  generate: async (p, v, dir) => {
    if (realPosed) return deterministicEdit(posedBlender, p, v, dir);
    if (releaseModel) await new Promise(resolve => { releaseModel = resolve; });
    if (usageLimit) { const e = new Error('Fixture usage limit reached'); e.usageLimited = true; throw e; }
    if (failModel) throw new Error('Fixture Blender bridge unavailable');
    for (const name of ['model.glb', 'scene.blend', 'preview.png', 'mcp-audit.jsonl']) fs.copyFileSync(path.join(assets, 'model-1', name), path.join(dir, name));
    if (v.refinementSettings?.enabled) {
      fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify({ sha256: (++generationNumber).toString(16).padStart(64,'0') }));
      for (const view of ['input', 'front', 'side', 'back', 'three-quarter']) fs.copyFileSync(path.join(assets, 'model-1/preview.png'), path.join(dir, view + '.png'));
    }
    if (partialModelState) {
      partialModelState.entered(); await partialModelState.gate;
      throw new Error('Fixture failure after partial model export');
    }
  }
};
const app = createApp(providers);
app.runner.blender = providers.blender;
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
  const automatic = await request('/projects', 'POST', { name: 'Workshop cabinet', mode: 'text', prompt: 'A teal cabinet with orange knobs and feet' });
  assert.deepEqual(automatic.checkpoints, checkpoints);
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
  function call(method, params = {}, sessionId) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); }); }
  async function evaluate(expression, sessionId) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    assert.ok(!result.exceptionDetails, result.exceptionDetails?.text); return result.result.value;
  }
  const visible = id => `!!document.getElementById(${JSON.stringify(id)})?.getClientRects().length`;
  const wait = async expression => { try { return await until(() => evaluate(expression), expression); } catch(e) { console.log(await evaluate('JSON.stringify({library:document.querySelector("#library-dialog").open,base:document.querySelector("#base-dialog").open,error:document.querySelector("#library-error").textContent,parts:document.querySelector("#part-status").textContent})'));throw e; } };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key = async name => { await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,...(name==='Enter'?{text:'\r',windowsVirtualKeyCode:13}:{windowsVirtualKeyCode:name==='Escape'?27:9})});await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name}); };
  const openProject = async id => {await click('#nav-home');await wait(visible('project-'+id));await click('#project-'+id);};
  const select = async (selector, value) => {
    await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await wait(`!document.querySelector(${JSON.stringify(selector)}).disabled`);
  };
  async function fill(selector, values) {
    await evaluate(`(() => { const f = document.querySelector(${JSON.stringify(selector)}); for (const [key,value] of Object.entries(${JSON.stringify(values)})) { const e = f.elements[key]; if (e.type === 'checkbox') e.checked = value; else e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  }
  const submit = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
  async function screenshot(name) {
    await evaluate('window.scrollTo(0,0)'); fs.mkdirSync(output,{recursive:true});
    const full = /^policy-warning-narrow-(dark|light)$/.test(name) ? (await call('Page.getLayoutMetrics')).cssContentSize : null;
    fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png',...(full?{captureBeyondViewport:true,clip:{x:0,y:0,width:full.width,height:full.height,scale:1}}:{})})).data,'base64'));
  }
  const check=name=>{checks.push(name);console.log('PASS '+name);};
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await wait(visible('project-'+automatic.id));
  assert.equal(await evaluate('document.querySelector("#home").innerText.includes("Make a model")'),false);
  assert.deepEqual(await evaluate('document.querySelector("#home").innerText.split(/\\n+/).map(s=>s.trim()).filter(Boolean)'), ['Projects','Create project','Workshop cabinet','⋯']);
  assert.ok(await evaluate('document.querySelector("#empty-create").classList.contains("primary")'));
  await screenshot('home-populated');
  await click('#empty-create');await wait('document.querySelector("#create-dialog").open');
  assert.ok(await evaluate('document.querySelector("#create input[name=name]").getClientRects().length && !document.querySelector("#create input[name=name]").closest("details")'));
  assert.equal(await evaluate('document.activeElement.name'),'name');
  assert.equal(await evaluate('document.querySelector("#create input[name=name]").required'),false);
  const createAX=await call('Accessibility.getFullAXTree');
  assert.ok(createAX.nodes.some(n=>n.role?.value==='textbox'&&n.name?.value==='Project name'));
  await key('Tab');assert.equal(await evaluate('document.activeElement.name'),'workflowType');
  await key('Tab');assert.equal(await evaluate('document.activeElement.name'),'mode');
  await key('Tab');assert.equal(await evaluate('document.activeElement.name'),'prompt');
  for (const task of ['object','humanoid']) for (const mode of ['text','image']) {
    await fill('#create',{workflowType:task,mode,name:'Keep this name',prompt:'Keep this description'});
    assert.equal(await evaluate('document.querySelector("#image-label").getClientRects().length > 0'),mode==='image');
    assert.equal(await evaluate('document.querySelector("#create").elements.image.required'),mode==='image');
    assert.ok(await evaluate('["name","workflowType","mode","prompt"].every(k=>document.querySelector("#create").elements[k].getClientRects().length>0)'));
    assert.equal(await evaluate('document.querySelector("#create").elements.prompt.value'),'Keep this description');
    await screenshot('create-'+task+'-'+mode);
  }
  for (const theme of ['light','dark']) {
    await select('#theme',theme);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await screenshot('narrow-create-'+theme);
    assert.ok(await evaluate('document.querySelector("#create-dialog").scrollWidth <= document.querySelector("#create-dialog").clientWidth+1'));
    await key('Escape');await wait('!document.querySelector("#create-dialog").open && document.activeElement.id === "empty-create"');
    assert.equal(await evaluate('document.activeElement.id'),'empty-create');
    await screenshot('narrow-home-'+theme);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
    await click('#empty-create');
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await evaluate('document.querySelector("#create").reset();document.querySelector("#create").elements.mode.onchange()');
  await screenshot('create-text');await fill('#create',{mode:'image'});await screenshot('create-image');
  await fill('#create',{mode:'text'});await click('#close-create');
  check('Home prioritizes Create and project names; visible optional name has an accessible label and keyboard order; Create/Edit × Text/Image keeps common fields visible and only requires applicable files; dialog focus and narrow Light/Dark fit');
  await openProject(automatic.id);
  assert.ok(await evaluate('document.querySelector("#edit input[name=name]").getClientRects().length && !document.querySelector("#edit input[name=name]").closest("details")'));
  assert.equal(await evaluate('document.querySelectorAll("#studio #settings, #studio #studio-checkpoints").length'),0);
  await screenshot('desktop-empty');
  assert.deepEqual(automatic.consistencySettings,{enabled:true,onFailure:'continue'});
  assert.equal(await evaluate('document.querySelector("#four-view-policy").value'),'continue');
  assert.ok(await evaluate('document.querySelector("#four-view-policy").labels[0].textContent.startsWith("Four-view check")'));
  assert.ok(await evaluate('document.querySelector("#edit select[name=profile]").getClientRects().length && !document.querySelector("#four-view-policy").closest("details")'));
  for (const policy of ['off','stop','continue']) {
    await select('#four-view-policy',policy);
    await until(()=>app.store.get(automatic.id).consistencySettings.enabled===(policy!=='off') && (policy==='off'||app.store.get(automatic.id).consistencySettings.onFailure===policy),'studio policy '+policy);
    await call('Page.reload');await wait(visible('four-view-policy'));
    assert.equal(await evaluate('document.querySelector("#four-view-policy").value'),policy);
  }
  await evaluate('document.querySelector("#four-view-policy").focus()');
  assert.equal(await evaluate('document.activeElement.id'),'four-view-policy');
  const policyAX=await call('Accessibility.getFullAXTree');
  assert.ok(policyAX.nodes.some(n=>n.role?.value==='combobox'&&n.name?.value==='Four-view check'));
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  // Restore the default explicitly after checking native keyboard selection.
  await select('#four-view-policy','continue');await until(()=>app.store.get(automatic.id).consistencySettings.onFailure==='continue','keyboard policy persisted');
  await select('#studio-refinement','true');await until(()=>app.store.get(automatic.id).refinementSettings.enabled,'studio refinement on');
  await wait(visible('studio-cycles'));await select('#studio-refinement','false');await until(()=>!app.store.get(automatic.id).refinementSettings.enabled,'studio refinement off');
  check('studio exposes policy, profile, source actions and contextual refinement; all policy choices persist through reload with accessible keyboard controls');
  inspection={consistent:false,issues:['Different rear shape']};
  await click('#run-workflow');
  await until(()=>app.store.get(automatic.id).workflowRuns[0]?.status==='completed','default generation');
  const defaultRun=app.store.get(automatic.id).workflowRuns[0];
  assert.equal(defaultRun.checkpoints.find(cp=>cp.nodeId==='consistency').data.consistency.status,'failed');
  inspection={consistent:true,issues:[]};
  await wait(visible('task-warning'));
  await screenshot('policy-warning-desktop-dark');
  await select('#theme','light');await screenshot('policy-warning-desktop-light');await select('#theme','dark');
  await evaluate('document.querySelector("#inspect-warning").focus()');await click('#inspect-warning');await wait('document.querySelector("#history-dialog").open');
  assert.equal(await evaluate('document.querySelectorAll("#history-content img").length'),5);
  assert.ok(await evaluate('document.querySelector("#warning-info").textContent.includes("Different rear shape")'));
  await screenshot('policy-warning-details');await click('#close-history');
  assert.equal(await evaluate('document.activeElement.id'),'inspect-warning');
  check('new default allows contradictions, retains the report and all images, with one warning action and restored focus');
  assert.deepEqual(defaultRun.decisions,[]);assert.equal(defaultRun.checkpoints.find(c=>c.nodeId==='views').data.images.length,4);
  await wait('document.querySelector("#viewer-message").hidden');
  assert.ok(await evaluate(visible('viewer')));assert.ok(await evaluate('document.querySelector("#exports").textContent.includes("Download GLB")'));
  const downloadLinks=await evaluate('Array.from(document.querySelectorAll("#exports a")).map(a=>a.href)');
  for(const [i,href] of downloadLinks.entries()){const response=await fetch(href);assert.equal(response.status,200);assert.ok(response.headers.get('content-disposition').includes('attachment'));assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,i===0?4:7).toString(),i===0?'glTF':'BLENDER');}
  await screenshot('desktop-studio');check('default Text → 3D from studio: concept + four views, no human review clicks, interactive GLB and exports');
  await click('#view-compare');await wait(visible('comparison'));assert.equal(await evaluate('document.querySelectorAll("#comparison img").length'),2);await screenshot('desktop-comparison');
  await click('#view-model');check('source and render comparison uses the candidate’s saved design input');
  await evaluate('Array.from(document.querySelectorAll(".history-thumb")).find(b=>b.textContent==="Four views").click()');
  await evaluate('Array.from(document.querySelectorAll("#history-actions button")).find(b=>b.textContent==="Inspect").click()');
  await wait('document.querySelector("#history-dialog").open');assert.equal(await evaluate('document.querySelectorAll("#history-content img").length'),5);
  await click('#close-history');assert.ok(await evaluate('Array.from(document.querySelectorAll("#history-actions button")).find(b=>b.textContent==="Branch")?.disabled === false'));
  check('preparation thumbnails expose saved concept/four-view images and contextual branching');
  await click('#nav-workflow');await wait(visible('graph'));
  assert.ok(await evaluate('Array.from(document.querySelectorAll("#settings input[type=checkbox],#settings select")).every(e=>e.getClientRects().length && !e.closest("details"))'));
  assert.ok(await evaluate(visible('editor-cycles-label')));
  assert.equal(await evaluate(visible('refinement-cost')),false);
  assert.equal(await evaluate(visible('refinement-history')),false);
  assert.equal(await evaluate('document.querySelector("#graph-warning").textContent'),'');
  await fill('#settings',{refinement:'true'});await wait(visible('refinement-cost'));
  assert.ok(await evaluate('document.querySelector("#refinement-cost").innerText.includes("allowance")'));
  // An unrelated project update must retain the unsaved setting and its cost notice.
  await request('/projects/'+automatic.id,'PATCH',{name:automatic.name+' updated'});
  await wait('document.querySelector("#title").textContent === "Workshop cabinet updated"');
  assert.ok(await evaluate(visible('refinement-cost')));
  await request('/projects/'+automatic.id,'PATCH',{name:automatic.name});
  await wait('document.querySelector("#title").textContent === "Workshop cabinet"');
  await fill('#settings',{refinement:'false'});
  assert.ok(await evaluate(visible('editor-cycles-label')));
  assert.equal(await evaluate(visible('refinement-cost')),false);
  await screenshot('workflow-settings');
  check('workflow review and preparation settings, including cycle limits, stay direct; cost follows saved/unsaved refinement; empty refinement history and saved-graph prose are absent');
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
  // Candidate actions use the selected saved candidate, retaining all earlier artifacts.
  await click('#nav-studio');
  await evaluate('Array.from(document.querySelectorAll(".history-thumb")).find(b=>b.textContent.startsWith("#1")).focus()');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(await evaluate('document.activeElement.id'),'candidate-'+app.store.get(automatic.id).versions[0].id);
  await evaluate('Array.from(document.querySelectorAll("#history-actions button")).find(b=>b.textContent==="Restore").click()');
  await until(()=>app.store.get(automatic.id).acceptedVersionId===app.store.get(automatic.id).versions[0].id,'restore selected candidate');
  await evaluate('Array.from(document.querySelectorAll("#candidate-actions button")).find(b=>b.textContent==="Retry").click()');
  await until(()=>app.store.get(automatic.id).workflowRuns.length===3&&app.store.get(automatic.id).workflowRuns[2].status==='completed','retry candidate');
  assert.equal(app.store.get(automatic.id).workflowRuns[2].nodes.views.reusedFrom,original.id);
  await wait('document.querySelectorAll(".history-thumb").length >= 5');
  await evaluate('Array.from(document.querySelectorAll("#candidate-actions button")).find(b=>b.textContent==="Accept").click()');
  await until(()=>app.store.get(automatic.id).activity.filter(e=>e.type==='model_reviewed').at(-1).actor==='web','explicit accept audited');
  check('visual candidate selection, restore, retry reusing required views, and explicit accept');
  await select('#theme','light');assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
  await click('#nav-home');await wait(visible('home'));await openProject(automatic.id);assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
  await call('Page.reload');await pause(500);await wait('document.documentElement.dataset.theme === "light" && document.querySelector("#connection").textContent.includes("connected")');check('Light / Dark setting survives navigation and reload');
  // Create an image project entirely from the studio entry dialog.
  async function upload(selector, file) {
    const dom=await call('DOM.getDocument'), fileNode=await call('DOM.querySelector',{nodeId:dom.root.nodeId,selector});
    await call('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[file]});
  }
  await click('#nav-home');await screenshot('home-candidates');await click('#new-project');await fill('#create',{name:'  Cabinet study  ',mode:'image',prompt:'A cabinet from this image'});
  await upload('#create input[name=image]',path.join(assets,'concept-1/concept.png'));await submit('#create');
  await until(()=>app.store.list().length===2,'image project created');
  const imageProject=app.store.list().find(p=>p.id!==automatic.id);
  assert.equal(imageProject.name,'Cabinet study');
  await wait('document.querySelector("#title").textContent === '+JSON.stringify(imageProject.name));
  await call('Page.reload');await wait('document.querySelector("#title").textContent === "Cabinet study"');
  await click('#nav-home');await wait('document.querySelector("#project-cards").textContent.includes("Cabinet study")');await openProject(imageProject.id);
  check('explicit project name is trimmed, saved by the create dialog, and survives reload and Home selection');
  assert.equal(await evaluate('document.querySelector("#four-view-policy").getClientRects().length'),0);
  await click('#nav-workflow');assert.equal(await evaluate('document.querySelector("#editor-policy-label").getClientRects().length'),0);await click('#nav-studio');
  check('image input hides generated four-view policy in studio and editor');
  await upload('#reference input[name=image]',path.join(assets,'concept-1/concept.png'));
  await until(()=>app.store.get(imageProject.id).references[0]?.review==='approved','supplementary image consent');
  check('Use image attaches and audits a supplementary reference from the Sources panel');
  await click('#select-models');await wait('document.querySelector("#library-dialog").open');
  await upload('#library-file',path.join(root,'docs/validation/issue26/blender/edited.glb'));
  await wait('document.querySelectorAll("#library-assets article").length === 1 && document.querySelector("#library-dialog").getAttribute("aria-busy") !== "true"');
  assert.ok(await evaluate('document.querySelector("#library-source").getClientRects().length && !document.querySelector("#library-source").closest("details")'));
  assert.ok(await evaluate('Array.from(document.querySelectorAll("#library-assets button")).filter(b=>["Use as reference","Edit this model"].includes(b.textContent)).every(b=>b.getClientRects().length && !b.closest("details"))'));
  assert.equal(app.store.get(imageProject.id).modelReferences.length,0,'upload alone grants no permission');
  await screenshot('desktop-asset-selection');
  // Actual responsive chooser and keyboard dismissal in both themes.
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await screenshot('narrow-asset-selection-light');
  assert.ok(await evaluate('document.querySelector("#library-dialog").scrollWidth <= document.querySelector("#library-dialog").clientWidth+1'));
  await select('#theme','dark');await screenshot('narrow-asset-selection-dark');
  await select('#theme','light');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await evaluate('document.querySelector("#close-library").focus()');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait('!document.querySelector("#library-dialog").open && document.activeElement.id === "select-models"');
  await click('#select-models');await wait('document.querySelector("#library-dialog").open && document.querySelectorAll("#library-assets article").length===1');
  const assetId=app.store.library.state.assets[0].id;
  const libraryAction=async label=>evaluate('Array.from(document.querySelectorAll("#library-assets button")).find(b=>b.textContent === '+JSON.stringify(label)+').click()');
  await evaluate('document.querySelector("#library-assets button").focus()');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('!document.querySelector("#library-dialog").open');
  let chosenRef=app.store.get(imageProject.id).modelReferences[0];
  assert.equal(chosenRef.review,'approved');assert.equal(chosenRef.permission,'reference-only');
  assert.equal(app.store.get(imageProject.id).activity.find(e=>e.type==='model_reference_reviewed').actor,'web');
  await wait('document.activeElement.id === "select-models"');
  // Change use from the source card; broader use needs an explicit contextual consent.
  await evaluate('document.querySelector("#model-references details").open=true');
  await evaluate('Array.from(document.querySelectorAll("#model-references button")).find(b=>b.textContent==="Change use…").click()');
  await wait('document.querySelector("#library-dialog").open');
  await wait('document.querySelector("#library-assets details")');await evaluate('document.querySelector("#library-assets details").open=true');await libraryAction('Use parts of this model');
  await wait('!document.querySelector("#library-consent").hidden');
  assert.equal(app.store.get(imageProject.id).modelReferences[0].permission,'reference-only');
  await submit('#library-consent');assert.equal(app.store.get(imageProject.id).modelReferences[0].permission,'reference-only','unchecked consent cannot submit');
  await screenshot('desktop-copy-consent');
  await click('#cancel-copy');assert.equal(app.store.get(imageProject.id).modelReferences[0].permission,'reference-only');
  await libraryAction('Use parts of this model');await wait('!document.querySelector("#library-consent").hidden');
  await fill('#library-consent',{consent:true,role:'Hair'});await submit('#library-consent');await wait('!document.querySelector("#library-dialog").open');
  assert.equal(app.store.get(imageProject.id).modelReferences[0].permission,'reuse-edit');assert.equal(app.store.get(imageProject.id).editableBase,null);
  assert.ok(await evaluate('Array.from(document.querySelectorAll("#model-references p")).some(e=>e.textContent==="Hair" && e.getClientRects().length && !e.closest("details"))'));
  await screenshot('studio-source-role');
  // Removing one source never approves another pending source or deletes the library asset.
  await evaluate('document.querySelector("#model-references details").open=true');
  await evaluate('Array.from(document.querySelectorAll("#model-references button")).find(b=>b.textContent==="Remove").click()');
  await until(()=>!app.store.get(imageProject.id).modelReferences.length,'remove model source');assert.ok(app.store.library.get(assetId));
  await click('#select-models');await wait('document.querySelector("#library-dialog").open');
  await wait('document.querySelectorAll("#library-assets article").length === 1');
  await wait('document.querySelector("#library-assets details")');await evaluate('document.querySelector("#library-assets details").open=true');await libraryAction('Use parts of this model');await wait('!document.querySelector("#library-consent").hidden');
  await fill('#library-consent',{consent:true});await submit('#library-consent');await wait('!document.querySelector("#library-dialog").open');
  check('upload grants no rights; direct reference is atomic and audited; broader copy needs explicit consent; source change/removal preserve library assets');
  await click('#run-workflow');await until(()=>app.store.get(imageProject.id).workflowRuns[0]?.status==='completed','image default with sources');
  assert.equal(app.store.get(imageProject.id).versions[0].modelReferences[0].permission,'reuse-edit');
  assert.deepEqual(app.store.get(imageProject.id).workflowRuns[0].decisions,[]);
  await wait('document.querySelector("#exports").textContent.includes("Download GLB")');
  check('Image → 3D with an authorized saved source reaches exports without intermediate reviews');
  // Proposed changes from MCP require fresh human consent, even with all checkpoints off.
  await request(`/projects/${imageProject.id}/model-references`,'POST',{models:[{assetId,permission:'reference-only'}]},true);
  await wait('document.querySelector("#run-workflow").disabled');
  for(const route of [`/projects/${imageProject.id}/model-references/${assetId}/review`,`/projects/${imageProject.id}/editable-base`]) {
    const response=await fetch(url+'/api'+route,{method:'POST',headers:{'Content-Type':'application/json','x-gen3d-client':'mcp'},body:JSON.stringify({decision:'approved',assetId,scope:{editableObjects:['Hair']}})});assert.equal(response.status,403);
  }
  const denied=await fetch(url+`/api/projects/${imageProject.id}/runs`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,409);
  await wait('document.querySelector("#model-references").textContent.includes("Choose use…")');
  await evaluate('document.querySelector("#model-references>div>button").click()');await wait('document.querySelector("#library-dialog").open');await libraryAction('Use as reference');await wait('!document.querySelector("#library-dialog").open');await until(()=>app.store.get(imageProject.id).modelReferences[0].review==='approved','reference-only consent');
  check('changed permission blocks generation and MCP cannot authorize reuse or an editable base');
  await evaluate('Array.from(document.querySelectorAll("#candidate-actions button")).find(b=>b.textContent==="Refine").click()');
  await wait('document.querySelector("#refine-dialog").open');assert.ok(await evaluate('document.querySelector("#refine-dialog").textContent.includes("allowance")'));
  // Return to the saved source permission before branching from its immutable evidence.
  await request(`/projects/${imageProject.id}/model-references`,'POST',{models:[{assetId,permission:'reuse-edit'}]});
  await request(`/projects/${imageProject.id}/model-references/${assetId}/review`,'POST',{decision:'approved'});
  await submit('#refine-form');await until(async()=>{const r=app.store.get(imageProject.id).workflowRuns[1];if(r&&r.status!=='running')assert.equal(r.status,'completed',r.error || JSON.stringify(r.nodes));assert.equal(await evaluate('document.querySelector("#notice").textContent'),'');return r?.status==='completed';},'on-demand refinement');
  assert.equal(app.store.get(imageProject.id).versions.at(-1).refinement.status,'passed');
  assert.equal(app.store.get(imageProject.id).workflowRuns[1].nodes.model.reusedFrom,app.store.get(imageProject.id).workflowRuns[0].id);
  await wait('!document.querySelector("#refine-dialog").open && document.querySelector("#candidate-actions").textContent.includes("Refine")');
  await evaluate('Array.from(document.querySelectorAll("#candidate-actions button")).find(b=>b.textContent==="Refine").click()');await submit('#refine-form');
  await until(()=>{const r=app.store.get(imageProject.id).workflowRuns[2];if(r&&r.status!=='running')assert.equal(r.status,'completed',r.error || app.store.get(imageProject.id).versions.at(-1).error);return r?.status==='completed';},'second on-demand refinement');
  assert.equal(app.store.get(imageProject.id).workflowRuns[2].nodes.refine_2.status,'completed');
  assert.equal(app.store.get(imageProject.id).workflowRuns[2].nodes.refine.reusedFrom,app.store.get(imageProject.id).workflowRuns[1].id);
  check('on-demand refinement warns about cost, branches from the selected model, and repeated refinement executes another bounded loop');
  await click('#nav-home');await click('#new-project');await fill('#create',{prompt:'A tiny toolbox'});
  assert.equal(await evaluate('document.querySelector("#create").elements.image.required'),false);
  await submit('#create');await until(()=>app.store.list().length===3,'text creation after image creation');
  const textProject=app.store.list().find(p=>p.name==='A tiny toolbox');
  assert.ok(textProject);
  await wait('document.querySelector("#title").textContent === "A tiny toolbox"');
  await call('Page.reload');await wait('document.querySelector("#title").textContent === "A tiny toolbox"');
  await click('#nav-home');await wait('document.querySelector("#project-cards").textContent.includes("A tiny toolbox")');await openProject(textProject.id);
  await click('#run-workflow');
  await until(()=>app.store.get(textProject.id).workflowRuns[0]?.status==='completed','text creation via UI');
  assert.equal(app.store.get(textProject.id).versions[0].modelingImages.length,4);
  assert.deepEqual(app.store.get(textProject.id).workflowRuns[0].decisions,[]);
  check('new text creation uses Describe with optional name and needs no image upload or review clicks');
  // Create the humanoid preset from the main experience, never opening the graph editor.
  await click('#nav-home');await click('#new-project');await fill('#create',{workflowType:'humanoid',mode:'image',prompt:'Improve the hair of this character'});
  await upload('#create input[name=image]',path.join(assets,'concept-1/concept.png'));await submit('#create');
  await until(()=>app.store.list().length===4,'humanoid project created');const humanoid=app.store.list().find(p=>p.workflow.nodes.some(n=>n.type==='edit'));
  await wait('document.querySelector("#title").textContent === '+JSON.stringify(humanoid.name));
  assert.ok(await evaluate('document.querySelector("#run-workflow").disabled'));
  await click('#select-models');await wait('document.querySelector("#library-dialog").open');
  await wait('document.querySelectorAll("#library-assets article").length === 1');
  await libraryAction('Edit this model');await wait('document.querySelector("#base-dialog").open && document.querySelectorAll("#base-meshes input").length===2 && document.querySelector("#part-status").textContent !== "Loading parts…"');
  assert.equal(app.store.get(humanoid.id).editableBase,null,'choosing a model does not grant edit scope');
  assert.equal(await evaluate('document.querySelectorAll("#part-viewer canvas").length'),1);
  assert.equal(await evaluate('document.querySelector("#part-status").textContent'),'');
  assert.ok(await evaluate('document.querySelector("#base-form button[type=submit]").disabled'));
  await screenshot('desktop-base-consent');
  // Keyboard selection highlights/selects the corresponding geometry; exact name remains accessible.
  await evaluate('document.querySelector("#base-meshes input").focus()');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32});await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  assert.ok(await evaluate('document.querySelector("#base-meshes input").checked'));
  assert.equal(await evaluate('document.querySelector("#base-meshes input").getAttribute("aria-label")'),'Part 1: Hair');
  await submit('#base-form');await until(()=>app.store.get(humanoid.id).editableBase?.review==='approved','base scope consent');
  await wait('!document.querySelector("#base-dialog").open');
  assert.deepEqual(app.store.get(humanoid.id).editableBase.scope,{editableObjects:['Hair'],allowChanges:[],allowNewObjects:false});
  await wait('!document.querySelector("#run-workflow").disabled');await click('#run-workflow');await until(()=>{const r=app.store.get(humanoid.id).workflowRuns[0];if(r&&r.status!=='running')assert.equal(r.status,'completed',r.error);return r?.status==='completed';},'humanoid edit with synthetic preservation');
  await wait('document.querySelector("#exports").textContent.includes("Download GLB")');
  check('main studio selects complete base and exact parts, separately authorizes scope, then Improve reaches preview (synthetic preservation)');
  // Switching an existing object project to editing retains applied, unsaved node settings.
  await openProject(textProject.id);await click('#nav-workflow');await click('#graph-node-model');
  const editInstructions='Make the toolbox taller, preserving the protected body';
  const creationWorkflow=structuredClone(app.store.get(textProject.id).workflow);
  await fill('#node-form',{'setting:instructions':editInstructions});await submit('#node-form');
  await wait('document.querySelector("#graph-warning").textContent.includes("Unsaved")');
  assert.deepEqual(app.store.get(textProject.id).workflow,creationWorkflow,'node changes remain unsaved before edit selection');
  await click('#nav-studio');await click('#select-models');await wait('document.querySelector("#library-dialog").open');
  await wait('document.querySelectorAll("#library-assets article").length===1');await libraryAction('Edit this model');
  await wait('document.querySelector("#base-dialog").open && document.querySelector("#part-status").textContent === ""');await click('#close-base');
  assert.equal(app.store.get(textProject.id).editableBase,null,'cancel edit leaves project unchanged');
  await click('#select-models');await wait('document.querySelector("#library-dialog").open && document.querySelectorAll("#library-assets article").length===1');await libraryAction('Edit this model');
  await wait('document.querySelector("#base-dialog").open && document.querySelector("#part-status").textContent === ""');await click('#base-meshes input');await submit('#base-form');
  await wait('!document.querySelector("#base-dialog").open && document.querySelector("#run-workflow").textContent === "Improve"');
  assert.ok(app.store.get(textProject.id).workflow.nodes.some(n=>n.type==='base'));
  await click('#run-workflow');await until(()=>app.store.get(textProject.id).workflowRuns.length===2 && app.store.get(textProject.id).workflowRuns.at(-1).status==='completed','existing project edited');
  const editRun=app.store.get(textProject.id).workflowRuns.at(-1), editedVersion=app.store.get(textProject.id).versions.at(-1);
  assert.equal(editRun.graph.nodes.find(n=>n.id==='model').type,'edit','Improve must execute an edit node after unsaved workflow changes');
  assert.equal(editRun.graph.nodes.find(n=>n.id==='model').settings.instructions,editInstructions);
  assert.ok(editRun.graph.edges.some(e=>e.from==='base'&&e.to==='model'&&e.input==='base'));
  assert.deepEqual(editRun.snapshot.base,app.store.get(textProject.id).editableBase);
  assert.equal(editedVersion.editableBase.assetId,assetId);
  assert.deepEqual(editedVersion.editableBase.scope,{editableObjects:['Hair'],allowChanges:[],allowNewObjects:false});
  assert.equal(editedVersion.feedback,editInstructions);
  assert.equal(editedVersion.preservation.passed,true);
  check('Improve retains unsaved workflow settings and executes with the selected editable base and protected scope');
  assert.deepEqual(app.store.get(textProject.id).editableBase.scope.allowChanges,[]);
  const savedEdit=structuredClone(app.store.get(textProject.id).versions.at(-1).editableBase);
  await wait('document.querySelector("#base-source details")');await evaluate('document.querySelector("#base-source details").open=true');
  await evaluate('Array.from(document.querySelectorAll("#base-source button")).find(b=>b.textContent==="Remove model").click()');
  await until(()=>!app.store.get(textProject.id).editableBase,'remove editable source');
  await wait('document.querySelector("#run-workflow").disabled');
  assert.deepEqual(app.store.get(textProject.id).versions.at(-1).editableBase,savedEdit,'prior edit retains immutable base scope');
  await openProject(imageProject.id);await wait('document.querySelector("#references button[aria-label]")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#references button[aria-label]")).opacity'),'1');
  await click('#references button[aria-label]');
  await until(()=>app.store.get(imageProject.id).references[0].review==='rejected','image removed');
  check('existing project switches to Improve through contextual selection; cancellation grants nothing; image removal is direct');
  // Explicit pauses remain real: all four are directly visible in the editor.
  const reviewProject=await request('/projects','POST',{name:'Human review',mode:'text',prompt:'A cabinet'});
  await openProject(reviewProject.id);await click('#nav-workflow');
  await fill('#settings',{input:true,concept:true,multiView:true,preview:true});await submit('#settings');
  await until(()=>app.store.get(reviewProject.id).checkpoints.preview,'manual settings saved');await click('#nav-studio');await click('#run-workflow');
  async function approveNode(id){await wait('document.querySelector("#pending-reviews").textContent.includes('+JSON.stringify('Human review: '+(id==='review'?'model':id==='views'?'four views':id))+')');await evaluate('Array.from(document.querySelectorAll("#pending-reviews button")).find(b=>b.textContent==="Accept & continue").click()');}
  await approveNode('input');await wait('document.querySelector("#pending-reviews").textContent.includes("Human review: concept")');
  await screenshot('desktop-manual-review');
  const waitingSnapshot=structuredClone(app.store.get(reviewProject.id).workflowRuns[0].snapshot);
  await select('#four-view-policy','off');await until(()=>!app.store.get(reviewProject.id).consistencySettings.enabled,'future inspection off');
  assert.deepEqual(app.store.get(reviewProject.id).workflowRuns[0].snapshot,waitingSnapshot);
  await wait('!document.querySelector("#captured-policy").hidden');
  // Turning future pauses off does not rewrite this waiting run's policy.
  await click('#nav-workflow');await fill('#settings',{input:false,concept:false,multiView:false,preview:false});await submit('#settings');
  await until(()=>!app.store.get(reviewProject.id).checkpoints.preview,'future pauses off');await click('#nav-studio');
  const manualRun=app.store.get(reviewProject.id).workflowRuns[0];
  const forbidden=await fetch(url+`/api/projects/${reviewProject.id}/runs/${manualRun.id}/nodes/concept/review`,{method:'POST',headers:{'Content-Type':'application/json','x-gen3d-client':'mcp'},body:'{"decision":"approved"}'});assert.equal(forbidden.status,403);
  assert.ok(await evaluate('document.querySelector("#run-workflow").disabled'));
  await approveNode('concept');await approveNode('views');
  await until(()=>app.store.get(reviewProject.id).workflowRuns[0].nodes.review.status==='waiting-review','manual preview waiting');
  await wait('document.querySelector("#pending-reviews").textContent.includes("Human review: model")');
  assert.equal(await evaluate('document.querySelectorAll("#exports a").length'),0);
  assert.throws(()=>app.store.canExport(reviewProject.id,app.store.get(reviewProject.id).versions[0].id),/Approve/);
  await approveNode('review');await until(()=>app.store.get(reviewProject.id).workflowRuns[0].status==='completed','manual review complete');
  assert.equal(manualRun.decisions.length,4);assert.ok(manualRun.decisions.every(d=>d.actor==='web'));
  check('optional input/concept/views/preview pauses are audited; settings changes and MCP cannot bypass them; preview gates export');
  // Meaningful failures stop visibly under automatic continuation.
  async function failure(name,configure,expected,settings){
    configure();const p=await request('/projects','POST',{name,mode:'text',prompt:'A cabinet',...settings});
    await openProject(p.id);await click('#run-workflow');
    await until(()=>['failed','usage-limit'].includes(app.store.get(p.id).workflowRuns[0]?.status),name);
    await wait('document.querySelector("#task-error").textContent.includes('+JSON.stringify(expected)+')');
    assert.equal(await evaluate('document.querySelectorAll("#exports a").length'),0);return p;
  }
  const inconsistent=await failure('Stop inconsistent views',()=>{inspection={consistent:false,issues:['Different rear shape']};},'Consistency blocker',{consistencySettings:{onFailure:'stop'}});
  assert.equal(app.store.get(inconsistent.id).versions.length,0);inspection={consistent:true,issues:[]};
  await failure('Inspection execution error',()=>{failInspection=true;},'Fixture inspection unavailable');failInspection=false;
  await failure('Malformed inspection',()=>{inspection={consistent:'yes',issues:[]};},'Invalid consistency inspection report');inspection={consistent:true,issues:[]};
  await failure('Incomplete views with inspection Off',()=>{partialViews=true;},'Fixture stopped after first view',{consistencySettings:{enabled:false}});partialViews=false;
  await failure('Incomplete views',()=>{partialViews=true;},'Fixture stopped after first view');partialViews=false;
  await failure('Failed image provider',()=>{failConcept=true;},'Fixture image provider unavailable');failConcept=false;
  await failure('Failed modeling tool',()=>{failModel=true;},'Fixture Blender bridge unavailable');failModel=false;
  await openProject(humanoid.id);failPreservation=true;await click('#run-workflow');
  await until(()=>app.store.get(humanoid.id).workflowRuns.at(-1).status==='failed','preservation gate');
  assert.equal(app.store.get(humanoid.id).versions.at(-1).status,'failed');failPreservation=false;
  check('automatic path stops on Stop consistency, incomplete views, provider/tool failure, and required preservation failure');
  const warning=await request('/projects','POST',{name:'Warn and continue',mode:'text',prompt:'A cabinet',consistencySettings:{onFailure:'continue'}});inspection={consistent:false,issues:['Different rear shape']};
  await request(`/projects/${warning.id}/runs`,'POST',{});await app.runner.pending;assert.equal(app.store.get(warning.id).workflowRuns[0].status,'completed');await openProject(warning.id);await wait('!document.querySelector("#task-warning").hidden');await click('#inspect-warning');await wait('document.querySelector("#history-dialog").open');assert.ok(await evaluate('document.querySelector("#warning-info").textContent.includes("Different rear shape")'));await click('#close-history');inspection={consistent:true,issues:[]};
  check('explicit Warn and continue retains the failed inspection report and permits modeling');
  await click('#nav-workflow');await click('#graph-node-consistency');
  await fill('#node-form',{'setting:enabled':'true','setting:onFailure':'stop'});await submit('#node-form');await click('#save-graph');
  await until(()=>app.store.get(warning.id).workflow.nodes.find(n=>n.id==='consistency').settings.onFailure==='stop','node override saved');
  await click('#nav-studio');await wait('document.querySelector("#policy-overrides").textContent.includes("Stop on issues")');
  await select('#four-view-policy','off');await until(()=>!app.store.get(warning.id).consistencySettings.enabled,'project Off with override');
  assert.ok(await evaluate('document.querySelector("#policy-overrides").textContent.includes("Stop on issues")'));
  await screenshot('policy-node-override');inspection={consistent:false,issues:['Different rear shape']};await click('#run-workflow');
  await until(()=>app.store.get(warning.id).workflowRuns.at(-1).status==='failed','node Stop blocks project Off');
  const stoppedRun=structuredClone(app.store.get(warning.id).workflowRuns.at(-1));
  await select('#four-view-policy','continue');await until(()=>app.store.get(warning.id).consistencySettings.enabled,'future project Warn');
  assert.deepEqual(app.store.get(warning.id).workflowRuns.at(-1),stoppedRun);
  await click('#nav-workflow');await click('#graph-node-consistency');
  await fill('#node-form',{'setting:enabled':'','setting:onFailure':''});await submit('#node-form');await click('#save-graph');
  await until(()=>!Object.keys(app.store.get(warning.id).workflow.nodes.find(n=>n.id==='consistency').settings).length,'override removed');
  await click('#nav-studio');await select('#four-view-policy','off');await until(()=>!app.store.get(warning.id).consistencySettings.enabled,'Off selected');
  failInspection=true;await click('#run-workflow');await until(()=>app.store.get(warning.id).workflowRuns.at(-1).status==='completed','Off skips failing optional inspector');failInspection=false;
  assert.equal(app.store.get(warning.id).workflowRuns.at(-1).checkpoints.find(cp=>cp.nodeId==='consistency').data.consistency.status,'skipped');
  inspection={consistent:true,issues:[]};
  check('studio truthfully exposes node override; explicit node Stop wins over Off; future edits preserve stopped runs; Off skips inspection and generates all views');
  await openProject(automatic.id);await select('#theme','dark');await screenshot('desktop-studio-dark');
  await select('#theme','light');await screenshot('desktop-studio-light');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
  assert.ok(await evaluate('document.querySelector("#viewer").getBoundingClientRect().width > document.querySelector(".action-panel").getBoundingClientRect().width'));
  check('desktop uses sources / dominant preview / action columns in both themes');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await click('#nav-studio');await wait(visible('viewer'));await screenshot('narrow-studio-light');await select('#theme','dark');await screenshot('narrow-studio-dark');
  await screenshot('policy-warning-narrow-dark');await select('#theme','light');await screenshot('policy-warning-narrow-light');await select('#theme','dark');
  assert.ok(await evaluate('document.querySelector("#four-view-policy").getClientRects().length'));
  await click('#inspect-warning');await wait('document.querySelector("#history-dialog").open');await screenshot('policy-warning-narrow-details');await click('#close-history');
  assert.ok(await evaluate('document.querySelector("#run-workflow").getClientRects().length && document.querySelector("#select-models").getClientRects().length'));
  await evaluate('document.querySelector("#view-compare").focus()');assert.equal(await evaluate('document.activeElement.id'),'view-compare');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.ok(await evaluate('!document.querySelector("#comparison").hidden'));await click('#view-model');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
  await click('#nav-workflow');await screenshot('narrow-workflow');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
  assert.ok(await evaluate('document.querySelector("#graph").scrollWidth > document.querySelector("#graph").clientWidth'));
  check('390px studio stacks controls, graph scrolls within its panel, no page overflow');
  // Keyboard focus, accessible labels, and browser runtime errors are checked.
  assert.ok(await evaluate('document.querySelector("#theme").getAttribute("aria-label")'));
  await evaluate('document.querySelector("#graph-node-input").focus()');assert.equal(await evaluate('document.activeElement.id'),'graph-node-input');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(exceptions.length,0,exceptions.join('\n'));check('keyboard node access and no uncaught browser exceptions');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  // Project deletion uses one human confirmation, preserves other projects and
  // shared assets, and reconciles the selected project in another actual tab.
  const disposable = await request('/projects','POST',{name:'Delete “this” <project>',mode:'text',prompt:'Disposable'});
  const unselected = await request('/projects','POST',{name:'Delete the other project',mode:'text',prompt:'Disposable'});
  await openProject(disposable.id); await click('#nav-home');
  const deletions = [];
  await call('Network.enable');
  ws.addEventListener('message', event => { const m=JSON.parse(event.data); if(m.method==='Network.requestWillBeSent'&&m.params.request.method==='DELETE')deletions.push(m.params.request); });
  const deleteMenu = async id => { await wait('!document.querySelector("#delete-dialog").open && !document.querySelector("#delete-dialog").contains(document.activeElement)'); await click('#project-actions-'+id); await click('#project-actions-'+id+' + button'); await wait('document.querySelector("#delete-dialog").open'); };
  // The menu and action can both be reached/activated from the keyboard.
  await evaluate('document.querySelector("#project-actions-'+disposable.id+'").focus()'); await key('Enter'); await key('Tab');
  assert.equal(await evaluate('document.activeElement.textContent'),'Delete');
  await request('/projects/'+unselected.id,'PATCH',{name:'Delete the other project updated'});
  await wait('document.querySelector("#project-'+unselected.id+'").textContent === "Delete the other project updated"');
  assert.equal(await evaluate('document.activeElement.id'),'delete-project-'+disposable.id);
  assert.ok(await evaluate('document.querySelector("#project-actions-'+disposable.id+'").parentElement.open'));
  await key('Enter');
  await wait('document.querySelector("#delete-dialog").open');
  assert.equal(await evaluate('document.activeElement.id'),'cancel-delete');
  assert.equal(await evaluate('document.querySelector("#delete-project-name").textContent'),disposable.name);
  assert.equal(await evaluate('document.querySelector("#delete-dialog").getAttribute("aria-describedby")'),'delete-warning');
  assert.ok(await evaluate('document.querySelector("#delete-warning").textContent.includes("permanently")'));
  await screenshot('desktop-delete-dark'); await key('Escape'); await wait('!document.querySelector("#delete-dialog").open');
  await wait('document.activeElement.id === '+JSON.stringify('project-actions-'+disposable.id));
  await deleteMenu(disposable.id); await click('#cancel-delete'); await wait('!document.querySelector("#delete-dialog").open');
  await deleteMenu(disposable.id); await call('Input.dispatchMouseEvent',{type:'mousePressed',x:1,y:1,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:1,button:'left',clickCount:1});
  await wait('!document.querySelector("#delete-dialog").open');
  assert.equal(deletions.length,0); assert.ok(app.store.get(disposable.id));
  check('project action keyboard access; single named confirmation focuses Cancel; Escape, Cancel and backdrop do not delete');
  await select('#theme','light'); await deleteMenu(unselected.id); await screenshot('desktop-delete-light'); await click('#confirm-delete');
  await until(()=>!app.store.projects.has(unselected.id),'delete unselected project');await wait('!document.querySelector("#project-'+unselected.id+'")');
  assert.equal(await evaluate('localStorage.getItem("gen3d-project")'),disposable.id);
  assert.equal(deletions.length,1); assert.equal(deletions[0].url,url+'/api/projects/'+unselected.id);assert.equal(deletions[0].postData,undefined);
  assert.equal(fs.existsSync(path.join(providers.dataDir,unselected.id)),false);
  const releaseDelete = app.store.beginOperation(disposable.id);
  try {
    await deleteMenu(disposable.id); await click('#confirm-delete');await wait('!document.querySelector("#delete-error").hidden');
    assert.ok(await evaluate('document.querySelector("#delete-error").textContent.includes("Wait")'));
    assert.ok(app.store.get(disposable.id)); await click('#cancel-delete');
  } finally { releaseDelete(); }
  check('only the confirmed ID is sent; deleting another project preserves selection; busy project deletion gives a compact retryable error');
  const second = await call('Target.createTarget',{url:url+'/#studio'});
  const {sessionId} = await call('Target.attachToTarget',{targetId:second.targetId,flatten:true});
  await until(()=>evaluate('document.querySelector("#title")?.textContent === '+JSON.stringify(disposable.name),sessionId),'second tab selected project');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await deleteMenu(disposable.id);await screenshot('narrow-delete-light');await click('#cancel-delete');
  await select('#theme','dark');await deleteMenu(disposable.id);await screenshot('narrow-delete-dark');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
  await click('#confirm-delete');await wait('!document.querySelector("#delete-dialog").open && location.hash === "#home"');
  assert.equal(await evaluate('localStorage.getItem("gen3d-project")'),null);
  await until(()=>evaluate('location.hash === "#home" && !document.querySelector("#project-'+disposable.id+'") && document.querySelector("#workspace").hidden',sessionId),'second tab drops deleted selection');
  await call('Target.closeTarget',{targetId:second.targetId});
  assert.ok(app.store.projects.has(automatic.id)); assert.ok(app.store.library.get(assetId));
  assert.ok(fs.existsSync(path.join(providers.dataDir,'workflow-presets.json')));
  check('selected deletion clears storage and returns Home in both tabs; dialog fits both themes and narrow/desktop layouts; shared assets/presets remain');
  // All remaining deletes are explicit Web UI confirmations, including empty state.
  for (const p of app.store.list()) { await deleteMenu(p.id); await click('#confirm-delete'); await until(()=>!app.store.projects.has(p.id),'delete '+p.name); await wait('!document.querySelector("#delete-dialog").open'); }
  await wait('!document.querySelector("#projects-empty").hidden && document.querySelectorAll("#project-cards article").length === 0');
  await wait('document.activeElement.id === "empty-create"');await screenshot('narrow-projects-empty');
  await call('Page.reload');await wait('!document.querySelector("#projects-empty").hidden');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await screenshot('home-empty');
  assert.ok(await evaluate('document.querySelector("#empty-create").getClientRects().length && document.querySelector("#home").innerText.includes("No projects yet.")'));
  for (const theme of ['light','dark']) {
    await select('#theme',theme);await screenshot('home-empty-'+theme);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await screenshot('narrow-home-empty-'+theme);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'));
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  }
  await click('#empty-create'); await wait('document.querySelector("#create-dialog").open');await click('#close-create');
  assert.equal(exceptions.length,0,exceptions.join('\n'));check('last deletion leaves a usable empty state and create action, persists after reload, with no browser exceptions');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  if (posedFixtures) {
    realPosed = true;
    for (const [kind, source] of [['blend','posed.blend'],['glb','blend/base.glb']]) {
      await click('#nav-home');await click('#new-project');await fill('#create',{workflowType:'humanoid',mode:'image',prompt:'Improve posed hair '+kind});
      await upload('#create input[name=image]',path.join(assets,'concept-1/concept.png'));await submit('#create');
      await until(()=>app.store.list().some(p=>p.prompt==='Improve posed hair '+kind),'posed project');
      const project=app.store.list().find(p=>p.prompt==='Improve posed hair '+kind);
      // Keep this focused on the real preservation path; visual inspection
      // providers remain injected in the surrounding browser suite.
      await select('#studio-refinement','false');await until(()=>!app.store.get(project.id).refinementSettings.enabled,'posed refinement off');
      await click('#select-models');await wait('document.querySelector("#library-dialog").open');
      await upload('#library-file',path.join(posedFixtures,source));
      await until(()=>app.store.library.list().assets.some(a=>a.name===path.basename(source)),'posed asset upload',30000);
      const asset=app.store.library.list().assets.find(a=>a.name===path.basename(source));
      await evaluate('document.querySelector("#library-search").value='+JSON.stringify(path.basename(source))+';document.querySelector("#library-search").dispatchEvent(new Event("input",{bubbles:true}))');
      await wait('document.querySelectorAll("#library-assets article").length===1');
      await libraryAction('Edit this model');await wait('document.querySelector("#base-dialog").open && document.querySelectorAll("#base-meshes input").length===2');
      await evaluate('document.querySelector("#base-meshes input").click()');await submit('#base-form');
      await until(()=>app.store.get(project.id).editableBase?.review==='approved','posed scope');
      await wait('!document.querySelector("#base-dialog").open && !document.querySelector("#run-workflow").disabled');
      const original=app.store.library.get(asset.id).sha256;
      await click('#run-workflow');
      await until(()=>{const r=app.store.get(project.id).workflowRuns[0];if(r&&r.status!=='running')assert.equal(r.status,'completed',r.error);return r?.status==='completed';},'real posed '+kind+' workflow',120000);
      const saved=app.store.get(project.id),version=saved.versions.at(-1);
      assert.deepEqual(saved.editableBase.scope,{editableObjects:['Hair'],allowChanges:[],allowNewObjects:false});
      assert.equal(saved.activity.filter(e=>e.type==='editable_base_authorized').length,1);
      assert.equal(version.preservation.roundtrip.passed,true);assert.equal(app.store.library.verify(asset).sha256,original);
      await wait('document.querySelector("#exports").textContent.includes("Download GLB")');
      await screenshot('posed-'+kind+'-verified');
      check('posed '+kind+' Edit this model → Edit selected parts → Improve passes real Blender preservation with one exact scope authorization');
    }
    realPosed = false;
  }
  const limited=await failure('Usage limit',()=>{usageLimit=true;},'Fixture usage limit reached');
  assert.equal(app.runner.usageLimited,true);const count=app.store.get(limited.id).workflowRuns.length;
  await wait('document.querySelector("#run-workflow").disabled');await pause(1800);
  assert.equal(app.store.get(limited.id).workflowRuns.length,count);check('injected usage limit disables generation with no retries, resets, or provider switches');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({realBrowser:true,realBlender:!!posedFixtures,posedFixtures:!!posedFixtures,codexUsed:false,viewports:[{width:1440,height:1050},{width:390,height:844}],checks,exceptions,limitation:posedFixtures?'Posed base cases use real Blender and a deterministic modeler. Other cases use injected providers/recorded GLBs; no Codex generation.':'Injected providers and recorded GLBs; live generation/preservation are separately checked.'},null,2));
} finally { ws?.close();if(chrome&&chrome.exitCode===null){chrome.kill();await once(chrome,'exit');}app.server.close();await app.closed;fs.rmSync(temp,{recursive:true,force:true}); }
