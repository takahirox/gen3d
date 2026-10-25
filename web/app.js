import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setupLibrary } from './library.js';
import { partPicker } from './parts.js';
const $ = id => document.getElementById(id);
let projects = [], projectId = localStorage.getItem('gen3d-project'), versionId, runId, historyCheckpointId, selectedNode = 'input';
let area = location.hash.slice(1) || 'home', catalog = {}, presets = [], draft, draftProject, dirty = false, status = {}, lastSignature = '', preparationSaving = false;
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
function focusAdd() { $('add-image').focus(); }
function notify(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
async function api(route, method = 'GET', input) {
  const response = await fetch('/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: input ? JSON.stringify(input) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
function project() { return projects.find(p => p.id === projectId); }
const route = () => '/projects/' + projectId;
const artifact = file => `/api/projects/${projectId}/artifacts/${file.split('/').map(encodeURIComponent).join('/')}`;
async function safe(action) { try { notify(); await action(); await refresh(); } catch (e) { notify(e.message); } }
function button(text, action, disabled = false) { const b = node('button', text); b.type = 'button'; b.disabled = disabled; b.onclick = () => safe(action); return b; }
function link(text, file, download = false) { const a = node('a', text, 'button'); a.href = artifact(file) + (download ? '?download=1' : ''); a.target = '_blank'; a.rel = 'noopener'; return a; }
function figure(file, caption) { const f = node('figure'), a = node('a'), img = node('img'); a.href = artifact(file); a.target = '_blank'; a.rel = 'noopener'; img.src = a.href; img.alt = caption; img.loading = 'lazy'; a.append(img); f.append(a, node('figcaption', caption)); return f; }
function options(select, items, value) { select.replaceChildren(...items.map(([id, text]) => { const o = node('option', text); o.value = id; return o; })); if (items.some(i => i[0] === value)) select.value = value; }
const viewPolicy = settings => !settings.enabled ? 'off' : settings.onFailure;
const policyName = settings => ({ off: 'Off', continue: 'Warn and continue', stop: 'Stop on issues' })[viewPolicy(settings)];
// Off changes only enabled, preserving the prior response for explicit callers.
const policySettings = value => value === 'off' ? { enabled: false } : { enabled: true, onFailure: value };
function form(id, action) { $(id).oninput = () => { $(id).dataset.dirty = 'true'; }; $(id).onsubmit = event => { event.preventDefault(); safe(async () => { await action(new FormData(event.target)); delete $(id).dataset.dirty; lastSignature = ''; }); }; }
async function imageData(file) {
  if (!file || file.size > 10_000_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image, at most 10 MB');
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
}

// The model viewer is shared by every candidate and workflow preset.
let renderer, controls, model, loaded = '', loadToken = 0;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#1c2532');
const camera = new THREE.PerspectiveCamera(45, 1, .01, 1000); camera.position.set(4, 3, 5);
scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.8));
for (const [x,y,z,power] of [[5,8,5,3],[-5,3,-5,2]]) { const light = new THREE.DirectionalLight(0xffffff, power); light.position.set(x,y,z); scene.add(light); }
try {
  renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; $('viewer').prepend(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.listenToKeyEvents($('viewer'));
  new ResizeObserver(() => { const { clientWidth: w, clientHeight: h } = $('viewer'); if (!w || !h) return; renderer.setSize(w,h,false); camera.aspect = w/h; camera.updateProjectionMatrix(); }).observe($('viewer'));
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene,camera); });
} catch { $('viewer-message').textContent = 'WebGL is unavailable. Open source / render comparison to inspect your candidate.'; }
function dispose(o) { o?.traverse(x => { x.geometry?.dispose(); for (const m of Array.isArray(x.material) ? x.material : [x.material]) { if (!m) continue; for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); } }); }
function fit() {
  if (!model || !controls) return;
  const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3()), radius = Math.max(bounds.getSize(new THREE.Vector3()).length()/2,.1);
  camera.position.copy(center).add(new THREE.Vector3(1.4,1,1.8).normalize().multiplyScalar(radius/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*Math.max(1,1/camera.aspect)*1.2));
  camera.near=radius/1000; camera.far=radius*1000; camera.updateProjectionMatrix(); controls.target.copy(center); controls.maxDistance=radius*100; controls.minDistance=radius/20; controls.update();
}
async function showModel(v) {
  const file = v?.status === 'ready' ? artifact(v.artifacts.glb) : ''; if (file === loaded) return; loaded = file; const token = ++loadToken;
  if (model) { scene.remove(model); dispose(model); model = null; }
  $('viewer-message').hidden = false; $('viewer-message').textContent = file ? 'Loading model…' : '◇'; $('viewer-message').toggleAttribute('data-message', !!file);
  if (!file || !renderer) return;
  try { const gltf = await new GLTFLoader().loadAsync(file); if (token !== loadToken) { dispose(gltf.scene); return; } model = gltf.scene; scene.add(model); fit(); $('viewer-message').hidden = true; }
  catch { if (token === loadToken) $('viewer-message').textContent = 'Could not load the 3D preview. Inspect source / render comparison and saved artifacts.'; }
}
function navigate(next) { area = ['studio','workflow'].includes(next) ? next : 'home'; location.hash = area; lastSignature = ''; render(); window.scrollTo({ top: 0 }); }
function chooseProject(id) { projectId = id; versionId = runId = historyCheckpointId = undefined; draftProject = null; localStorage.setItem('gen3d-project', id); for (const f of document.querySelectorAll('form')) delete f.dataset.dirty; navigate('studio'); }
function clearProject() {
  projectId = null; versionId = runId = historyCheckpointId = undefined; draftProject = null; dirty = false;
  localStorage.removeItem('gen3d-project');
  for (const f of document.querySelectorAll('form')) delete f.dataset.dirty;
  showModel(); navigate('home');
}
let deletingProject, deleteFocusId, deletePending = false;
function confirmDelete(p) {
  deletingProject = p.id; deleteFocusId = 'project-actions-' + p.id;
  $('delete-project-name').textContent = p.name;
  $('delete-error').hidden = true;
  $('delete-dialog').showModal(); $('cancel-delete').focus();
}
function projectCard(p) {
  const card = node('article', undefined, 'project-card'), open = button('', () => chooseProject(p.id));
  open.className = 'project-open';
  const v = p.versions.find(v => v.id === p.acceptedVersionId) || p.versions.at(-1);
  if (v?.artifacts.render || p.inputImage) { const img = node('img'); img.src = `/api/projects/${p.id}/artifacts/${v?.artifacts.render || p.inputImage}`; img.alt = ''; img.loading = 'lazy'; open.append(img); }
  open.append(node('h2', p.name));
  const menu = node('details', undefined, 'project-menu'), trigger = node('summary', '⋯');
  trigger.id = 'project-actions-' + p.id; trigger.setAttribute('aria-label', 'Actions for ' + p.name);
  const remove = node('button', 'Delete', 'danger'); remove.type = 'button';
  remove.id = 'delete-project-' + p.id;
  remove.onclick = () => { menu.open = false; confirmDelete(p); };
  menu.onkeydown = event => { if (event.key === 'Escape') { menu.open = false; trigger.focus(); event.stopPropagation(); } };
  menu.append(trigger, remove); card.append(open, menu); return card;
}
function selectedRun(p) { return p.workflowRuns.find(r => r.id === runId) || p.workflowRuns.at(-1); }
function selectedVersion(p) { return p.versions.find(v => v.id === versionId) || p.versions.at(-1); }
function candidateCheckpoint(r, v) {
  return r?.checkpoints.find(cp => cp.type === 'model' && cp.data.versionId === v?.id)
    || r?.checkpoints.find(cp => cp.type === 'model' && cp.data.versionId === v?.sourceVersionId);
}
function markDirty() { dirty = true; $('graph-warning').textContent = 'Unsaved graph changes. Edited nodes and dependent outputs will recompute; earlier checkpoints stay intact.'; $('graph-json').value = JSON.stringify(draft,null,2); }
async function saveGraph() { await api(route() + '/workflow','PUT',{ graph: draft }); dirty = false; }
async function run(input = {}) { if (dirty) await saveGraph(); await api(route() + '/runs','POST', input); runId = versionId = historyCheckpointId = undefined; }
function renderFiles(files, compact = false) {
  const wrap = node('div'), grid = node('div', undefined, 'artifact-grid');
  for (const f of files) {
    const file = typeof f === 'string' ? f : f.file;
    if (/\.(png|jpg|webp)$/.test(file)) grid.append(figure(file, file.split('/').at(-1)));
    else { const p = node('p'); p.append(link(file.split('/').at(-1), file)); if (!compact && f.sha256) p.append(node('small',' SHA-256: ' + f.sha256)); wrap.append(p); }
  }
  if (grid.children.length) wrap.prepend(grid); return wrap;
}
function checkpointCard(p, r, cp, compact = false) {
  const card = node('article', undefined, 'checkpoint'); card.append(node('strong', `${cp.nodeId} · ${cp.type}`), node('p', `${r.nodes[cp.nodeId]?.status} · graph revision ${cp.graphRevision}${r.nodes[cp.nodeId]?.reusedFrom ? ' · reused checkpoint' : ''}`, 'muted'));
  card.append(renderFiles(cp.files, compact));
  const actions = node('div', undefined, 'actions');
  actions.append(button('Inspect node', () => { selectedNode = cp.nodeId; runId = r.id; navigate('workflow'); }), button('Branch from here', () => run({ runId: r.id, checkpointId: cp.id }), status.busy || r.nodes[cp.nodeId]?.status !== 'completed'));
  card.append(actions);
  if (!compact) { const details = node('details'); details.append(node('summary','Inputs, settings & source identities'), node('pre', JSON.stringify({ fingerprint:cp.fingerprint, dependencyIds:cp.dependencyIds, settings:cp.settings, configuration:cp.configuration, sourceIdentities:cp.sourceIdentities },null,2))); card.append(details); }
  return card;
}
function renderReviews(p) {
  const pending = node('div');
  for (const r of p.workflowRuns.filter(r => r.status === 'waiting-review')) for (const [id,s] of Object.entries(r.nodes).filter(([,s]) => s.status === 'waiting-review')) {
    const cp = r.checkpoints.find(c => c.id === s.checkpointId), card = node('div', undefined, 'checkpoint'); card.append(node('h3', `Human review: ${id === 'review' ? 'model' : id === 'views' ? 'four views' : id}`), renderFiles(cp.files,true));
    if (cp.type === 'design') card.append(node('p', cp.data.prompt));
    const a = node('div',undefined,'actions');
    for (const [label,decision] of [['Accept & continue','approved'],['Reject','rejected']]) a.append(button(label, () => api(`${route()}/runs/${r.id}/nodes/${id}/review`, 'POST',{ decision }),status.busy));
    card.append(a); pending.append(card);
  }
  // Lower-level MCP operations use the same human artifact review surface.
  for (const c of p.concepts.filter(c => c.prompt === p.prompt && c.profile === p.profile && c.status === 'ready' && c.review === 'pending')) {
    const card = node('div', undefined, 'checkpoint'); card.append(node('h3', 'Human review: concept'), renderFiles(Object.values(c.artifacts), true));
    for (const [label, decision] of [['Accept & continue', 'approved'], ['Reject', 'rejected']]) card.append(button(label, () => api(`${route()}/concepts/${c.id}/review`, 'POST', { decision }), status.busy));
    pending.append(card);
  }
  for (const s of p.referenceSets.filter(s => s.conceptId === p.selectedConceptId && s.prompt === p.prompt && s.profile === p.profile && s.status === 'ready' && s.review === 'pending')) {
    const card = node('div', undefined, 'checkpoint'); card.append(node('h3', 'Human review: four views'), node('p', `${s.consistency?.status}: ${(s.consistency?.issues || []).join('; ')}`), renderFiles(s.images.map(i => i.file), true));
    for (const [label, decision] of [['Accept & continue', 'approved'], ['Reject', 'rejected']]) card.append(button(label, () => api(`${route()}/reference-sets/${s.id}/review`, 'POST', { decision }), status.busy));
    pending.append(card);
  }
  $('pending-reviews').replaceChildren(pending);
}
function renderStudio(p) {
  const v = selectedVersion(p), r = selectedRun(p);
  options($('versions'), p.versions.length ? p.versions.map(v => [v.id, `#${v.number} · ${v.status} · ${v.review}${v.id === p.acceptedVersionId ? ' · accepted' : ''}`]) : [['','No candidates yet']], v?.id);
  options($('studio-run'), p.workflowRuns.length ? p.workflowRuns.map(r => [r.id, `${r.createdAt.slice(0,19)} · ${r.status}${r.parentRunId ? ' · branch' : ''}`]) : [['','No saved runs']], r?.id);
  showModel(v);
  $('result-details').hidden = !v;
  $('candidate-info').textContent = v ? `Candidate #${v.number}: ${v.review}. ${v.error || v.summary || ''}${v.preservation ? ' Complete scene and GLB preservation verified.' : ''}` : '';
  $('studio-preset').textContent = p.workflow.name;
  $('primary-source').replaceChildren(...(p.inputImage ? [figure(p.inputImage, 'Input image')] : []));
  $('source-image').replaceChildren(...(v?.visualInput || p.inputImage ? [figure(v?.visualInput || p.inputImage,'Original design input')] : []));
  $('render-image').replaceChildren(...(v?.artifacts.render ? [figure(v.artifacts.render,'Candidate render')] : []));
  const actions = $('candidate-actions'), historyActions = $('history-actions'); actions.replaceChildren(); historyActions.replaceChildren();
  const candidateRun = p.workflowRuns.find(r => r.id === v?.workflowRunId);
  const checkpoint = candidateCheckpoint(candidateRun, v);
  const blocked = status.busy || status.usageLimited || p.workflowRuns.some(r => r.status === 'waiting-review');
  if (v?.status === 'ready' && (v.workflowReviewed || !v.workflowRunId) && !blocked) {
    if (checkpoint && p.workflow.nodes.some(n => n.type === 'refine')) actions.append(button('Refine', () => $('refine-dialog').showModal()));
    let modeling = candidateRun?.graph.nodes.find(n => n.id === checkpoint?.nodeId);
    while (modeling && !['model','edit'].includes(modeling.type)) {
      const parent = candidateRun.graph.edges.find(e => e.to === modeling.id && e.input === 'model');
      modeling = candidateRun.graph.nodes.find(n => n.id === parent?.from);
    }
    const upstream = candidateRun?.graph.edges.find(e => e.to === modeling?.id && e.input === 'views');
    const retryCheckpoint = candidateRun?.checkpoints.find(cp => cp.nodeId === upstream?.from);
    if (retryCheckpoint) actions.append(button('Retry', () => run({runId:candidateRun.id,checkpointId:retryCheckpoint.id})));
    actions.append(button('Accept', () => api(`${route()}/versions/${v.id}/review`, 'POST', {decision:'approved'})));
  }
  $('exports').replaceChildren(...(v?.status === 'ready' && v.review === 'approved' && (v.workflowReviewed || !v.workflowRunId) ? [link('Download GLB',v.artifacts.glb,true),link('Blender scene',v.artifacts.blend,true)] : []));
  $('result-actions').replaceChildren(...(v?.status === 'ready' && (v.workflowReviewed || !v.workflowRunId) ? [button('Reject candidate', () => api(`${route()}/versions/${v.id}/review`,'POST',{decision:'rejected'}),blocked)] : []));
  const exportable = !!$('exports').querySelector('a'), editing = !!$('edit').dataset.dirty;
  $('run-workflow').classList.toggle('primary', !exportable || editing);
  $('exports').querySelector('a')?.classList.toggle('primary', !editing);
  const warningData = r?.checkpoints.find(cp => cp.type === 'checkedViews' && cp.data.consistency?.status === 'failed' && cp.data.consistency?.outcome === 'allowed')?.data
    || (!r && v?.consistency?.status === 'failed' && v.consistency.outcome === 'allowed' ? { consistency:v.consistency, images:v.modelingImages, visual:{file:v.visualInput} } : null);
  $('task-warning').hidden = !warningData;
  $('inspect-warning').onclick = () => {
    $('history-heading').textContent = 'Four-view issues';
    const report = node('p', warningData.consistency.issues.join('; ') || 'The inspection reported inconsistent views.'); report.id = 'warning-info';
    $('history-content').replaceChildren(report, renderFiles([warningData.visual.file, ...warningData.images.map(i => i.file)], true));
    $('history-dialog').showModal();
  };
  const thumbnails = [];
  function thumbnail(file, label, active, action, id) {
    const b = button('', action); b.id = id; b.className = 'history-thumb'; b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', String(active));
    if (file) { const img = node('img'); img.src = artifact(file); img.alt = ''; img.loading = 'lazy'; b.append(img); }
    else b.append(node('span', '◇', 'thumbnail-placeholder'));
    b.append(node('span', label)); return b;
  }
  for (const candidate of p.versions) thumbnails.push(thumbnail(candidate.artifacts.render, `#${candidate.number} · ${candidate.status === 'ready' ? candidate.review === 'pending' ? 'Review' : candidate.review === 'rejected' ? 'Rejected' : 'Ready' : candidate.status}`, !historyCheckpointId && candidate.id === v?.id, () => { versionId = candidate.id; runId = candidate.workflowRunId; historyCheckpointId = undefined; lastSignature = ''; render(); }, 'candidate-'+candidate.id));
  for (const cp of r?.checkpoints.filter(cp => ['visual','views'].includes(cp.type)) || []) thumbnails.push(thumbnail(cp.files.find(f => /\.(png|jpg|webp)$/.test(f.file))?.file, cp.type === 'visual' ? 'Concept' : 'Four views', cp.id === historyCheckpointId, () => { historyCheckpointId = cp.id; lastSignature = ''; render(); }, 'checkpoint-'+cp.id));
  $('visual-history').replaceChildren(...(thumbnails.length ? thumbnails : []));
  const chosen = r?.checkpoints.find(cp => cp.id === historyCheckpointId);
  if (chosen) {
    historyActions.append(button('Inspect', () => { $('history-heading').textContent = chosen.type === 'views' ? 'Four views' : 'Concept'; $('history-content').replaceChildren(renderFiles(chosen.files, true)); $('history-dialog').showModal(); }), button('Branch', () => run({ runId:r.id, checkpointId:chosen.id }), blocked || r.nodes[chosen.nodeId]?.status !== 'completed'));
  } else if (v) {
    historyActions.append(button('Compare', () => $('view-compare').click(), v.status !== 'ready'));
    if (v.review === 'approved' && p.acceptedVersionId !== v.id) historyActions.append(button('Restore', () => api(route()+'/restore','POST',{versionId:v.id}),blocked));
    if (checkpoint) historyActions.append(button('Branch', () => run({runId:candidateRun.id,checkpointId:checkpoint.id}),blocked));
    historyActions.append(button('Details', () => { runId=candidateRun?.id; selectedNode=checkpoint?.nodeId || 'review'; navigate('workflow'); }));
  }
  $('studio-checkpoints').replaceChildren(...(r ? r.checkpoints.map(cp => checkpointCard(p,r,cp,true)) : [node('p','Every completed node will appear here with its saved artifacts.')]));
  if (!r) {
    const files = [...p.concepts.flatMap(c => Object.values(c.artifacts)), ...p.referenceSets.flatMap(s => [...s.images.map(i => i.file), ...Object.values(s.artifacts)])];
    if (files.length) $('studio-checkpoints').replaceChildren(renderFiles([...new Set(files)], true));
  }
  renderReviews(p);
  const hasFourViews = p.mode === 'text' && draft.nodes.some(n => n.type === 'consistency');
  $('studio-policy-label').hidden = $('editor-policy-label').hidden = !hasFourViews;
  $('preparation-settings').querySelectorAll('input, select').forEach(e => { e.disabled = status.busy || preparationSaving; });
  if (!preparationSaving) {
    $('four-view-policy').value = viewPolicy(p.consistencySettings);
    $('studio-refinement').value = String(p.refinementSettings.enabled);
    if (document.activeElement !== $('studio-cycles')) $('studio-cycles').value = p.refinementSettings.maxIterations;
  }
  const hasRefinement = draft.nodes.some(n => n.type === 'refine');
  $('studio-refinement-label').hidden = !hasRefinement;
  $('studio-cycles-label').hidden = !hasRefinement || !p.refinementSettings.enabled;
  $('policy-overrides').replaceChildren(...(hasFourViews ? draft.nodes.filter(n => n.type === 'consistency' && Object.keys(n.settings).length).map(n => {
    const effective = { ...p.consistencySettings, ...n.settings };
    return button(`${n.id}: ${policyName(effective)} · workflow override${dirty ? ' (unsaved)' : ''}`, () => { selectedNode = n.id; navigate('workflow'); });
  }) : []));
  const captured = r?.snapshot.mode === 'text' ? r.graph.nodes.filter(n => n.type === 'consistency').filter(n => {
    const next = draft.nodes.find(d => d.id === n.id && d.type === 'consistency');
    return !next || viewPolicy({ ...r.snapshot.consistencySettings, ...n.settings }) !== viewPolicy({ ...p.consistencySettings, ...next.settings });
  }) : [];
  $('captured-policy').hidden = !captured.length;
  $('captured-policy').textContent = captured.map(n => `Saved run · ${n.id}: ${policyName({ ...r.snapshot.consistencySettings, ...n.settings })}`).join('; ');
  for (const key of ['concept','multiView']) $('settings').elements[key].closest('label').hidden = p.mode !== 'text';
  if (!$('edit').dataset.dirty) for (const key of ['name','prompt','profile']) $('edit').elements[key].value = p[key];
  if (!$('settings').dataset.dirty) {
    const f=$('settings').elements;
    for (const key of ['input','concept','multiView','preview']) f[key].checked=p.checkpoints[key];
    f.policy.value=viewPolicy(p.consistencySettings); f.refinement.value=String(p.refinementSettings.enabled); f.maxIterations.value=p.refinementSettings.maxIterations;
  }
  $('input-review').replaceChildren(...((p.checkpoints.input || p.inputCheckpoint || p.inputReview === 'rejected') && p.inputReview !== 'approved' && !p.workflowRuns.some(r => r.status === 'waiting-review') ? [button('Approve input',()=>api(route()+'/input/review','POST',{decision:'approved'}),status.busy)] : []));
  const base = p.editableBase;
  $('base-source').replaceChildren();
  if (base) {
    const card = node('div', undefined, 'source-card'), image = node('img'); image.src = `/api/library/assets/${base.assetId}/preview`; image.alt = base.name;
    const scope = button('Edit parts', async () => openBase(await api('/library/assets/'+base.assetId+'/inspect', 'POST', {}))); scope.id = 'edit-base-parts'; scope.setAttribute('aria-label', 'Edit parts of '+base.name);
    const menu=node('details'), summary=node('summary','⋯'); summary.setAttribute('aria-label','Actions for model to edit '+base.name);
    menu.append(summary,button('Change model…',()=>$('select-models').click()),button('Remove model',async()=>{await api(route()+'/editable-base','DELETE');focusAdd();},status.busy));
    card.append(image, node('strong', base.name), scope, menu); $('base-source').append(card);
  } else if (p.workflow.nodes.some(n => n.type === 'base')) $('base-source').append(button('Choose model to edit', () => $('select-models').click()));
  $('model-references').replaceChildren(...p.modelReferences.filter(r => r.review !== 'rejected').map(ref => {
    const div=node('div',undefined,'source-card'), img=node('img'); img.src=`/api/library/assets/${ref.assetId}/preview`; img.alt=ref.name; img.onerror=()=>img.remove();
    const description = node('span', ref.permission === 'reuse-edit' ? 'Geometry may be copied and changed.' : 'Appearance only; geometry is not copied.', 'sr-only');
    const menu=node('details'), summary=node('summary', '⋯'); summary.setAttribute('aria-label', 'Actions for '+ref.name); menu.append(summary);
    const change = button('Change use…', () => $('select-models').click());
    const remove = button('Remove', async () => {await api(route()+'/model-references/use','POST',{assetId:ref.assetId,use:'remove'});focusAdd();},status.busy);
    menu.append(node('p', ref.permission === 'reuse-edit' ? 'Parts may be copied and changed.' : 'Appearance only; no geometry copied.'), change, remove); div.append(img, node('strong',ref.name),description,menu);
    if (ref.review === 'pending') {
      div.append(node('p', 'Choose how to use this model.', 'warning'),button('Choose use…', () => $('select-models').click(),status.busy));
    }
    if (ref.role) menu.append(node('p',ref.role));
    return div;
  }));
  $('references').replaceChildren(...p.references.filter(ref => ref.review !== 'rejected').map(ref => {
    const div=node('div',undefined,'source-card'); div.append(figure(ref.file,ref.label));
    const remove=button('×',async()=>{await api(`${route()}/references/${ref.id}/review`,'POST',{decision:'rejected'});focusAdd();},status.busy); remove.setAttribute('aria-label','Remove image '+ref.label); div.append(remove);
    if (ref.review === 'pending') div.append(button('Use image',()=>api(`${route()}/references/${ref.id}/review`,'POST',{decision:'approved'}),status.busy));
    return div;
  }));
  $('refinement-info').textContent=v?.refinement ? `Refinement: ${v.refinement.status}. ${v.refinement.error || ''}` : 'Refinement is optional and bounded to 1–5 cycles.';
  $('refinement-review').disabled = v?.status !== 'running' || v?.refinement?.status !== 'running';
  $('refinement-cycles').replaceChildren(...(v?.refinement?.iterations || []).map(c => { const div=node('div',undefined,'checkpoint');div.append(node('h3',`Cycle ${c.number}: ${c.status}`),node('p',c.error || c.report?.summary || ''),renderFiles(Object.values(c.artifacts),true));return div; }));
}
function renderGraph(p) {
  const r = selectedRun(p);
  options($('workflow-run'), p.workflowRuns.length ? p.workflowRuns.map(r=>[r.id,`${r.createdAt.slice(0,19)} · ${r.status}`]) : [['','No runs']],r?.id);
  const positions = {}, levels = {}, counts = {};
  function level(id, seen = new Set()) {
    if (levels[id] !== undefined) return levels[id]; if (seen.has(id)) return 0; seen.add(id);
    const incoming=draft.edges.filter(e=>e.to===id && draft.nodes.some(n=>n.id===e.from));
    return levels[id]=incoming.length ? 1+Math.max(...incoming.map(e=>level(e.from,new Set(seen)))) : 0;
  }
  for (const n of draft.nodes) { const l=level(n.id); positions[n.id]={x:25+l*195,y:40+(counts[l] || 0)*130};counts[l]=(counts[l] || 0)+1; }
  const width=Math.max(600,...Object.values(positions).map(p=>p.x+185)), height=Math.max(380,...Object.values(positions).map(p=>p.y+140));
  const surface=node('div',undefined,'graph-surface'); surface.style.width=width+'px';surface.style.height=height+'px';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('aria-hidden','true');
  for (const edge of draft.edges) { const a=positions[edge.from],b=positions[edge.to];if(!a||!b)continue;const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',`M${a.x+155},${a.y+40} C${a.x+180},${a.y+40} ${b.x-25},${b.y+40} ${b.x},${b.y+40}`);svg.append(path); }
  surface.append(svg);
  for (const n of draft.nodes) {
    const state = r?.nodes[n.id], b=button('',()=>{selectedNode=n.id;renderNode(p);renderGraphSelection();});b.className='graph-node';b.id='graph-node-'+n.id;b.dataset.status=state?.status || 'draft';b.classList.toggle('selected',n.id===selectedNode);b.style.left=positions[n.id].x+'px';b.style.top=positions[n.id].y+'px';b.append(node('strong',n.id),node('small',`${n.type} → ${catalog[n.type]?.output || '?'}`),node('small',state?.status || 'draft'));surface.append(b);
  }
  const scroll=[$('graph').scrollLeft,$('graph').scrollTop];$('graph').replaceChildren(surface);$('graph').scrollLeft=scroll[0];$('graph').scrollTop=scroll[1];
  $('graph-warning').textContent=dirty?'Unsaved changes invalidate edited nodes and their descendants. Save, then branch from a valid earlier checkpoint.':'Saved graph. Nodes display the selected run’s recorded status; new settings apply to the next run.';
  if(document.activeElement!==$('graph-json'))$('graph-json').value=JSON.stringify(draft,null,2);
  renderNode(p);
}
function renderGraphSelection(){for(const b of document.querySelectorAll('.graph-node'))b.classList.toggle('selected',b.id==='graph-node-'+selectedNode);}
function renderNode(p) {
  const n=draft.nodes.find(n=>n.id===selectedNode), r=selectedRun(p), state=r?.nodes[selectedNode];
  $('node-form').hidden=!n; $('node-title').textContent=n?`${n.id} · ${n.type}`:'Choose a node';$('node-status').textContent=state?`${state.status}${state.reusedFrom?' · reused from '+state.reusedFrom:''}${state.error?' · '+state.error:''}`:'No saved execution';
  $('node-artifacts').replaceChildren();if(!n)return;
  if (!$('node-form').dataset.dirty || $('node-form').dataset.nodeId !== n.id) {
  if ($('node-form').dataset.nodeId !== n.id) delete $('node-form').dataset.dirty;
  $('node-form').dataset.nodeId = n.id;
  const settings=[];
  for(const [key,rule] of Object.entries(catalog[n.type]?.settings || {})) {
    const label=node('label',key), input=node(Array.isArray(rule)||rule==='boolean'?'select':rule==='string'?'textarea':'input'); input.name='setting:'+key;
    if(input.tagName==='SELECT'){options(input,[['','Use project/default setting'],...(Array.isArray(rule)?rule:['true','false']).map(v=>[String(v),String(v)])],n.settings[key]===undefined?'':String(n.settings[key]));}
    else {input.value=n.settings[key]??'';if(rule==='bound'){input.type='number';input.min=1;input.max=5;}else input.rows=3;}
    label.append(input);settings.push(label);
  }
  $('node-settings').replaceChildren(...settings);
  $('node-connections').replaceChildren(...Object.entries(catalog[n.type]?.inputs || {}).map(([port,type])=>{const label=node('label',`Input: ${port} (${type})`),select=node('select');select.name='port:'+port;const from=draft.edges.find(e=>e.to===n.id&&e.input===port)?.from || '';options(select,[['',type.endsWith('?')?'Unconnected (optional)':'Choose required dependency'],...draft.nodes.filter(other=>other.id!==n.id&&catalog[other.type]?.output===type.replace('?','')).map(other=>[other.id,other.id])],from);label.append(select);return label;}));
  }
  const cp=r?.checkpoints.find(c=>c.id===state?.checkpointId);
  if(cp)$('node-artifacts').append(checkpointCard(p,r,cp));else { $('node-artifacts').append(node('p','No completed checkpoint for this node. Partial/error artifacts are retained below.')); if(r) $('node-artifacts').append(renderFiles((r.artifacts || []).filter(f=>f.startsWith(`runs/${r.id}/${selectedNode}/`)),true)); }
}
function render() {
  const focusedId = document.activeElement?.id;
  const openMenuId = document.querySelector('.project-menu[open] summary')?.id;
  const p=project(), signature=JSON.stringify([projects,projectId,versionId,runId,historyCheckpointId,area,status]);if(signature===lastSignature)return;lastSignature=signature;
  document.body.dataset.area = area;
  for(const key of ['home','studio','workflow'])$('nav-'+key).setAttribute('aria-current',String(area===key));
  $('home').hidden=area!=='home';$('workspace').hidden=area==='home'||!p;$('studio').hidden=area!=='studio';$('workflow-editor').hidden=area!=='workflow';
  $('projects').replaceChildren(...projects.map(p=>{const b=button(p.name,()=>chooseProject(p.id));b.id='project-'+p.id;b.setAttribute('aria-current',String(p.id===projectId));return b;}));
  $('project-cards').replaceChildren(...projects.map(projectCard));
  if (openMenuId && $(openMenuId)) $(openMenuId).parentElement.open = true;
  $('projects-empty').hidden = projects.length > 0;
  if(!p){if(area!=='home'){$('home').hidden=false;}if(focusedId&&document.activeElement===document.body)$(focusedId)?.focus({preventScroll:true});return;}
  if(draftProject!==p.id){draft=structuredClone(p.workflow);draftProject=p.id;dirty=false;selectedNode='input';}
  else if(!dirty)draft=structuredClone(p.workflow);
  const r=p.workflowRuns.at(-1); $('title').textContent=p.name;
  const waiting = p.workflowRuns.some(r=>r.status==='waiting-review');
  const pendingSources = [...p.references,...p.modelReferences].some(ref=>ref.review==='pending');
  const missingBase = p.workflow.nodes.some(n=>n.type==='base') && (p.editableBase?.review !== 'approved');
  const pendingArtifacts = p.concepts.some(c=>c.prompt===p.prompt&&c.profile===p.profile&&c.status==='ready'&&c.review==='pending')||p.referenceSets.some(s=>s.conceptId===p.selectedConceptId&&s.prompt===p.prompt&&s.profile===p.profile&&s.status==='ready'&&s.review==='pending');
  const activeNode = r && Object.entries(r.nodes).find(([,s])=>s.status==='running')?.[0];
  const stageNames = {input:'Preparing input',concept:'Creating concept',views:'Creating four views',consistency:'Checking views',references:'Preparing sources',base:'Preparing base',model:'Generating model',edit:'Improving base',refine:'Refining model',review:'Preparing preview',output:'Validating export'};
  const runNode = r?.graph.nodes.find(n=>n.id===activeNode);
  const state = status.usageLimited ? 'Usage limit reached' : status.busy ? stageNames[runNode?.type] || 'Working…' : waiting || pendingArtifacts ? 'Review required' : pendingSources ? 'Choose source use' : missingBase ? 'Choose a model to edit' : r?.status === 'completed' ? 'Ready' : r?.status === 'failed' || r?.status === 'usage-limit' ? 'Stopped' : '';
  $('project-state').textContent=state; $('task-progress').textContent=state; $('task-progress').hidden = !state || state === 'Ready';
  $('task-error').textContent=r?.error || ''; $('task-error').hidden=!r?.error;
  $('run-workflow').textContent=status.busy ? 'Working…' : r?.status === 'failed' ? 'Retry generation' : p.workflow.nodes.some(n=>n.type==='edit') ? 'Improve' : 'Generate';
  $('run-workflow').disabled=status.busy||preparationSaving||status.usageLimited||waiting||pendingArtifacts||pendingSources||missingBase;
  $('run-editor').disabled=$('run-workflow').disabled;
  renderStudio(p);if(area==='workflow')renderGraph(p);
  $('history').replaceChildren(...p.activity.slice(-150).reverse().map(e=>node('li',`${e.at.slice(0,19)} · ${e.type}${e.nodeId?' · '+e.nodeId:''}${e.message?' · '+e.message:''}${e.decision?' · '+e.decision:''}`)));
  if (focusedId && document.activeElement === document.body) $(focusedId)?.focus({ preventScroll: true });
}
let refreshing=false, connected=true;
async function refresh(){if(refreshing)return;refreshing=true;try{[projects,status]=await Promise.all([api('/projects'),api('/status')]);if(projectId&&!project())clearProject();if(!connected){notify();lastSignature='';}connected=true;$('connection').textContent=status.busy?'Codex → Blender · running':'Local server connected';render();}finally{refreshing=false;}}
async function loadPresets(){const data=await api('/workflows');catalog=data.catalog;presets=data.presets;options($('preset'),presets.map(p=>[p.id,p.name||p.graph.name]),$('preset').value);options($('add-type'),Object.keys(catalog).map(t=>[t,t]),'refine');}
let picker, baseSelection, baseTarget, baseToken = 0;
function selectedParts() { return [...$('base-meshes').querySelectorAll('input:checked')].map(e => e.value); }
function syncParts(highlight) {
  const parts = selectedParts(); $('base-form').elements.objects.value = parts.join('\n'); picker?.select(parts, highlight);
  $('base-form').querySelector('button[type=submit]').disabled = !parts.length;
}
async function openBase(a) {
  picker?.dispose(); picker = null; const token = ++baseToken;
  baseSelection = a; baseTarget = projectId;
  $('base-info').textContent = ''; $('base-heading').textContent = 'Edit '+a.name;
  $('base-meshes').replaceChildren();
  const objects = a.inspection?.objects || [], names = objects.filter(o => o.type === 'MESH').map(o => o.name);
  $('base-objects').textContent = names.map((name,i) => `Part ${i+1}: ${name}`).join('\n');
  const authorized = project()?.editableBase, chosen = authorized?.assetId === a.id ? authorized.scope.editableObjects : [];
  for (const key of ['armature','weights','shapeKeys','uvs','materials','allowNewObjects']) $('base-form').elements[key].checked = authorized?.assetId === a.id && (key === 'allowNewObjects' ? authorized.scope.allowNewObjects : authorized.scope.allowChanges.includes(key));
  for (const [i,name] of names.entries()) {
    const label=node('label',undefined,'part-choice'), check=node('input'); check.type='checkbox'; check.value=name; check.checked=chosen.includes(name); check.setAttribute('aria-label', `Part ${i+1}: ${name}`);
    const text=node('span',`Part ${i+1}`); label.append(check,text); label.title=name;
    check.onchange=()=>syncParts(); check.onfocus=()=>picker?.select(selectedParts(),name); check.onblur=()=>picker?.select(selectedParts());
    label.onpointerenter=()=>picker?.select(selectedParts(),name); label.onpointerleave=()=>picker?.select(selectedParts());
    $('base-meshes').append(label);
  }
  $('base-form').elements.objects.oninput=()=>{const names=$('base-form').elements.objects.value.split('\n').map(n=>n.trim()).filter(Boolean);for(const input of $('base-meshes').querySelectorAll('input'))input.checked=names.includes(input.value);picker?.select(names);$('base-form').querySelector('button[type=submit]').disabled=!names.length;};
  $('base-dialog').showModal(); $('part-status').textContent='Loading parts…'; syncParts();
  try {
    picker=partPicker($('part-viewer'), name => { const input=[...$('base-meshes').querySelectorAll('input')].find(e=>e.value===name); if(input){ input.checked=!input.checked;syncParts(); } });
    const mapped=await picker.load(`/api/library/assets/${a.id}/parts`,names);
    if(token!==baseToken)return;
    $('part-status').textContent = names.some(n=>!mapped.has(n)) ? 'Some parts cannot be shown. Use Exact part names to inspect their scope.' : '';
    picker.select(chosen);
  } catch(e) { if(token===baseToken) $('part-status').textContent='Part preview unavailable. Use Exact part names to select the scope.'; }
}
$('close-base').onclick=()=>$('base-dialog').close();
$('base-dialog').addEventListener('close',()=>{if($('base-dialog').open)return;++baseToken;picker?.dispose();picker=null;delete $('base-form').dataset.dirty;$('select-models').focus();});
for(const key of ['home','studio','workflow'])$('nav-'+key).onclick=()=>navigate(key);
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
$('theme').value=localStorage.getItem('gen3d-theme')||'dark';document.documentElement.dataset.theme=$('theme').value;
$('theme').onchange=()=>{document.documentElement.dataset.theme=$('theme').value;localStorage.setItem('gen3d-theme',$('theme').value);};
for(const id of ['new-project','empty-create'])$(id).onclick=()=>$('create-dialog').showModal();$('close-create').onclick=()=>$('create-dialog').close();
$('cancel-delete').onclick = () => $('delete-dialog').close();
$('delete-dialog').addEventListener('cancel', event => { if (deletePending) event.preventDefault(); });
$('delete-dialog').addEventListener('close', () => {
  // A queued close event may arrive after the next project dialog was opened.
  if ($('delete-dialog').open) return;
  deletingProject = null; ($(deleteFocusId) || $('empty-create')).focus();
});
$('delete-dialog').onclick = event => {
  if (event.target !== $('delete-dialog') || deletePending) return;
  const box = event.target.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close();
};
$('confirm-delete').onclick = async () => {
  if (deletePending || !deletingProject) return;
  const id = deletingProject; deletePending = true;
  $('confirm-delete').disabled = $('cancel-delete').disabled = true; $('delete-error').hidden = true;
  try {
    await api('/projects/' + encodeURIComponent(id), 'DELETE');
    projects = projects.filter(p => p.id !== id);
    if (projectId === id) clearProject();
    lastSignature = ''; render(); $('delete-dialog').close();
    await refresh();
  } catch (e) { $('delete-error').textContent = e.message; $('delete-error').hidden = false; }
  finally { deletePending = false; $('confirm-delete').disabled = $('cancel-delete').disabled = false; }
};
$('create').elements.mode.onchange=()=>{const image=$('create').elements.mode.value==='image';$('image-label').hidden=!image;$('create').elements.image.required=image;};
form('create',async data=>{const mode=data.get('mode'),workflowType=data.get('workflowType');const p=await api('/projects','POST',{name:data.get('name')?.trim() || data.get('prompt').trim().slice(0,60),mode,prompt:data.get('prompt'),workflowType,profile:workflowType==='humanoid'?'character':'object',...(mode==='image'?{image:await imageData(data.get('image'))}:{})});$('create-dialog').close();$('create').reset();$('create').elements.mode.onchange();projects.push(p);chooseProject(p.id);});
form('edit',async data=>{await api(route(),'PATCH',{name:data.get('name'),prompt:data.get('prompt'),profile:data.get('profile')});await run();});
$('edit').addEventListener('input',()=>{$('run-workflow').classList.add('primary');$('exports').querySelector('a')?.classList.remove('primary');});
form('settings',data=>api(route(),'PATCH',{checkpoints:Object.fromEntries(['input','concept','multiView','preview'].map(k=>[k,data.has(k)])),consistencySettings:policySettings(data.get('policy')),refinementSettings:{enabled:data.get('refinement')==='true',maxIterations:Number(data.get('maxIterations'))}}));
$('preparation-settings').onsubmit = event => event.preventDefault();
$('preparation-settings').onchange = event => safe(async () => {
  const field = event.target;
  if (!field.reportValidity()) return;
  const patch = field.name === 'policy' ? { consistencySettings:policySettings(field.value) }
    : { refinementSettings:field.name === 'refinement' ? { enabled:field.value === 'true' } : { maxIterations:Number(field.value) } };
  preparationSaving = true;
  $('preparation-settings').querySelectorAll('input, select').forEach(e => { e.disabled = true; });
  $('run-workflow').disabled = $('run-editor').disabled = true;
  try { await api(route(), 'PATCH', patch); }
  catch (e) { lastSignature = ''; render(); throw e; }
  finally { preparationSaving = false; lastSignature = ''; await refresh(); }
});
form('reference',async data=>{const file=data.get('image'); const p=await api(route()+'/references','POST',{label:file.name,image:await imageData(file)});await api(`${route()}/references/${p.references.at(-1).id}/review`,'POST',{decision:'approved'});$('reference').reset();});
$('add-image').onclick=()=>$('reference').elements.image.click();
$('reference').elements.image.onchange=()=>{if($('reference').elements.image.files.length)$('reference').requestSubmit();};
$('base-form').onsubmit=async event=>{
  event.preventDefault(); $('base-info').textContent='';
  const data=new FormData(event.target), scope={editableObjects:data.get('objects').split('\n').map(s=>s.trim()).filter(Boolean),allowChanges:['armature','weights','shapeKeys','uvs','materials'].filter(k=>data.has(k)),allowNewObjects:data.has('allowNewObjects')};
  const submit=$('base-form').querySelector('button[type=submit]'), baseRoute='/projects/'+baseTarget; submit.disabled=true;
  try {
    if(baseTarget!==projectId)throw new Error('Project changed. Choose the model again.');
    // Convert the active draft so applied, unsaved node settings survive the switch to editing.
    const graph=structuredClone(dirty ? draft : project().workflow), model=graph.nodes.find(n=>n.type==='model'), hadBase=graph.nodes.some(n=>n.type==='base');
    if(!graph.nodes.some(n=>n.type==='base')) {
      if(!model || graph.nodes.filter(n=>n.type==='model').length!==1)throw new Error('Choose the edit preset in the Workflow editor for this custom workflow.');
      model.type='edit'; let id='base'; while(graph.nodes.some(n=>n.id===id))id+='-edit';
      graph.nodes.push({id,type:'base',settings:{}});
      const input=graph.nodes.find(n=>n.type==='input'); graph.edges.push({from:input.id,to:id,input:'design'},{from:id,to:model.id,input:'base'});
    }
    await api(baseRoute+'/editable-base','POST',{assetId:baseSelection.id,sha256:baseSelection.sha256,scope});
    if(!hadBase || dirty) {
      const saved=await api(baseRoute+'/workflow','PUT',{graph});
      draft=structuredClone(saved.workflow); dirty=false;
      delete $('node-form').dataset.dirty;
    }
    $('base-dialog').close(); await refresh();
  } catch(e) { $('base-info').textContent=e.message; }
  finally { submit.disabled=false; }
};
$('versions').onchange=()=>{historyCheckpointId=undefined;versionId=$('versions').value;lastSignature='';render();};
for(const id of ['studio-run','workflow-run'])$(id).onchange=()=>{historyCheckpointId=undefined;runId=$(id).value;lastSignature='';render();};
$('run-editor').onclick=()=>safe(()=>run());$('save-graph').onclick=()=>safe(saveGraph);
$('load-preset').onclick=()=>{delete $('node-form').dataset.dirty;draft=structuredClone(presets.find(p=>p.id===$('preset').value).graph);markDirty();renderGraph(project());};
$('save-preset').onclick=()=>safe(async()=>{await api('/workflows/presets','POST',{name:$('preset-name').value,graph:draft});await loadPresets();});
form('node-form',data=>{const n=draft.nodes.find(n=>n.id===selectedNode),settings={};for(const[key,rule]of Object.entries(catalog[n.type].settings)){const v=data.get('setting:'+key);if(v!==''&&v!==null)settings[key]=rule==='boolean'?v==='true':rule==='bound'?Number(v):v;}n.settings=settings;draft.edges=draft.edges.filter(e=>e.to!==n.id);for(const port of Object.keys(catalog[n.type].inputs)){const from=data.get('port:'+port);if(from)draft.edges.push({from,to:n.id,input:port});}markDirty();renderGraph(project());});
$('remove-node').onclick=()=>{draft.nodes=draft.nodes.filter(n=>n.id!==selectedNode);draft.edges=draft.edges.filter(e=>e.from!==selectedNode&&e.to!==selectedNode);selectedNode=draft.nodes[0]?.id;markDirty();renderGraph(project());};
$('add-node').onclick=()=>{const type=$('add-type').value;let id=type,index=2;while(draft.nodes.some(n=>n.id===id))id=type+'_'+index++;draft.nodes.push({id,type,settings:{}});selectedNode=id;markDirty();renderGraph(project());};
$('apply-json').onclick=()=>safe(()=>{const parsed=JSON.parse($('graph-json').value);if(!Array.isArray(parsed.nodes)||!Array.isArray(parsed.edges))throw new Error('Graph requires nodes and edges');delete $('node-form').dataset.dirty;draft=parsed;markDirty();renderGraph(project());});
$('fit').onclick=fit;
for(const type of ['model','compare'])$('view-'+type).onclick=()=>{$('model-view').hidden=type!=='model';$('comparison').hidden=type!=='compare';$('view-model').setAttribute('aria-pressed',String(type==='model'));$('view-compare').setAttribute('aria-pressed',String(type==='compare'));};
$('refinement-review').onclick=()=>safe(()=>api(`${route()}/versions/${selectedVersion(project()).id}/refinement-review`,'POST',{}));
$('close-history').onclick=()=>$('history-dialog').close();
$('close-refine').onclick=()=>$('refine-dialog').close();
form('refine-form',async data=>{
  const p=project(), v=selectedVersion(p), r=p.workflowRuns.find(r=>r.id===v.workflowRunId), cp=candidateCheckpoint(r,v);
  if(!cp) throw new Error('Choose a completed model checkpoint to refine.');
  let refine=draft.nodes.find(n=>n.type==='refine'&&draft.edges.some(e=>e.from===cp.nodeId&&e.to===n.id&&e.input==='model'));
  if(!refine){
    let id='refine', index=2;while(draft.nodes.some(n=>n.id===id))id='refine_'+index++;
    refine={id,type:'refine',settings:{}};draft.nodes.push(refine);
    for(const edge of draft.edges.filter(e=>e.from===cp.nodeId&&e.input==='model'))edge.from=id;
    draft.edges.push({from:cp.nodeId,to:id,input:'model'});
  }
  refine.settings={...refine.settings,enabled:true,maxIterations:Number(data.get('maxIterations'))};
  dirty=true; await saveGraph(); await run({runId:r.id,checkpointId:cp.id}); $('refine-dialog').close();
});
setupLibrary({api,project,refresh,editModel:openBase});
await safe(async()=>{await loadPresets();await refresh();});
setInterval(()=>refresh().catch(()=>{connected=false;$('connection').textContent='Local server disconnected';notify('Local server disconnected. Reconnect to continue.');$('run-workflow').disabled=$('run-editor').disabled=true;}),1500);
