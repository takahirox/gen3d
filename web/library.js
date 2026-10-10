// Paginated library metadata and small Blender previews, never whole 3D models.
export function setupLibrary({ api, project, refresh }) {
  const $ = id => document.getElementById(id);
  let draft = new Map(), page = 0, total = 0, token = 0, targetProject = null;
  const error = message => { $('library-error').textContent = message; $('library-error').hidden = !message; };
  async function action(fn) {
    error(''); $('library-dialog').setAttribute('aria-busy', 'true');
    for (const b of $('library-dialog').querySelectorAll('button[type=submit]')) b.disabled = true;
    try { await fn(); } catch (e) { error(e.message); }
    finally { $('library-dialog').setAttribute('aria-busy', 'false'); for (const b of $('library-dialog').querySelectorAll('button[type=submit]')) b.disabled = b.id === 'library-save' && !targetProject; }
  }
  function selected() {
    $('library-selected').replaceChildren(...[...draft.values()].map(r => {
      const row = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = r.name || r.assetId;
      const roleLabel = document.createElement('label'); roleLabel.textContent = 'Role / instruction (optional)';
      const role = document.createElement('textarea'); role.maxLength = 1000; role.rows = 2; role.value = r.role || ''; role.oninput = () => { r.role = role.value; }; roleLabel.append(role);
      const usageLabel = document.createElement('label'); usageLabel.textContent = 'Usage permission';
      const usage = document.createElement('select');
      for (const [value, label] of [['reference-only', 'Inspect only'], ['reuse-edit', 'Allow duplication & editing']]) { const o = document.createElement('option'); o.value = value; o.textContent = label; usage.append(o); }
      usage.value = r.permission; usage.onchange = () => { r.permission = usage.value; }; usageLabel.append(usage);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Detach'; remove.onclick = () => { draft.delete(r.assetId); selected(); load(); };
      row.append(legend, roleLabel, usageLabel, remove); return row;
    }));
    $('library-selection-count').textContent = `${draft.size} selected (maximum 32)`;
    $('library-save').disabled = !targetProject;
  }
  async function load() {
    const current = ++token; error(''); $('library-status').textContent = 'Loading local library…';
    try {
      const result = await api('/library?' + new URLSearchParams({ search: $('library-search').value, sourceId: $('library-source').value, offset: page * 40, limit: 40 }));
      if (current !== token) return;
      total = result.total;
      const selectedSource = $('library-source').value;
      $('library-source').replaceChildren(...[['', 'All sources'], ['managed', 'Managed imports'], ...result.sources.map(s => [s.id, s.directory])].map(([id, text]) => { const o = document.createElement('option'); o.value = id; o.textContent = text; return o; }));
      $('library-source').value = selectedSource;
      $('library-sources').replaceChildren(...result.sources.map(s => {
        const row = document.createElement('p'); row.textContent = `${s.directory}${s.error ? ' · ' + s.error : ''} `;
        const scan = document.createElement('button'); scan.type = 'button'; scan.className = 'secondary'; scan.textContent = 'Rescan folder'; scan.onclick = () => action(async () => { await api(`/library/sources/${s.id}/scan`, 'POST', {}); await load(); }); row.append(scan); return row;
      }));
      $('library-assets').replaceChildren(...result.assets.map(a => {
        const label = document.createElement('label'); label.className = 'library-card';
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = draft.has(a.id); check.disabled = !!a.error || !targetProject;
        check.onchange = () => { if (check.checked) { if (draft.size >= 32) { check.checked = false; error('Select at most 32 models'); return; } draft.set(a.id, { assetId: a.id, name: a.name, role: '', permission: 'reference-only' }); } else draft.delete(a.id); selected(); };
        const name = document.createElement('span'); name.textContent = `${a.name} · ${a.origin === 'managed' ? 'Managed import' : 'External folder'} · ${a.format || 'model'}${a.inspection ? ` · ${a.inspection.meshes} meshes` : ' · Inspected on selection'}${a.error ? ' · ' + a.error : ''}`;
        label.append(check);
        if (a.preview) { const image = document.createElement('img'); image.src = a.preview; image.loading = 'lazy'; image.alt = ''; image.onerror = () => image.remove(); label.append(image); }
        label.append(name); return label;
      }));
      $('library-status').textContent = total ? `${page * 40 + 1}–${Math.min((page + 1) * 40, total)} of ${total} models` : 'No models found. Import a GLB/.blend or configure a local folder.';
      $('library-prev').disabled = page === 0; $('library-next').disabled = (page + 1) * 40 >= total;
    } catch (e) { if (current === token) { error(e.message); $('library-status').textContent = 'Library unavailable'; } }
  }
  function open() {
    targetProject = project()?.id || null;
    draft = new Map((project()?.modelReferences || []).map(r => [r.assetId, { ...r }]));
    $('library-project').textContent = targetProject ? `Select optional models for ${project().name}. Save, then approve each role and permission in the project.` : 'Import reusable models now. Create a project to select them.';
    page = 0; selected(); $('library-dialog').showModal(); load();
  }
  $('open-library').onclick = open; $('select-models').onclick = open;
  $('close-library').onclick = () => $('library-dialog').close();
  let timer;
  $('library-search').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 0; load(); }, 200); };
  $('library-source').onchange = () => { page = 0; load(); };
  $('library-prev').onclick = () => { page--; load(); }; $('library-next').onclick = () => { page++; load(); };
  $('library-import').onsubmit = event => { event.preventDefault(); action(async () => {
    const file = $('library-file').files[0];
    if (!file || file.size > 64 * 1024 * 1024 || !/\.(glb|blend)$/i.test(file.name)) throw new Error('Choose a GLB or uncompressed .blend, at most 64 MiB');
    $('library-status').textContent = 'Importing and inspecting in Blender…';
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Cannot read file')); reader.readAsDataURL(file); });
    await api('/library/imports', 'POST', { name: file.name, data }); $('library-import').reset(); page = 0; await load();
  }); };
  $('library-folder').onsubmit = event => { event.preventDefault(); action(async () => { await api('/library/sources', 'POST', { directory: $('library-directory').value }); $('library-folder').reset(); page = 0; await load(); }); };
  $('library-selection').onsubmit = event => { event.preventDefault(); action(async () => {
    await api(`/projects/${targetProject}/model-references`, 'POST', { models: [...draft.values()].map(({ assetId, role, permission }) => ({ assetId, role, permission })) });
    await refresh(); $('library-dialog').close();
  }); };
}
