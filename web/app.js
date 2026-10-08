import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = id => document.getElementById(id);
let projects = [], projectId = localStorage.getItem('gen3d-project'), versionId = null, loaded = '', model = null, lastState = '', loadToken = 0;
let status = { busy: false, usageLimited: false };
function notify(message) { $('notice').textContent = message; $('notice').hidden = !message; }
async function api(route, method = 'GET', input) {
  const response = await fetch(`/api${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: input ? JSON.stringify(input) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function project() { return projects.find(p => p.id === projectId); }
function artifact(file) { return `/api/projects/${projectId}/artifacts/${file}`; }
function button(label, action, disabled = false) { const b = document.createElement('button'); b.textContent = label; b.disabled = disabled; b.onclick = () => safe(action); return b; }
async function safe(action) { try { notify(''); await action(); await refresh(); } catch (e) { notify(e.message); } }
async function fileImage(file) {
  if (!file || file.size > 10_000_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image, at most 10 MB.');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

let renderer, controls;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#1c2532');
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000); camera.position.set(4, 3, 5);
scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.8));
for (const [x, y, z, power] of [[5, 8, 5, 3], [-5, 3, -5, 2]]) { const light = new THREE.DirectionalLight(0xffffff, power); light.position.set(x, y, z); scene.add(light); }
try {
  renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('viewer').prepend(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  new ResizeObserver(() => { const { clientWidth: w, clientHeight: h } = $('viewer'); if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }).observe($('viewer'));
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
} catch { $('viewer-message').textContent = 'WebGL is unavailable. Use the rendered preview or download the GLB.'; }
function dispose(object) { object?.traverse(o => { o.geometry?.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!m) continue; for (const value of Object.values(m)) if (value?.isTexture) value.dispose(); m.dispose(); } }); }
function fit() {
  if (!model || !controls) return;
  const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, .1);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1 / camera.aspect) * 1.2;
  camera.position.copy(center).add(new THREE.Vector3(1.4, 1, 1.8).normalize().multiplyScalar(distance));
  camera.near = radius / 1000; camera.far = radius * 1000; camera.updateProjectionMatrix();
  controls.target.copy(center); controls.maxDistance = radius * 100; controls.minDistance = radius / 20; controls.update();
}
async function showModel(v) {
  const file = v?.status === 'ready' ? artifact(v.artifacts.glb) : '';
  if (file === loaded) return;
  loaded = file; const token = ++loadToken;
  if (model) { scene.remove(model); dispose(model); model = null; }
  if (!renderer) return;
  $('viewer-message').hidden = false;
  $('viewer-message').textContent = file ? 'Loading model…' : v?.status === 'running' ? 'Codex is modeling in Blender…' : 'Generate a model to see it here.';
  if (!file) return;
  try {
    const result = await new GLTFLoader().loadAsync(file);
    if (token !== loadToken) { dispose(result.scene); return; }
    model = result.scene; scene.add(model); fit(); $('viewer-message').hidden = true;
  } catch (e) { if (token === loadToken) { loaded = ''; $('viewer-message').textContent = `Unable to load model: ${e.message}`; } }
}
function figure(file, caption) {
  const node = document.createElement('figure'), image = document.createElement('img'), label = document.createElement('figcaption');
  image.src = artifact(file); image.alt = caption; label.textContent = caption; node.append(image, label); return node;
}
function render() {
  $('projects').replaceChildren(...projects.map(p => { const b = button(p.name, () => { projectId = p.id; versionId = null; localStorage.setItem('gen3d-project', p.id); lastState = ''; render(); }); b.classList.toggle('selected', p.id === projectId); return b; }));
  const p = project(); $('empty').hidden = !!p; $('workspace').hidden = !p;
  if (!p) return;
  $('title').textContent = p.name;
  const signature = JSON.stringify(p);
  if (!versionId || !p.versions.some(v => v.id === versionId)) versionId = p.versions.at(-1)?.id || null;
  const v = p.versions.find(v => v.id === versionId);
  const projectBusy = p.versions.some(v => v.status === 'running');
  const busy = status.busy || projectBusy;
  const pendingRefs = p.references.some(r => r.review === 'pending');
  $('project-state').textContent = status.usageLimited ? 'Codex usage limit' : projectBusy ? 'Modeling in Blender' : pendingRefs ? 'Review references' : v?.status === 'ready' ? `Model ${v.review}` : 'Ready to generate';
  for (const id of ['generate', 'retry']) $(id).disabled = busy || pendingRefs || status.usageLimited;
  for (const id of ['approve', 'reject']) $(id).disabled = v?.status !== 'ready';
  $('revise').querySelector('button').disabled = busy || pendingRefs || status.usageLimited || v?.status !== 'ready';
  $('edit').querySelector('button').disabled = projectBusy; $('reference').querySelector('button').disabled = projectBusy;
  $('version-info').textContent = v ? `Version ${v.number} · ${v.kind} · ${v.status} · ${v.review}${v.feedback ? ` · ${v.feedback}` : ''}${v.error ? ` — ${v.error}` : ''}` : 'No versions yet. Generate your first model.';
  $('model-summary').textContent = v?.summary || '';
  for (const [id, key] of [['download', 'glb'], ['blend-download', 'blend']]) { $(id).hidden = v?.status !== 'ready'; if (v?.status === 'ready') { $(id).href = artifact(v.artifacts[key]) + '?download=1'; $(id).download = key === 'glb' ? 'model.glb' : 'scene.blend'; } }
  const options = p.versions.map(v => { const option = document.createElement('option'); option.value = v.id; option.textContent = `v${v.number} · ${v.kind} · ${v.status}`; return option; });
  if (!options.length) { const option = document.createElement('option'); option.textContent = 'No model yet'; options.push(option); }
  $('versions').replaceChildren(...options); if (versionId) $('versions').value = versionId;
  if (signature !== lastState) {
    for (const key of ['name', 'prompt']) { const field = $('edit').elements[key]; if (document.activeElement !== field) field.value = p[key]; }
    $('input-image').replaceChildren(...(p.inputImage ? [figure(p.inputImage, 'Original image input')] : []));
    $('references').replaceChildren(...p.references.map(r => {
      const node = figure(r.file, `${r.label} · ${r.review}`), actions = document.createElement('div'); actions.className = 'reference-actions';
      for (const decision of ['approved', 'rejected']) actions.append(button(decision === 'approved' ? 'Approve reference' : 'Reject reference', () => api(`/projects/${p.id}/references/${r.id}/review`, 'POST', { decision }), projectBusy));
      node.append(actions); return node;
    }));
    $('reference-state').textContent = pendingRefs ? 'Review each pending reference before modeling. Rejected images will not be used.' : 'References are optional. Text prompts can be modeled directly.';
    $('history').replaceChildren(...p.activity.slice().reverse().map(e => { const li = document.createElement('li'); const n = p.versions.find(v => v.id === e.versionId)?.number; li.textContent = `${new Date(e.at).toLocaleString()} · ${e.actor} · ${e.type.replaceAll('_', ' ')}${n ? ` · v${n}` : ''}${e.decision ? ` · ${e.decision}` : ''}${e.message ? ` · ${e.message}` : ''}`; return li; }));
    lastState = signature;
  }
  const renderKey = v?.artifacts?.render || '';
  if ($('render-image').dataset.file !== renderKey) { $('render-image').dataset.file = renderKey; $('render-image').replaceChildren(...(renderKey ? [figure(renderKey, `Rendered view · v${v.number}`)] : [])); }
  showModel(v);
}
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { [projects, status] = await Promise.all([api('/projects'), api('/status')]); $('connection').textContent = status.busy ? 'Codex → Blender' : 'Local server connected'; render(); }
  catch (e) { $('connection').textContent = 'Local server disconnected'; throw e; }
  finally { refreshing = false; }
}
function form(id, action) { $(id).onsubmit = event => { event.preventDefault(); safe(() => action(new FormData(event.target))); }; }
const create = $('create');
create.elements.mode.onchange = () => { const image = create.elements.mode.value === 'image'; $('image-label').hidden = !image; create.elements.image.required = image; create.elements.prompt.required = !image; };
form('create', async data => {
  const mode = data.get('mode'), p = await api('/projects', 'POST', { name: data.get('name'), mode, prompt: data.get('prompt'), ...(mode === 'image' ? { image: await fileImage(data.get('image')) } : {}) });
  projectId = p.id; localStorage.setItem('gen3d-project', p.id); versionId = null; lastState = ''; create.reset(); create.elements.mode.onchange();
});
form('edit', data => api(`/projects/${projectId}`, 'PATCH', { name: data.get('name'), prompt: data.get('prompt') }));
form('reference', async data => { await api(`/projects/${projectId}/references`, 'POST', { label: data.get('label'), image: await fileImage(data.get('image')) }); $('reference').reset(); });
async function generate(kind, feedback) {
  const p = await api(`/projects/${projectId}/generate`, 'POST', { kind, ...(kind === 'revision' ? { sourceVersionId: versionId, feedback } : {}) });
  versionId = p.versions.at(-1).id;
}
form('revise', async data => { await generate('revision', data.get('feedback')); $('revise').reset(); });
$('generate').onclick = () => safe(() => generate('generate'));
$('retry').onclick = () => safe(() => generate('retry'));
for (const [id, decision] of [['approve', 'approved'], ['reject', 'rejected']]) $(id).onclick = () => safe(() => api(`/projects/${projectId}/versions/${versionId}/review`, 'POST', { decision }));
$('versions').onchange = () => { versionId = $('versions').value; render(); };
$('fit').onclick = fit;
await safe(refresh);
setInterval(() => refresh().catch(() => {}), 1500);
