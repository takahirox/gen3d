import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { stageNames, studioState, currentConcept, revisionReferenceSet, consistencyAllowsModeling } from './studio-state.js';

const $ = id => document.getElementById(id);
let projects = [], projectId = localStorage.getItem('gen3d-project'), versionId = null, loaded = '', model = null, lastState = '', loadToken = 0;
let stage = 'input', stagePinned = false, conceptId = null, viewId = null;
let status = { busy: false, usageLimited: false };
function notify(message) {
  for (const id of ['notice', 'dialog-error']) { $(id).textContent = message; $(id).hidden = !message; }
}
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
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.listenToKeyEvents($('viewer'));
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
  if (file && file === loaded) return;
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
  image.onerror = () => { label.textContent = `${caption} · Image unavailable. Open the artifact to inspect it.`; label.classList.add('error'); };
  link.href = artifact(file); link.target = '_blank'; link.rel = 'noopener'; link.append(image); node.append(link, label); return node;
}
function chooseStage(key, pin = true) {
  stage = key; stagePinned = pin; lastState = ''; render();
}
function selectOptions(id, items, selected, label) {
  const select = $(id), options = items.map(a => { const o = document.createElement('option'); o.value = a.id; o.textContent = label(a); return o; });
  if (!options.length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'No artifacts yet'; options.push(o); }
  if (select.dataset.options !== JSON.stringify(options.map(o => [o.value, o.textContent]))) {
    select.dataset.options = JSON.stringify(options.map(o => [o.value, o.textContent])); select.replaceChildren(...options);
  }
  select.value = selected || ''; select.disabled = !items.length;
}
function placeholder(message) { const node = document.createElement('div'); node.className = 'empty-artifact'; node.textContent = message; return node; }
function describe(a, type) { return a ? `${type} ${a.number} · ${a.status} · ${a.review}${a.feedback ? ` · ${a.feedback}` : ''}${a.error ? ` — ${a.error}` : ''}` : `No ${type.toLowerCase()} yet.`; }
function thumbnails(id, items, selected, image, label, select) {
  $(id).replaceChildren(...items.slice().reverse().map(a => {
    const b = button(label(a), () => select(a.id)); b.className = a.id === selected ? 'selected' : ''; b.setAttribute('aria-pressed', String(a.id === selected));
    if (image(a)) { const img = document.createElement('img'); img.src = artifact(image(a)); img.alt = ''; b.prepend(img); }
    return b;
  }));
}
function render() {
  const projectNav = $('projects'), previousScroll = projectNav.scrollLeft;
  const p = project(), focusedId = document.activeElement?.id;
  const signature = JSON.stringify([projects, projectId, stage, stagePinned, conceptId, viewId, versionId, status]);
  if (signature === lastState) return;
  $('projects').replaceChildren(...projects.map(item => { const b = button(item.name, () => {
    projectId = item.id; conceptId = viewId = versionId = null; stagePinned = false;
    localStorage.setItem('gen3d-project', item.id);
    for (const f of document.querySelectorAll('#workspace form')) { f.reset(); delete f.dataset.dirty; }
    lastState = ''; render();
  }); b.id = `project-${item.id}`; b.classList.toggle('selected', item.id === projectId); b.setAttribute('aria-current', item.id === projectId ? 'true' : 'false'); return b; }));
  $('empty').hidden = !!p; $('workspace').hidden = !p;
  if (!p) { $('title').textContent = 'Your next idea'; $('project-state').textContent = 'Welcome'; $('download').hidden = $('blend-download').hidden = true; showModel(null); lastState = signature; return; }
  projectNav.scrollLeft = previousScroll;
  if (projectNav.dataset.selected !== p.id) {
    const selected = projectNav.querySelector('.selected');
    if (projectNav.scrollWidth > projectNav.clientWidth && selected) projectNav.scrollLeft += selected.getBoundingClientRect().left - projectNav.getBoundingClientRect().left;
    projectNav.dataset.selected = p.id;
  }
  const state = studioState(p);
  if (!stagePinned) stage = state.next.stage;
  if (p.mode === 'image' && ['concept', 'views'].includes(stage)) stage = 'input';
  $('title').textContent = p.name;
  const c = p.concepts.find(c => c.id === conceptId) || p.concepts.at(-1);
  const set = p.referenceSets.find(s => s.id === viewId) || p.referenceSets.at(-1);
  const v = p.versions.find(v => v.id === versionId) || p.versions.at(-1);
  const projectBusy = !!state.running, busy = status.busy || projectBusy;
  const { pendingInput, pendingConcept, pendingViews, pendingModel: pendingPreview, pendingReference: pendingRefs } = state;
  const blocked = busy || pendingRefs || pendingInput || pendingConcept || pendingViews || pendingPreview || status.usageLimited;
  $('project-state').textContent = status.usageLimited ? 'Codex usage limit' : state.running ? `${stageNames[state.running]} running` : state.next.start ? 'Ready to create' : state.next.label;
  const keys = p.mode === 'image' ? ['input', 'model'] : ['input', 'concept', 'views', 'model'];
  $('stages').classList.toggle('reduced', p.mode === 'image');
  $('stages').replaceChildren(...keys.map((key, index) => {
    const b = button('', () => chooseStage(key)); b.classList.toggle('selected', stage === key); b.id = `nav-${key}`; b.dataset.state = state.states[key]; b.setAttribute('aria-current', stage === key ? 'step' : 'false');
    const n = document.createElement('span'); n.className = 'stage-number'; n.textContent = state.states[key] === 'Completed' ? '✓' : index + 1;
    const text = document.createElement('span'), label = document.createElement('span'), statusLabel = document.createElement('span');
    label.className = 'stage-label'; label.textContent = stageNames[key]; statusLabel.className = 'stage-status'; statusLabel.textContent = state.states[key]; text.append(label, statusLabel); b.append(n, text); return b;
  }));
  for (const key of Object.keys(stageNames)) $('stage-' + key).hidden = key !== stage;
  $('next-description').textContent = status.usageLimited ? 'Codex usage limit reached. Generation is paused; your saved artifacts remain available.' : state.next.message;
  $('next-action').textContent = state.next.label; $('next-action').disabled = !!blocked && state.next.start;
  $('next-action').onclick = () => {
    if (state.next.start) return safe(() => generate('generate'));
    if (state.next.id) { if (state.next.stage === 'concept') conceptId = state.next.id; if (state.next.stage === 'views') viewId = state.next.id; if (state.next.stage === 'model') versionId = state.next.id; }
    chooseStage(state.next.stage); $('stage-' + stage).querySelector('button:not(:disabled), input, textarea, select')?.focus();
  };
  for (const id of ['generate', 'retry']) $(id).disabled = !!blocked;
  for (const id of ['approve', 'reject']) $(id).disabled = projectBusy || v?.status !== 'ready';
  $('revise').querySelector('button').disabled = !!blocked || v?.status !== 'ready';
  $('concept-retry').querySelector('button').disabled = !!(busy || pendingInput || pendingPreview || pendingRefs || status.usageLimited);
  $('views-retry').querySelector('button').disabled = !!(busy || pendingInput || pendingConcept || pendingPreview || pendingRefs || status.usageLimited || !p.selectedConceptId && !p.referenceSets.some(s => revisionReferenceSet(p, s)));
  for (const id of ['edit', 'checkpoints', 'consistency', 'reference']) $(id).querySelector('button').disabled = projectBusy;
  for (const key of ['name', 'prompt', 'profile']) { if (!$('edit').dataset.dirty) $('edit').elements[key].value = p[key]; }
  $('edit').elements.prompt.required = p.mode === 'text'; $('edit').elements.profile.closest('label').hidden = p.mode !== 'text';
  $('input-kind').textContent = p.mode === 'text' ? 'Text → concept → views → model' : 'Image → model';
  for (const key of ['input', 'concept', 'multiView', 'preview']) if (!$('checkpoints').dataset.dirty) $('checkpoints').elements[key].checked = p.checkpoints[key];
  for (const cls of ['concept-setting', 'view-setting']) $('checkpoints').querySelector('.' + cls).hidden = p.mode !== 'text';
  $('consistency').hidden = p.mode !== 'text';
  for (const key of ['enabled', 'onFailure']) if (!$('consistency').dataset.dirty) $('consistency').elements[key].value = String(p.consistencySettings[key]);
  syncConsistency($('consistency'));
  $('input-review-state').textContent = `Input review: ${p.inputReview}${pendingInput ? ' · Explicit approval required.' : ''}`;
  $('input-review').replaceChildren(...(p.checkpoints.input || p.inputCheckpoint || p.inputReview === 'rejected' ? ['approved', 'rejected'].map(decision => button(decision === 'approved' ? 'Accept input' : 'Reject input', () => api(`/projects/${p.id}/input/review`, 'POST', { decision }), projectBusy)) : []));
  $('input-image').replaceChildren(...(p.inputImage ? [figure(p.inputImage, 'Original image input')] : []));
  selectOptions('concept-selection', p.concepts, c?.id, c => `Concept ${c.number} · ${c.status} · ${c.review}`);
  $('concepts').replaceChildren(c?.artifacts.image ? figure(c.artifacts.image, `Concept ${c.number} · ${c.review}`) : placeholder(c?.error || (c?.status === 'running' ? 'Generating your base concept…' : 'Start the workflow to create a base concept.')));
  const conceptModels = p.versions.filter(v => v.conceptId === c?.id).map(v => `v${v.number}`).join(', ');
  $('concept-info').textContent = describe(c, 'Concept') + (conceptModels ? ` · Used by ${conceptModels}` : '') + (c && !currentConcept(p, c) ? ' · Earlier input; retained for browsing.' : '');
  $('concept-info').classList.toggle('error', c?.status === 'failed');
  $('concept-review').replaceChildren(...(c?.status === 'ready' ? ['approved', 'rejected'].map(decision => button(decision === 'approved' ? 'Accept concept & generate views' : 'Reject concept', async () => {
    await api(`/projects/${p.id}/concepts/${c.id}/review`, 'POST', { decision }); if (decision === 'approved') followWorkflow();
  }, !!(busy || pendingInput || decision === 'approved' && (pendingViews || status.usageLimited) || pendingPreview || !currentConcept(p, c)))) : []));
  thumbnails('concept-thumbnails', p.concepts, c?.id, a => a.artifacts.image, a => `Concept ${a.number} · ${a.review}`, id => { conceptId = id; lastState = ''; render(); });
  selectOptions('view-selection', p.referenceSets, set?.id, s => `Set ${s.number} · ${s.status} · ${s.review}`);
  const setNode = document.createElement('section');
  if (set) {
    const grid = document.createElement('div'); grid.className = 'image-grid';
    const base = p.concepts.find(c => c.id === set.conceptId);
    if (base?.artifacts.image) { const f = figure(base.artifacts.image, `Base · concept ${base.number}`); f.className = 'base-view'; grid.append(f); }
    grid.append(...set.images.map(image => figure(image.file, image.label))); setNode.append(grid);
    if (!set.images.length) setNode.append(placeholder(set.status === 'running' ? 'Generating modeling views…' : 'No view images were saved for this attempt.'));
    const inspection = document.createElement('p'); inspection.className = 'muted';
    const settings = set.consistencySettings || { enabled: true, onFailure: 'stop' };
    inspection.textContent = `Consistency: ${set.consistency.status} · ${set.consistency.outcome || (consistencyAllowsModeling(set) ? 'allowed' : 'blocked')} · Check ${settings.enabled ? 'On' : 'Off'}${settings.enabled ? ` · ${settings.onFailure === 'continue' ? 'Warn and continue' : 'Stop'}` : ''}`;
    setNode.append(inspection);
    if (set.warning) { const warning = document.createElement('p'); warning.className = 'warning'; warning.setAttribute('role', 'status'); warning.textContent = set.warning; setNode.append(warning); }
    const report = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Consistency issues & report'; report.append(summary);
    for (const issue of set.consistency.issues || []) { const line = document.createElement('p'); line.textContent = issue; report.append(line); }
    if (set.consistency.error) { const line = document.createElement('p'); line.textContent = set.consistency.error; report.append(line); }
    if (set.consistency.reason) { const line = document.createElement('p'); line.textContent = set.consistency.reason; report.append(line); }
    if (set.artifacts['consistency.json']) { const link = document.createElement('a'); link.href = artifact(set.artifacts['consistency.json']); link.textContent = 'Open consistency report'; link.target = '_blank'; link.rel = 'noopener'; report.append(link); }
    setNode.append(report);
  } else setNode.append(placeholder('Accept a base concept to create front, side, back and three-quarter views.'));
  $('reference-sets').replaceChildren(setNode);
  const models = p.versions.filter(v => v.referenceSetId === set?.id).map(v => `v${v.number}`).join(', ');
  $('view-info').textContent = describe(set, 'View set') + (set ? ` · concept ${p.concepts.find(c => c.id === set.conceptId)?.number ?? '?'}${models ? ` · Used by ${models}` : ''}${set.request?.kind === 'revision' ? ` · revision of v${p.versions.find(v => v.id === set.request.sourceVersionId)?.number}` : ''}` : '');
  $('view-info').classList.toggle('error', set?.status === 'failed' || set?.consistency.outcome === 'blocked');
  $('view-review').replaceChildren(...(set?.status === 'ready' ? ['approved', 'rejected'].map(decision => button(decision === 'approved' ? 'Accept views & model' : 'Reject view set', async () => {
    await api(`/projects/${p.id}/reference-sets/${set.id}/review`, 'POST', { decision }); if (decision === 'approved') followWorkflow();
  }, !!(busy || pendingInput || pendingConcept || pendingPreview || (set.conceptId !== p.selectedConceptId && !revisionReferenceSet(p, set)) || (decision === 'approved' && (!consistencyAllowsModeling(set) || status.usageLimited))))) : []));
  thumbnails('view-thumbnails', p.referenceSets, set?.id, a => a.images[0]?.file, a => `Set ${a.number} · ${a.consistency.status}`, id => { viewId = id; lastState = ''; render(); });
  const regenerableSets = p.referenceSets.filter(s => (s.conceptId === p.selectedConceptId && s.prompt === p.prompt && s.profile === p.profile) || revisionReferenceSet(p, s)).reverse();
  const target = $('views-retry').elements.referenceSetId, previous = target.value;
  target.replaceChildren(...regenerableSets.map(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = `Set ${s.number} · concept ${p.concepts.find(c => c.id === s.conceptId)?.number}`; return o; }));
  if (!regenerableSets.length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'Selected base concept'; target.append(o); }
  if (!$('views-retry').dataset.dirty && regenerableSets.some(s => s.id === set?.id)) target.value = set.id;
  else if (regenerableSets.some(s => s.id === previous)) target.value = previous;
  $('reference-count').textContent = `(${p.references.length})`;
  $('references').replaceChildren(...p.references.map(r => {
    const node = figure(r.file, `${r.label} · ${r.review}`), actions = document.createElement('div'); actions.className = 'actions';
    for (const decision of ['approved', 'rejected']) actions.append(button(decision === 'approved' ? 'Approve reference' : 'Reject reference', () => api(`/projects/${p.id}/references/${r.id}/review`, 'POST', { decision }), projectBusy));
    node.append(actions); return node;
  }));
  $('reference-state').textContent = pendingRefs ? 'Review each pending reference before modeling. Rejected images will not be used.' : 'Only approved supplementary references are used alongside required design images.';
  if (pendingRefs && stage === 'input') $('references').closest('details').open = true;
  selectOptions('versions', p.versions, v?.id, v => `v${v.number} · ${v.kind} · ${v.status}`);
  $('version-info').textContent = describe(v, 'Version') + (v ? ` · ${v.kind}${v.sourceVersionId ? ` · revision of v${p.versions.find(source => source.id === v.sourceVersionId)?.number ?? '?'}` : ''}` : '') + (v?.continuedDespiteInconsistency ? ' · WARNING: modeling continued despite failed consistency inspection' : v?.consistency?.status === 'skipped' ? ' · Consistency inspection skipped' : '');
  $('version-info').classList.toggle('error', v?.status === 'failed');
  $('model-summary').textContent = v?.summary || 'No modeling summary yet.';
  const sourceConcept = p.concepts.find(c => c.id === v?.conceptId), sourceSet = p.referenceSets.find(s => s.id === v?.referenceSetId);
  $('model-sources').replaceChildren(...[
    ...(sourceConcept ? [button(`Source concept ${sourceConcept.number}`, () => { conceptId = sourceConcept.id; chooseStage('concept'); })] : []),
    ...(sourceSet ? [button(`Source view set ${sourceSet.number}`, () => { viewId = sourceSet.id; chooseStage('views'); })] : []),
    ...(v && p.mode === 'image' ? [button('Source input image', () => chooseStage('input'))] : [])
  ]);
  for (const [id, key] of [['download', 'glb'], ['blend-download', 'blend']]) {
    $(id).hidden = stage !== 'model' || v?.status !== 'ready' || !v?.artifacts[key] || (v.checkpoints?.preview && v.review !== 'approved');
    if (v?.artifacts[key]) { $(id).href = artifact(v.artifacts[key]) + '?download=1'; $(id).download = key === 'glb' ? 'model.glb' : 'scene.blend'; }
  }
  const renderKey = v?.artifacts?.render || '', renderSignature = `${p.id}/${v?.id}/${renderKey}`;
  if ($('render-image').dataset.file !== renderSignature) { $('render-image').dataset.file = renderSignature; $('render-image').replaceChildren(renderKey ? figure(renderKey, `Rendered view · v${v.number}`) : placeholder('A completed model will include a rendered preview.')); }
  $('history-count').textContent = `(${p.activity.length})`;
  $('history').replaceChildren(...p.activity.slice().reverse().map(e => {
    const li = document.createElement('li'), n = p.versions.find(v => v.id === e.versionId)?.number, c = p.concepts.find(c => c.id === e.conceptId)?.number, set = p.referenceSets.find(s => s.id === e.referenceSetId)?.number;
    li.textContent = `${new Date(e.at).toLocaleString()} · ${e.actor} · ${e.type.replaceAll('_', ' ')}${n ? ` · v${n}` : ''}${c ? ` · concept ${c}` : ''}${set ? ` · view set ${set}` : ''}${e.decision ? ` · ${e.decision}` : ''}${e.message ? ` · ${e.message}` : ''}`; return li;
  }));
  showModel(v); if (focusedId && document.activeElement === document.body) $(focusedId)?.focus({ preventScroll: true }); lastState = JSON.stringify([projects, projectId, stage, stagePinned, conceptId, viewId, versionId, status]);
}
function followWorkflow() { conceptId = viewId = versionId = null; stagePinned = false; }
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { [projects, status] = await Promise.all([api('/projects'), api('/status')]); $('connection').textContent = status.busy ? 'Codex → Blender' : 'Local server connected'; render(); }
  catch (e) { $('connection').textContent = 'Local server disconnected · retrying'; throw e; }
  finally { refreshing = false; }
}
function form(id, action) { $(id).oninput = () => { $(id).dataset.dirty = 'true'; }; $(id).onsubmit = event => { event.preventDefault(); safe(async () => { await action(new FormData(event.target)); delete $(id).dataset.dirty; lastState = ''; }); }; }
const create = $('create');
create.elements.mode.onchange = () => { const image = create.elements.mode.value === 'image'; $('image-label').hidden = !image; create.elements.image.required = image; create.elements.prompt.required = !image; for (const cls of ['concept-setting', 'view-setting', 'profile-setting', 'consistency-settings']) create.querySelector('.' + cls).hidden = image; syncConsistency(create); };
form('create', async data => {
  const mode = data.get('mode'), p = await api('/projects', 'POST', { name: data.get('name'), mode, ...(data.get('profile') !== 'auto' ? { profile: data.get('profile') } : {}), prompt: data.get('prompt'), checkpoints: checkpointData(data), consistencySettings: consistencyData(data, create), ...(mode === 'image' ? { image: await fileImage(data.get('image')) } : {}) });
  projectId = p.id; localStorage.setItem('gen3d-project', p.id); conceptId = viewId = versionId = null; stagePinned = false; lastState = ''; $('create-dialog').close(); create.reset();
  for (const f of document.querySelectorAll('#workspace form')) { f.reset(); delete f.dataset.dirty; } create.elements.mode.onchange();
});
function syncConsistency(form) { form.elements.onFailure.disabled = form.elements.enabled.value === 'false'; }
function consistencyData(data, form) { return { enabled: data.get('enabled') === 'true', onFailure: form.elements.onFailure.value }; }
for (const form of [create, $('consistency')]) form.elements.enabled.onchange = () => syncConsistency(form);
form('consistency', data => api(`/projects/${projectId}`, 'PATCH', { consistencySettings: consistencyData(data, $('consistency')) }));
function checkpointData(data) { return Object.fromEntries(['input', 'concept', 'multiView', 'preview'].map(key => [key, data.has(key)])); }
form('checkpoints', data => api(`/projects/${projectId}`, 'PATCH', { checkpoints: checkpointData(data) }));
form('concept-retry', async data => { await api(`/projects/${projectId}/concepts`, 'POST', { feedback: data.get('feedback') }); followWorkflow(); });
form('views-retry', async data => { await api(`/projects/${projectId}/reference-sets`, 'POST', { ...(data.get('referenceSetId') ? { referenceSetId: data.get('referenceSetId') } : {}), feedback: data.get('feedback') }); followWorkflow(); });
form('edit', data => api(`/projects/${projectId}`, 'PATCH', { name: data.get('name'), prompt: data.get('prompt'), profile: data.get('profile') }));
form('reference', async data => { await api(`/projects/${projectId}/references`, 'POST', { label: data.get('label'), image: await fileImage(data.get('image')) }); $('reference').reset(); });
async function generate(kind, feedback) {
  const sourceVersionId = versionId || project()?.versions.at(-1)?.id;
  await api(`/projects/${projectId}/generate`, 'POST', { kind, ...(kind === 'revision' ? { sourceVersionId, feedback } : {}) });
  followWorkflow();
}
form('revise', async data => { await generate('revision', data.get('feedback')); $('revise').reset(); });
$('generate').onclick = () => safe(() => generate('generate'));
$('retry').onclick = () => safe(() => generate('retry'));
for (const [id, decision] of [['approve', 'approved'], ['reject', 'rejected']]) $(id).onclick = () => safe(() => api(`/projects/${projectId}/versions/${versionId || project()?.versions.at(-1)?.id}/review`, 'POST', { decision }));
$('versions').onchange = () => { versionId = $('versions').value; stagePinned = true; lastState = ''; render(); };
$('concept-selection').onchange = () => { conceptId = $('concept-selection').value; lastState = ''; render(); };
$('view-selection').onchange = () => { viewId = $('view-selection').value; lastState = ''; render(); };
for (const id of ['new-project', 'empty-create']) $(id).onclick = () => $('create-dialog').showModal();
$('close-create').onclick = () => $('create-dialog').close();
for (const [buttonId, detailsId] of [['show-settings', 'advanced'], ['show-history', 'activity-details']]) $(buttonId).onclick = () => {
  const details = $(detailsId); details.open = true; details.scrollIntoView({ block: 'start' }); details.querySelector('summary').focus({ preventScroll: true });
};
$('fit').onclick = fit;
await safe(refresh);
setInterval(() => refresh().catch(() => {}), 1500);
