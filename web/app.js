import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setupLibrary } from './library.js';
const $ = id => document.getElementById(id);
let projects = [], projectId = localStorage.getItem('gen3d-project'), versionId, runId, selectedNode = 'input';
let area = location.hash.slice(1) || 'home', catalog = {}, presets = [], draft, draftProject, dirty = false, status = {}, lastSignature = '';
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
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
  $('viewer-message').hidden = false; $('viewer-message').textContent = file ? 'Loading model…' : 'Run a preset to create a candidate. Intermediate checkpoints appear below.';
  if (!file || !renderer) return;
  try { const gltf = await new GLTFLoader().loadAsync(file); if (token !== loadToken) { dispose(gltf.scene); return; } model = gltf.scene; scene.add(model); fit(); $('viewer-message').hidden = true; }
  catch { if (token === loadToken) $('viewer-message').textContent = 'Could not load the 3D preview. Inspect source / render comparison and saved artifacts.'; }
}
function navigate(next) { area = ['studio','workflow'].includes(next) ? next : 'home'; location.hash = area; lastSignature = ''; render(); window.scrollTo({ top: 0 }); }
function chooseProject(id) { projectId = id; versionId = runId = undefined; draftProject = null; localStorage.setItem('gen3d-project', id); for (const f of document.querySelectorAll('form')) delete f.dataset.dirty; navigate('studio'); }
function selectedRun(p) { return p.workflowRuns.find(r => r.id === runId) || p.workflowRuns.at(-1); }
function selectedVersion(p) { return p.versions.find(v => v.id === versionId) || p.versions.at(-1); }
function markDirty() { dirty = true; $('graph-warning').textContent = 'Unsaved graph changes. Edited nodes and dependent outputs will recompute; earlier checkpoints stay intact.'; $('graph-json').value = JSON.stringify(draft,null,2); }
async function saveGraph() { await api(route() + '/workflow','PUT',{ graph: draft }); dirty = false; }
async function run(input = {}) { if (dirty) await saveGraph(); await api(route() + '/runs','POST', input); runId = undefined; versionId = undefined; }
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
    const cp = r.checkpoints.find(c => c.id === s.checkpointId), card = node('div', undefined, 'checkpoint'); card.append(node('h3', `Human review: ${id}`), renderFiles(cp.files,true));
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
  $('candidate-info').textContent = v ? `Candidate #${v.number}: ${v.review}. ${v.error || v.summary || ''}${v.preservation ? ' Complete scene and GLB preservation verified.' : ''}` : 'Choose a preset, review your input, and run the workflow.';
  $('source-image').replaceChildren(...(v?.visualInput || p.inputImage ? [figure(v?.visualInput || p.inputImage,'Original design input')] : []));
  $('render-image').replaceChildren(...(v?.artifacts.render ? [figure(v.artifacts.render,'Candidate render')] : []));
  const actions = $('candidate-actions'); actions.replaceChildren();
  if (v) {
    const candidateRun = p.workflowRuns.find(r => r.id === v.workflowRunId), checkpoint = candidateRun?.checkpoints.find(cp => cp.data?.versionId === v.id && cp.type === 'model');
    if (v.review === 'approved') actions.append(button('Restore accepted candidate', () => api(route()+'/restore','POST',{versionId:v.id}), status.busy));
    if (checkpoint) actions.append(button('Branch from this candidate', () => run({runId:candidateRun.id,checkpointId:checkpoint.id}),status.busy));
    if (!v.workflowRunId && v.status === 'ready') actions.append(button('Accept candidate', () => api(`${route()}/versions/${v.id}/review`, 'POST', {decision:'approved'}), status.busy));
    if ((v.workflowReviewed || !v.workflowRunId) && v.status === 'ready' && candidateRun?.status !== 'waiting-review') actions.append(button('Reject candidate', () => api(`${route()}/versions/${v.id}/review`,'POST',{decision:'rejected'}),status.busy));
    actions.append(button('Inspect candidate checkpoint', () => { runId=candidateRun?.id; selectedNode=checkpoint?.nodeId || 'review'; navigate('workflow'); }));
  }
  $('exports').replaceChildren(...(v?.review === 'approved' && (v.workflowReviewed || !v.workflowRunId) ? [link('Download GLB',v.artifacts.glb,true),link('Blender scene',v.artifacts.blend,true)] : []));
  $('studio-checkpoints').replaceChildren(...(r ? r.checkpoints.map(cp => checkpointCard(p,r,cp,true)) : [node('p','Every completed node will appear here with its saved artifacts.')]));
  if (!r) {
    const files = [...p.concepts.flatMap(c => Object.values(c.artifacts)), ...p.referenceSets.flatMap(s => [...s.images.map(i => i.file), ...Object.values(s.artifacts)])];
    if (files.length) $('studio-checkpoints').replaceChildren(renderFiles([...new Set(files)], true));
  }
  renderReviews(p);
  if (!$('edit').dataset.dirty) for (const key of ['name','prompt','profile']) $('edit').elements[key].value = p[key];
  if (!$('settings').dataset.dirty) {
    const f=$('settings').elements;
    for (const key of ['input','concept','multiView','preview']) f[key].checked=p.checkpoints[key];
    f.consistency.value=String(p.consistencySettings.enabled); f.onFailure.value=p.consistencySettings.onFailure; f.refinement.value=String(p.refinementSettings.enabled); f.maxIterations.value=p.refinementSettings.maxIterations;
  }
  $('input-review').replaceChildren(node('p',p.checkpoints.input ? 'Input review: '+p.inputReview : 'Input checkpoint is off'),button('Approve input',()=>api(route()+'/input/review','POST',{decision:'approved'}),status.busy));
  $('base-info').textContent=p.editableBase ? `Authorized: ${p.editableBase.name} · editable: ${p.editableBase.scope.editableObjects.join(', ')} · source SHA-256 ${p.editableBase.sha256}` : 'No editable base authorized. Humanoid runs will block until one is selected.';
  $('model-references').replaceChildren(...p.modelReferences.map(ref => { const div=node('div',undefined,'checkpoint'); div.append(node('p',`${ref.name} · ${ref.permission} · ${ref.role || 'general reference'} · ${ref.review}`)); for (const decision of ['approved','rejected']) div.append(button(decision==='approved'?'Approve reference permission':'Reject reference',()=>api(`${route()}/model-references/${ref.assetId}/review`,'POST',{decision}),status.busy)); return div; }));
  $('references').replaceChildren(...p.references.map(ref => { const div=node('div',undefined,'checkpoint'); div.append(figure(ref.file,`${ref.label} · ${ref.review}`)); for (const decision of ['approved','rejected']) div.append(button(decision,()=>api(`${route()}/references/${ref.id}/review`,'POST',{decision}),status.busy)); return div; }));
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
  const p=project(), signature=JSON.stringify([projects,projectId,versionId,runId,area,status]);if(signature===lastSignature)return;lastSignature=signature;
  for(const key of ['home','studio','workflow'])$('nav-'+key).setAttribute('aria-current',String(area===key));
  $('home').hidden=area!=='home';$('workspace').hidden=area==='home'||!p;$('studio').hidden=area!=='studio';$('workflow-editor').hidden=area!=='workflow';
  $('projects').replaceChildren(...projects.map(p=>{const b=button(p.name,()=>chooseProject(p.id));b.id='project-'+p.id;b.setAttribute('aria-current',String(p.id===projectId));return b;}));
  $('project-cards').replaceChildren(...projects.map(p=>{const b=button('',()=>chooseProject(p.id));b.append(node('h2',p.name),node('p',`${p.workflow.name} · ${p.workflowRuns.length} runs`),node('small',p.acceptedVersionId?'Accepted candidate saved':'Ready to explore'));return b;}));
  if(!p){if(area!=='home'){$('home').hidden=false;}return;}
  if(draftProject!==p.id){draft=structuredClone(p.workflow);draftProject=p.id;dirty=false;selectedNode='input';}
  else if(!dirty)draft=structuredClone(p.workflow);
  const r=p.workflowRuns.at(-1);$('title').textContent=p.name;$('project-state').textContent=status.usageLimited?'Codex usage limit':r?`${r.status}${r.error?' · '+r.error:''}`:'Ready';
  $('run-workflow').disabled=status.busy||status.usageLimited||p.workflowRuns.some(r=>r.status==='waiting-review')||p.concepts.some(c=>c.prompt===p.prompt&&c.profile===p.profile&&c.status==='ready'&&c.review==='pending')||p.referenceSets.some(s=>s.conceptId===p.selectedConceptId&&s.prompt===p.prompt&&s.status==='ready'&&s.review==='pending');
  renderStudio(p);if(area==='workflow')renderGraph(p);
  $('history').replaceChildren(...p.activity.slice(-150).reverse().map(e=>node('li',`${e.at.slice(0,19)} · ${e.type}${e.nodeId?' · '+e.nodeId:''}${e.message?' · '+e.message:''}${e.decision?' · '+e.decision:''}`)));
  if (focusedId && document.activeElement === document.body) $(focusedId)?.focus({ preventScroll: true });
}
let refreshing=false;
async function refresh(){if(refreshing)return;refreshing=true;try{[projects,status]=await Promise.all([api('/projects'),api('/status')]);$('connection').textContent=status.busy?'Codex → Blender · running':'Local server connected';render();}finally{refreshing=false;}}
async function loadPresets(){const data=await api('/workflows');catalog=data.catalog;presets=data.presets;options($('preset'),presets.map(p=>[p.id,p.name||p.graph.name]),$('preset').value);options($('add-type'),Object.keys(catalog).map(t=>[t,t]),'refine');}
async function loadBases(){const data=await api('/library?limit=100');options($('base-asset'),[['','Choose a library model'],...data.assets.filter(a=>!a.error).map(a=>[a.id,a.name])],project()?.editableBase?.assetId);await inspectBase();}
async function inspectBase(){const id=$('base-asset').value;if(!id){$('base-objects').textContent='Import a GLB / packed .blend through Asset library.';return;}const a=await api('/library/assets/'+id);$('base-objects').textContent=(a.inspection?.objects||[]).map(o=>`${o.name} (${o.type})`).join('\n')||'Source is inspected when authorized.';}
for(const key of ['home','studio','workflow'])$('nav-'+key).onclick=()=>navigate(key);
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
$('theme').value=localStorage.getItem('gen3d-theme')||'dark';document.documentElement.dataset.theme=$('theme').value;
$('theme').onchange=()=>{document.documentElement.dataset.theme=$('theme').value;localStorage.setItem('gen3d-theme',$('theme').value);};
for(const id of ['new-project','empty-create'])$(id).onclick=()=>$('create-dialog').showModal();$('close-create').onclick=()=>$('create-dialog').close();
$('create').elements.mode.onchange=()=>{const image=$('create').elements.mode.value==='image';$('image-label').hidden=!image;$('create').elements.image.required=image;};
form('create',async data=>{const mode=data.get('mode'),workflowType=data.get('workflowType');const p=await api('/projects','POST',{name:data.get('name'),mode,prompt:data.get('prompt'),workflowType,profile:workflowType==='humanoid'?'character':'object',...(mode==='image'?{image:await imageData(data.get('image'))}:{})});$('create-dialog').close();$('create').reset();projects.push(p);chooseProject(p.id);await loadBases();});
form('edit',data=>api(route(),'PATCH',{name:data.get('name'),prompt:data.get('prompt'),profile:data.get('profile')}));
form('settings',data=>api(route(),'PATCH',{checkpoints:Object.fromEntries(['input','concept','multiView','preview'].map(k=>[k,data.has(k)])),consistencySettings:{enabled:data.get('consistency')==='true',onFailure:data.get('onFailure')},refinementSettings:{enabled:data.get('refinement')==='true',maxIterations:Number(data.get('maxIterations'))}}));
form('reference',async data=>{await api(route()+'/references','POST',{label:data.get('label'),image:await imageData(data.get('image'))});$('reference').reset();});
form('base-form',data=>api(route()+'/editable-base','POST',{assetId:data.get('assetId'),scope:{editableObjects:data.get('objects').split('\n').map(s=>s.trim()).filter(Boolean),allowChanges:['armature','weights','shapeKeys','uvs','materials'].filter(k=>data.has(k)),allowNewObjects:data.has('allowNewObjects')}}));
$('reload-base').onclick=()=>safe(loadBases);$('base-asset').onchange=()=>safe(inspectBase);
$('versions').onchange=()=>{versionId=$('versions').value;lastSignature='';render();};
for(const id of ['studio-run','workflow-run'])$(id).onchange=()=>{runId=$(id).value;lastSignature='';render();};
$('run-workflow').onclick=()=>safe(()=>run());$('save-graph').onclick=()=>safe(saveGraph);
$('load-preset').onclick=()=>{delete $('node-form').dataset.dirty;draft=structuredClone(presets.find(p=>p.id===$('preset').value).graph);markDirty();renderGraph(project());};
$('save-preset').onclick=()=>safe(async()=>{await api('/workflows/presets','POST',{name:$('preset-name').value,graph:draft});await loadPresets();});
form('node-form',data=>{const n=draft.nodes.find(n=>n.id===selectedNode),settings={};for(const[key,rule]of Object.entries(catalog[n.type].settings)){const v=data.get('setting:'+key);if(v!==''&&v!==null)settings[key]=rule==='boolean'?v==='true':rule==='bound'?Number(v):v;}n.settings=settings;draft.edges=draft.edges.filter(e=>e.to!==n.id);for(const port of Object.keys(catalog[n.type].inputs)){const from=data.get('port:'+port);if(from)draft.edges.push({from,to:n.id,input:port});}markDirty();renderGraph(project());});
$('remove-node').onclick=()=>{draft.nodes=draft.nodes.filter(n=>n.id!==selectedNode);draft.edges=draft.edges.filter(e=>e.from!==selectedNode&&e.to!==selectedNode);selectedNode=draft.nodes[0]?.id;markDirty();renderGraph(project());};
$('add-node').onclick=()=>{const type=$('add-type').value;let id=type,index=2;while(draft.nodes.some(n=>n.id===id))id=type+'_'+index++;draft.nodes.push({id,type,settings:{}});selectedNode=id;markDirty();renderGraph(project());};
$('apply-json').onclick=()=>safe(()=>{const parsed=JSON.parse($('graph-json').value);if(!Array.isArray(parsed.nodes)||!Array.isArray(parsed.edges))throw new Error('Graph requires nodes and edges');delete $('node-form').dataset.dirty;draft=parsed;markDirty();renderGraph(project());});
$('fit').onclick=fit;
for(const type of ['model','compare'])$('view-'+type).onclick=()=>{$('model-view').hidden=type!=='model';$('comparison').hidden=type!=='compare';$('view-model').setAttribute('aria-pressed',String(type==='model'));$('view-compare').setAttribute('aria-pressed',String(type==='compare'));};
$('refinement-review').onclick=()=>safe(()=>api(`${route()}/versions/${selectedVersion(project()).id}/refinement-review`,'POST',{}));
setupLibrary({api,project,refresh});
await safe(async()=>{await loadPresets();await refresh();await loadBases();});
setInterval(()=>refresh().catch(()=>{$('connection').textContent='Local server disconnected';}),1500);
