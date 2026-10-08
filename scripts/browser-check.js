// Optional live browser check. Start an isolated Chrome with remote debugging;
// this script never starts generation or uses Codex allowance.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const appUrl = process.env.GEN3D_URL || 'http://127.0.0.1:3333';
const chromeUrl = process.env.GEN3D_CHROME_URL || 'http://127.0.0.1:9333';
const output = path.resolve(process.env.GEN3D_BROWSER_OUTPUT || '.gen3d/browser-check');
const projects = await (await fetch(appUrl + '/api/projects')).json();
const project = process.env.GEN3D_PROJECT_ID ? projects.find(p => p.id === process.env.GEN3D_PROJECT_ID) : projects.find(p => p.versions.some(v => v.status === 'ready'));
if (!project) throw new Error('Choose a project with a completed real model (GEN3D_PROJECT_ID)');
const version = process.env.GEN3D_VERSION_ID ? project.versions.find(v => v.id === process.env.GEN3D_VERSION_ID && v.status === 'ready') : project.versions.filter(v => v.status === 'ready').at(-1);
if (!version) throw new Error('Choose a completed version');
const page = await (await fetch(chromeUrl + '/json/new?' + encodeURIComponent(appUrl), { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map(); const errors = [];
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result); }
};
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error('Browser check timed out: ' + expression);
}
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1100, deviceScaleFactor: 1, mobile: false });
  await waitFor('document.readyState === "complete"');
  await evaluate(`localStorage.setItem('gen3d-project', ${JSON.stringify(project.id)})`);
  await call('Page.reload');
  await waitFor(`document.querySelector('#versions')?.options.length > 0 && document.querySelector('#title')?.textContent === ${JSON.stringify(project.name)}`);
  await evaluate(`document.querySelector('#versions').value = ${JSON.stringify(version.id)}; document.querySelector('#versions').dispatchEvent(new Event('change'))`);
  await waitFor('document.querySelector("#viewer-message").hidden && !document.querySelector("#download").hidden');
  const info = await evaluate(`({ title: document.querySelector('#title').textContent, version: document.querySelector('#versions').value, canvas: !!document.querySelector('#viewer canvas'), download: document.querySelector('#download').href, activity: document.querySelector('#history').children.length, inputImageVisible: !!document.querySelector('#input-image img'), referenceImages: document.querySelectorAll('#references img').length })`);
  const download = await fetch(info.download); const glb = Buffer.from(await download.arrayBuffer());
  if (!download.ok || glb.subarray(0, 4).toString() !== 'glTF') throw new Error('GLB download failed');
  fs.mkdirSync(output, { recursive: true });
  const before = (await call('Page.captureScreenshot', { format: 'png' })).data;
  fs.writeFileSync(path.join(output, 'preview.png'), Buffer.from(before, 'base64'));
  const box = await evaluate(`(() => { const r = document.querySelector('#viewer canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 100, y: box.y + 40, button: 'left', buttons: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 100, y: box.y + 40, button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 500));
  const orbit = (await call('Page.captureScreenshot', { format: 'png' })).data;
  if (before === orbit) throw new Error('Orbit did not change the browser preview');
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'right', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 35, y: box.y, button: 'right', buttons: 2 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 35, y: box.y, button: 'right', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 500));
  const pan = (await call('Page.captureScreenshot', { format: 'png' })).data;
  if (pan === orbit) throw new Error('Pan did not change the browser preview');
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -150 });
  await new Promise(resolve => setTimeout(resolve, 500));
  const zoom = (await call('Page.captureScreenshot', { format: 'png' })).data;
  if (zoom === pan) throw new Error('Zoom did not change the browser preview');
  fs.writeFileSync(path.join(output, 'orbit-pan-zoom.png'), Buffer.from(zoom, 'base64'));
  if (errors.length) throw new Error('Browser exceptions: ' + errors.join(', '));
  const report = { ...info, projectId: project.id, versionId: version.id, glbBytes: glb.length, glbSha256: createHash('sha256').update(glb).digest('hex'), orbit: 'passed', pan: 'passed', zoom: 'passed', exceptions: errors, checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { ws.close(); await fetch(chromeUrl + '/json/close/' + page.id); }
