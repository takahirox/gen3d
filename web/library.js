// Direct source intentions; only the chosen action grants its exact scope.
export function setupLibrary({ api, project, refresh, editModel }) {
  const $ = id => document.getElementById(id);
  const el = (tag, text) => { const e = document.createElement(tag); if (text) e.textContent = text; return e; };
  let page = 0, total = 0, token = 0, targetProject, copyAsset, opener, busy = false;
  const error = message => { $('library-error').textContent = message; $('library-error').hidden = !message; };
  async function action(fn) {
    if (busy) return;
    busy = true; error(''); $('library-dialog').setAttribute('aria-busy', 'true');
    for (const b of $('library-dialog').querySelectorAll('button')) b.disabled = true;
    try { await fn(); } catch (e) { error(e.message); }
    finally { busy = false; $('library-dialog').setAttribute('aria-busy', 'false'); for (const b of $('library-dialog').querySelectorAll('button')) b.disabled = b.dataset.unavailable === 'true'; }
  }
  async function use(a, use, extra = {}) {
    const id = targetProject;
    const inspected = await api(`/library/assets/${a.id}/inspect`, 'POST', {});
    await api(`/projects/${id}/model-references/use`, 'POST', { assetId: a.id, sha256: a.sha256 || inspected.sha256, use, ...extra });
    await refresh(); $('library-dialog').close();
  }
  function sourceButton(text, a, fn, title) {
    const b = el('button', text); b.type = 'button';
    b.disabled = !!a.error || !targetProject; b.dataset.unavailable = String(b.disabled);
    b.setAttribute('aria-label', `${text}: ${a.name}`); if (title) { b.title = title; b.setAttribute('aria-description', title); }
    b.onclick = fn; return b;
  }
  async function load() {
    const current = ++token; error(''); $('library-status').textContent = 'Loading…';
    try {
      const result = await api('/library?' + new URLSearchParams({ search: $('library-search').value, sourceId: $('library-source').value, offset: page * 40, limit: 40 }));
      if (current !== token) return;
      total = result.total;
      const selectedSource = $('library-source').value;
      $('library-source').replaceChildren(...[['', 'All sources'], ['managed', 'Imports'], ...result.sources.map(s => [s.id, s.directory])].map(([id, text]) => { const o = el('option', text); o.value = id; return o; }));
      $('library-source').value = selectedSource;
      $('library-sources').replaceChildren(...result.sources.map(s => {
        const row = el('p', `${s.directory}${s.error ? ' · ' + s.error : ''} `);
        const scan = el('button', 'Rescan'); scan.type = 'button'; scan.onclick = () => action(async () => { await api(`/library/sources/${s.id}/scan`, 'POST', {}); await load(); }); row.append(scan); return row;
      }));
      $('library-assets').replaceChildren(...result.assets.map(a => {
        const card = el('article'); card.className = 'library-card'; card.dataset.assetId = a.id;
        const chosen = project()?.modelReferences.find(r => r.assetId === a.id && r.review === 'approved');
        card.classList.toggle('selected', !!chosen || project()?.editableBase?.assetId === a.id);
        if (a.preview) { const img = el('img'); img.src = a.preview; img.loading = 'lazy'; img.alt = a.name; img.onerror = () => img.remove(); card.append(img); }
        else card.append(el('span', '◇'));
        card.append(el('h3', a.name));
        if (a.error) card.append(el('p', a.error));
        const buttons = el('div'); buttons.className = 'library-card-actions';
        buttons.append(sourceButton('Use as reference', a, () => action(() => use(a, 'reference')), 'Inspect appearance only; no geometry is copied.'));
        const details = el('details'), summary = el('summary', 'More…'); summary.setAttribute('aria-label', `More ways to use ${a.name}`);
        details.append(summary, sourceButton('Edit this model', a, () => action(async () => {
          const id = targetProject, inspected = await api(`/library/assets/${a.id}/inspect`, 'POST', {});
          if (project()?.id !== id) throw new Error('Project changed; choose the model again.');
          // Close this modal before opening the contextual part picker.
          $('library-dialog').close(); await editModel(inspected);
        })), sourceButton('Use parts of this model', a, () => action(async () => {
          copyAsset = await api(`/library/assets/${a.id}/inspect`, 'POST', {}); $('copy-name').textContent = a.name; $('library-consent').reset(); $('library-consent').hidden = false;
          $('library-consent').scrollIntoView({ block: 'nearest' }); $('library-consent').elements.consent.focus();
        })));
        const help = el('span', 'Reference uses appearance only. Edit changes selected parts of a full copy. Use parts permits copying geometry.'); help.className = 'sr-only';
        buttons.append(details, help); card.append(buttons); return card;
      }));
      $('library-status').textContent = total ? '' : 'No models yet';
      $('library-prev').disabled = page === 0; $('library-next').disabled = (page + 1) * 40 >= total;
      $('library-prev').dataset.unavailable = String(page === 0); $('library-next').dataset.unavailable = String((page + 1) * 40 >= total);
      $('library-prev').parentElement.hidden = total <= 40;
    } catch (e) { if (current === token) { error(e.message); $('library-status').textContent = ''; } }
  }
  function open(event) {
    if (busy) return;
    opener = event?.currentTarget || document.activeElement; targetProject = project()?.id || null; copyAsset = null;
    $('library-project').textContent = targetProject ? `Sources for ${project().name}` : 'Create a project to use a model.';
    $('library-consent').hidden = true; $('add-source').open = false;
    page = 0; $('library-assets').replaceChildren(); $('library-dialog').showModal(); load();
  }
  $('open-library').onclick = open; $('select-models').onclick = open;
  $('close-library').onclick = () => $('library-dialog').close();
  $('library-dialog').addEventListener('close', () => {
    if ($('library-dialog').open || $('base-dialog').open) return;
    if (opener?.id === 'select-models') $('add-source').open = true;
    (opener?.isConnected ? opener : $('add-source').querySelector('summary')).focus();
  });
  $('cancel-copy').onclick = () => { $('library-consent').hidden = true; $('library-assets').querySelector(`[data-asset-id="${copyAsset.id}"] summary`)?.focus(); copyAsset = null; };
  let timer;
  $('library-search').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 0; load(); }, 200); };
  $('library-source').onchange = () => { page = 0; load(); };
  $('library-prev').onclick = () => { page--; load(); }; $('library-next').onclick = () => { page++; load(); };
  $('library-file').onchange = () => { if ($('library-file').files.length) $('library-import').requestSubmit(); };
  $('library-import').onsubmit = event => { event.preventDefault(); action(async () => {
    const file = $('library-file').files[0];
    if (!file || file.size > 64 * 1024 * 1024 || !/\.(glb|blend)$/i.test(file.name)) throw new Error('Choose a GLB or packed, uncompressed .blend, at most 64 MiB');
    $('library-status').textContent = 'Inspecting model…';
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Cannot read file')); reader.readAsDataURL(file); });
    await api('/library/imports', 'POST', { name: file.name, data }); $('library-import').reset(); page = 0; $('library-search').value = ''; await load();
  }); };
  $('library-folder').onsubmit = event => { event.preventDefault(); action(async () => { await api('/library/sources', 'POST', { directory: $('library-directory').value }); $('library-folder').reset(); page = 0; await load(); }); };
  $('library-consent').onsubmit = event => { event.preventDefault(); action(() => use(copyAsset, 'parts', { copyConsent: $('library-consent').elements.consent.checked, role: $('library-consent').elements.role.value })); };
}
