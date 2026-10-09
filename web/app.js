import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = id => document.getElementById(id);
let projects = [], projectId = localStorage.getItem('gen3d-project'), versionId = null, loaded = '', model = null, lastState = '', loadToken = 0;
let followLatest = false;
let status = { busy: false, usageLimited: false };
function notify(message) { $('notice').textContent = message; $('notice').hidden = !message; }
async function api(route, method = 'GET', input) {
  const response = await fetch(`/api${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: input ? JSON.stringify(input) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function project() { return projects.find(p => p.id === projectId); }
function currentConcept(p, c) { return c.prompt === p.prompt && (!c.profile || c.profile === p.profile); }
function revisionReferenceSet(p, set) {
  const source = set.request?.kind === 'revision' && p.versions.find(v => v.id === set.request.sourceVersionId && v.status === 'ready');
  const concept = p.concepts.find(c => c.id === set.conceptId && c.status === 'ready' && c.review === 'approved');
  return Boolean(source && concept && source.conceptId === concept.id && source.prompt === set.prompt
    && set.prompt === concept.prompt && (!concept.profile || set.profile === concept.profile));
}
function consistencyAllowsModeling(set) {
  return set.consistency.status === 'passed'
    || (set.consistency.status === 'failed' && set.consistencySettings?.enabled && set.consistencySettings.onFailure === 'continue')
    || (set.consistency.status === 'skipped' && set.consistencySettings?.enabled === false);
}
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
  const node = document.createElement('figure'), image = document.createElement('img'), label = document.createElement('figcaption'), link = document.createElement('a');
  image.src = artifact(file); image.alt = caption; label.textContent = caption;
  link.href = artifact(file); link.target = '_blank'; link.rel = 'noopener'; link.append(image); node.append(link, label); return node;
}
function render() {
  $('projects').replaceChildren(...projects.map(p => { const b = button(p.name, () => { projectId = p.id; versionId = null; followLatest = false; localStorage.setItem('gen3d-project', p.id); lastState = ''; render(); }); b.classList.toggle('selected', p.id === projectId); return b; }));
  const p = project(); $('empty').hidden = !!p; $('workspace').hidden = !p;
  if (!p) return;
  $('title').textContent = p.name;
  if (followLatest || !versionId || !p.versions.some(v => v.id === versionId)) versionId = p.versions.at(-1)?.id || null;
  const v = p.versions.find(v => v.id === versionId);
  const signature = JSON.stringify([p, versionId, status.busy, status.usageLimited]);
  const sourceConcept = p.concepts.find(c => c.id === v?.conceptId);
  const projectBusy = p.versions.some(v => v.status === 'running') || p.concepts.some(c => c.status === 'running') || p.referenceSets.some(s => s.status === 'running');
  const pendingConcept = p.concepts.some(c => currentConcept(p, c) && c.status === 'ready' && c.review === 'pending');
  const pendingViews = p.referenceSets.some(s => (s.conceptId === p.selectedConceptId || revisionReferenceSet(p, s)) && s.status === 'ready' && s.review === 'pending');
  const pendingPreview = p.versions.some(v => v.status === 'ready' && v.checkpoints?.preview && v.review === 'pending');
  if (followLatest && !projectBusy && !pendingConcept && !pendingViews && v?.status === 'ready') followLatest = false;
  const pendingInput = ((p.checkpoints.input || p.inputCheckpoint) && p.inputReview !== 'approved') || p.inputReview === 'rejected';
  const busy = status.busy || projectBusy;
  const pendingRefs = p.references.some(r => r.review === 'pending');
  const regenerableSets = p.referenceSets.filter(s => (s.conceptId === p.selectedConceptId && s.prompt === p.prompt && s.profile === p.profile) || revisionReferenceSet(p, s)).reverse();
  $('project-state').textContent = status.usageLimited ? 'Codex usage limit' : projectBusy ? 'Generating…' : pendingInput ? 'Review input' : pendingConcept ? 'Review concept image' : pendingViews ? 'Review multi-view references' : pendingPreview ? 'Review 3D preview' : pendingRefs ? 'Review references' : v?.status === 'ready' ? `Model ${v.review}` : 'Ready to generate';
  for (const id of ['generate', 'retry']) $(id).disabled = busy || pendingRefs || pendingInput || pendingConcept || pendingViews || pendingPreview || status.usageLimited;
  for (const id of ['approve', 'reject']) $(id).disabled = v?.status !== 'ready';
  $('revise').querySelector('button').disabled = busy || pendingRefs || pendingInput || pendingConcept || pendingViews || pendingPreview || status.usageLimited || v?.status !== 'ready';
  $('concept-retry').hidden = p.mode !== 'text'; $('concept-heading').hidden = p.mode !== 'text';
  $('concept-retry').querySelector('button').disabled = busy || pendingInput || pendingPreview || pendingRefs || status.usageLimited;
  $('views-retry').hidden = p.mode !== 'text'; $('views-heading').hidden = p.mode !== 'text';
  $('views-retry').querySelector('button').disabled = busy || pendingInput || pendingConcept || pendingPreview || pendingRefs || (!p.selectedConceptId && !regenerableSets.length) || status.usageLimited;
  $('checkpoints').querySelector('button').disabled = projectBusy;
  $('consistency').hidden = p.mode !== 'text';
  $('consistency').querySelector('button').disabled = projectBusy;
  $('edit').querySelector('button').disabled = projectBusy; $('reference').querySelector('button').disabled = projectBusy;
  $('version-info').textContent = v ? `Version ${v.number} · ${v.kind} · ${v.status} · ${v.review}${sourceConcept ? ` · concept ${sourceConcept.number}` : ''}${v.referenceSetId ? ` · view set ${p.referenceSets.find(s => s.id === v.referenceSetId)?.number}` : ''}${v.feedback ? ` · ${v.feedback}` : ''}${v.continuedDespiteInconsistency ? ' · WARNING: modeling continued despite failed consistency inspection' : v.consistency?.status === 'skipped' ? ' · consistency inspection skipped' : ''}${v.error ? ` — ${v.error}` : ''}` : 'No versions yet. Generate your first model.';
  $('model-summary').textContent = v?.summary || '';
  for (const [id, key] of [['download', 'glb'], ['blend-download', 'blend']]) { $(id).hidden = v?.status !== 'ready' || (v.checkpoints?.preview && v.review !== 'approved'); if (v?.status === 'ready') { $(id).href = artifact(v.artifacts[key]) + '?download=1'; $(id).download = key === 'glb' ? 'model.glb' : 'scene.blend'; } }
  const options = p.versions.map(v => { const option = document.createElement('option'); option.value = v.id; option.textContent = `v${v.number} · ${v.kind} · ${v.status}`; return option; });
  if (!options.length) { const option = document.createElement('option'); option.textContent = 'No model yet'; options.push(option); }
  $('versions').replaceChildren(...options); if (versionId) $('versions').value = versionId;
  if (signature !== lastState) {
    const viewTarget = $('views-retry').elements.referenceSetId, selectedTarget = viewTarget.value, latestTarget = viewTarget.options[0]?.value;
    viewTarget.replaceChildren(...regenerableSets.map(set => {
      const option = document.createElement('option'); option.value = set.id;
      option.textContent = `View set ${set.number} · concept ${p.concepts.find(c => c.id === set.conceptId)?.number}${set.request?.kind === 'revision' ? ` · revision of v${p.versions.find(v => v.id === set.request.sourceVersionId)?.number}` : ''}`;
      return option;
    }));
    if (!regenerableSets.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'Selected base concept'; viewTarget.append(option); }
    if (regenerableSets[0]?.id === latestTarget && regenerableSets.some(s => s.id === selectedTarget)) viewTarget.value = selectedTarget;
    for (const key of ['name', 'prompt', 'profile']) { const field = $('edit').elements[key]; if (document.activeElement !== field) field.value = p[key]; }
    for (const key of ['input', 'concept', 'multiView', 'preview']) { const field = $('checkpoints').elements[key]; if (document.activeElement !== field) field.checked = p.checkpoints[key]; }
    for (const cls of ['concept-setting', 'view-setting']) $('checkpoints').querySelector('.' + cls).hidden = p.mode !== 'text';
    for (const key of ['enabled', 'onFailure']) { const field = $('consistency').elements[key]; if (document.activeElement !== field) field.value = String(p.consistencySettings[key]); }
    syncConsistency($('consistency'));
    $('input-review-state').textContent = `Input review: ${p.inputReview}`;
    $('input-review').replaceChildren(...(p.checkpoints.input || p.inputCheckpoint || p.inputReview === 'rejected' ? ['approved', 'rejected'].map(decision => button(decision === 'approved' ? 'Accept input' : 'Reject input', () => api(`/projects/${p.id}/input/review`, 'POST', { decision }), projectBusy)) : []));
    $('concepts').replaceChildren(...p.concepts.slice().reverse().map(c => {
      const node = c.artifacts.image ? figure(c.artifacts.image, `Concept ${c.number} · ${c.review}${c.feedback ? ' · ' + c.feedback : ''}${p.selectedConceptId === c.id ? ' · selected' : ''}${v?.conceptId === c.id ? ` · source of v${v.number}` : ''}`) : document.createElement('div');
      if (c.status !== 'ready') { const info = document.createElement('p'); info.textContent = `Concept ${c.number} · ${c.status}${c.error ? ' — ' + c.error : ''}`; node.append(info); }
      const actions = document.createElement('div'); actions.className = 'reference-actions';
      if (c.status === 'ready') for (const decision of ['approved', 'rejected']) actions.append(button(decision === 'approved' ? 'Accept concept & generate views' : 'Reject concept', async () => { followLatest = decision === 'approved'; const current = await api(`/projects/${p.id}/concepts/${c.id}/review`, 'POST', { decision }); versionId = current.versions.at(-1)?.id || null; }, busy || pendingInput || (decision === 'approved' && pendingViews) || pendingPreview || !currentConcept(p, c)));
      node.append(actions); return node;
    }));
    $('reference-sets').replaceChildren(...p.referenceSets.slice().reverse().map(set => {
      const node = document.createElement('section'), info = document.createElement('p');
      const models = p.versions.filter(v => v.referenceSetId === set.id).map(v => `v${v.number}`).join(', ');
      const revisionSource = revisionReferenceSet(p, set) ? p.versions.find(v => v.id === set.request.sourceVersionId) : null;
      info.textContent = `View set ${set.number} · ${set.profile} · concept ${p.concepts.find(c => c.id === set.conceptId)?.number} · ${set.status} · ${set.review} · consistency ${set.consistency.status}${revisionSource ? ` · revision of v${revisionSource.number} · ${set.request.feedback}` : ''}${models ? ' · models ' + models : ''}${set.feedback ? ' · ' + set.feedback : ''}${set.error ? ' — ' + set.error : ''}`;
      const settings = set.consistencySettings || { enabled: true, onFailure: 'stop' };
      info.textContent += ` · check ${settings.enabled ? 'On' : 'Off'}${settings.enabled ? ` · on failure ${settings.onFailure === 'continue' ? 'Warn and continue' : 'Stop'}` : ''} · inspection outcome ${set.consistency.outcome || (set.consistency.status === 'passed' ? 'allowed' : 'blocked')}`;
      if (set.warning) { const warning = document.createElement('p'); warning.className = 'warning'; warning.setAttribute('role', 'alert'); warning.textContent = set.warning + (models ? ` Modeling continued: ${models}.` : set.review === 'pending' ? ' Awaiting explicit human approval.' : ''); node.append(warning); }
      node.append(info, ...set.images.map(image => figure(image.file, image.label)));
      for (const issue of set.consistency.issues) { const line = document.createElement('p'); line.textContent = issue; node.append(line); }
      if (set.artifacts['consistency.json']) { const link = document.createElement('a'); link.href = artifact(set.artifacts['consistency.json']); link.textContent = 'Consistency report'; link.target = '_blank'; node.append(link); }
      if (set.status === 'ready') for (const decision of ['approved', 'rejected']) node.append(button(decision === 'approved' ? 'Accept views & model' : 'Reject view set', async () => {
        followLatest = decision === 'approved'; await api(`/projects/${p.id}/reference-sets/${set.id}/review`, 'POST', { decision });
      }, busy || pendingInput || pendingConcept || pendingPreview || (set.conceptId !== p.selectedConceptId && !revisionSource) || (decision === 'approved' && !consistencyAllowsModeling(set))));
      return node;
    }));
    $('input-image').replaceChildren(...(p.inputImage ? [figure(p.inputImage, 'Original image input')] : []));
    $('references').replaceChildren(...p.references.map(r => {
      const node = figure(r.file, `${r.label} · ${r.review}`), actions = document.createElement('div'); actions.className = 'reference-actions';
      for (const decision of ['approved', 'rejected']) actions.append(button(decision === 'approved' ? 'Approve reference' : 'Reject reference', () => api(`/projects/${p.id}/references/${r.id}/review`, 'POST', { decision }), projectBusy));
      node.append(actions); return node;
    }));
    $('reference-state').textContent = pendingRefs ? 'Review each pending reference before modeling. Rejected images will not be used.' : 'Supplementary references are optional. Text input needs a base concept and all four generated modeling views.';
    $('history').replaceChildren(...p.activity.slice().reverse().map(e => { const li = document.createElement('li'); const n = p.versions.find(v => v.id === e.versionId)?.number, c = p.concepts.find(c => c.id === e.conceptId)?.number, set = p.referenceSets.find(s => s.id === e.referenceSetId)?.number; li.textContent = `${new Date(e.at).toLocaleString()} · ${e.actor} · ${e.type.replaceAll('_', ' ')}${n ? ` · v${n}` : ''}${c ? ` · concept ${c}` : ''}${set ? ` · view set ${set}` : ''}${e.decision ? ` · ${e.decision}` : ''}${e.message ? ` · ${e.message}` : ''}`; return li; }));
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
create.elements.mode.onchange = () => { const image = create.elements.mode.value === 'image'; $('image-label').hidden = !image; create.elements.image.required = image; create.elements.prompt.required = !image; for (const cls of ['concept-setting', 'view-setting', 'profile-setting', 'consistency-settings']) create.querySelector('.' + cls).hidden = image; syncConsistency(create); };
form('create', async data => {
  const mode = data.get('mode'), p = await api('/projects', 'POST', { name: data.get('name'), mode, ...(data.get('profile') !== 'auto' ? { profile: data.get('profile') } : {}), prompt: data.get('prompt'), checkpoints: checkpointData(data), consistencySettings: consistencyData(data, create), ...(mode === 'image' ? { image: await fileImage(data.get('image')) } : {}) });
  projectId = p.id; localStorage.setItem('gen3d-project', p.id); versionId = null; followLatest = false; lastState = ''; create.reset(); create.elements.mode.onchange();
});
function syncConsistency(form) { form.elements.onFailure.disabled = form.elements.enabled.value === 'false'; }
function consistencyData(data, form) { return { enabled: data.get('enabled') === 'true', onFailure: form.elements.onFailure.value }; }
for (const form of [create, $('consistency')]) form.elements.enabled.onchange = () => syncConsistency(form);
form('consistency', data => api(`/projects/${projectId}`, 'PATCH', { consistencySettings: consistencyData(data, $('consistency')) }));
function checkpointData(data) { return Object.fromEntries(['input', 'concept', 'multiView', 'preview'].map(key => [key, data.has(key)])); }
form('checkpoints', data => api(`/projects/${projectId}`, 'PATCH', { checkpoints: checkpointData(data) }));
form('concept-retry', async data => { await api(`/projects/${projectId}/concepts`, 'POST', { feedback: data.get('feedback') }); followLatest = true; });
form('views-retry', async data => { await api(`/projects/${projectId}/reference-sets`, 'POST', { ...(data.get('referenceSetId') ? { referenceSetId: data.get('referenceSetId') } : {}), feedback: data.get('feedback') }); followLatest = true; });
form('edit', data => api(`/projects/${projectId}`, 'PATCH', { name: data.get('name'), prompt: data.get('prompt'), profile: data.get('profile') }));
form('reference', async data => { await api(`/projects/${projectId}/references`, 'POST', { label: data.get('label'), image: await fileImage(data.get('image')) }); $('reference').reset(); });
async function generate(kind, feedback) {
  followLatest = true;
  const p = await api(`/projects/${projectId}/generate`, 'POST', { kind, ...(kind === 'revision' ? { sourceVersionId: versionId, feedback } : {}) });
  versionId = p.versions.at(-1)?.id || null;
}
form('revise', async data => { await generate('revision', data.get('feedback')); $('revise').reset(); });
$('generate').onclick = () => safe(() => generate('generate'));
$('retry').onclick = () => safe(() => generate('retry'));
for (const [id, decision] of [['approve', 'approved'], ['reject', 'rejected']]) $(id).onclick = () => safe(() => api(`/projects/${projectId}/versions/${versionId}/review`, 'POST', { decision }));
$('versions').onchange = () => { followLatest = false; versionId = $('versions').value; render(); };
$('fit').onclick = fit;
await safe(refresh);
setInterval(() => refresh().catch(() => {}), 1500);
