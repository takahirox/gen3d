import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function createMcp({ url = process.env.GEN3D_URL || 'http://127.0.0.1:3333' } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('GEN3D_URL must be a loopback HTTP address');
  const server = new McpServer({ name: 'gen3d', version: '0.1.0' });
  const id = z.string().uuid();
  const checkpoints = z.object({ input: z.boolean().optional(), concept: z.boolean().optional(), multiView: z.boolean().optional(), preview: z.boolean().optional() }).optional();
  const consistencySettings = z.object({ enabled: z.boolean().optional(), onFailure: z.enum(['stop', 'continue']).optional() }).optional();
  const refinementSettings = z.object({ enabled: z.boolean().optional(), maxIterations: z.number().int().min(1).max(5).optional() }).optional();
  async function request(route, method = 'GET', data) {
    const response = await fetch(new URL(route, target), { method, headers: { 'Content-Type': 'application/json', 'X-Gen3d-Client': 'mcp' }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(180000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }
  function tool(name, description, inputSchema, action) {
    server.registerTool(name, { description, inputSchema }, async input => {
      try {
        const result = await action(input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });
  }
  tool('list_model_library', 'Browse the shared local GLB/.blend library with pagination, filename search, managed/folder filter, previews, inspection and availability. Folder access is configured only by a human in the Web UI.', { search: z.string().max(200).optional(), sourceId: z.string().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() }, i => request('/api/library?' + new URLSearchParams(i)));
  tool('get_library_model', 'Read saved library metadata and Blender geometry inspection for a model.', { assetId: id }, i => request(`/api/library/assets/${i.assetId}`));
  tool('inspect_library_model', 'Validate/reinspect a local library model in isolated Blender; does not modify its source or authorize use.', { assetId: id }, i => request(`/api/library/assets/${i.assetId}/inspect`, 'POST', {}));
  tool('import_library_model', 'Import a self-contained GLB or packed uncompressed .blend once. data is raw base64, at most 64 MiB. Blender validates the model; project approval is still required.', { name: z.string().max(200), data: z.string() }, i => request('/api/library/imports', 'POST', i));
  tool('scan_model_folder', 'Rescan an already human-configured local source. No new host directory access and no file writes to that source.', { sourceId: id }, i => request(`/api/library/sources/${i.sourceId}/scan`, 'POST', {}));
  tool('select_model_references', 'Replace project 3D selections with zero to 32 library models, each with optional role and explicit permission. New selections and changed roles/permissions/content await human Web UI approval. MCP cannot approve reference use or reuse/edit permission. Selections are supplementary to Text OR Image.', { projectId: id, models: z.array(z.object({ assetId: id, role: z.string().max(1000).optional(), permission: z.enum(['reference-only', 'reuse-edit']) })).max(32) }, i => request(`/api/projects/${i.projectId}/model-references`, 'POST', i));
  server.registerResource('model-library', 'gen3d://library', { description: 'Shared local 3D library (first page; query list_model_library for more)', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await request('/api/library')) }] }));
  tool('list_projects', 'Read projects and history shared with the local web UI.', {}, () => request('/api/projects'));
  tool('get_project', 'Read shared checkpoint and consistency settings, inspection statuses/reports/warnings/outcomes, refinement cycles/renders/instructions/stop reasons, input review, concept images, typed reference sets, reviews, image/model linkage, artifacts and history.', { projectId: id }, i => request(`/api/projects/${i.projectId}`));
  tool('create_project', 'Create text or image input. image is a PNG/JPEG/WebP base64 data URL. Refinement defaults Off (maxIterations 1–5 revision cycles); each cycle consumes Codex time/usage. Consistency defaults to enabled with stop on failure. Does not start modeling.', { name: z.string(), mode: z.enum(['text', 'image']), profile: z.enum(['character', 'object']).optional(), prompt: z.string().optional(), image: z.string().optional(), checkpoints, consistencySettings, refinementSettings }, i => request('/api/projects', 'POST', i));
  tool('update_project', 'Update name, modeling prompt, profile or consistency/refinement settings; changes appear in the web UI. New view sets snapshot consistency settings; existing sets/models retain their policy. Human checkpoints still require Web UI approval.', { projectId: id, name: z.string().optional(), prompt: z.string().optional(), profile: z.enum(['character', 'object']).optional(), consistencySettings, refinementSettings }, i => request(`/api/projects/${i.projectId}`, 'PATCH', i));
  tool('add_reference', 'Add a generated/gathered concept or reference image (base64 data URL) for HUMAN review. All pending references block modeling until reviewed in the web UI.', { projectId: id, label: z.string(), image: z.string() }, i => request(`/api/projects/${i.projectId}/references`, 'POST', i));
  tool('generate_model', 'Run text → base concept → multi-view set → consistency check → Blender, or uploaded image → Blender. Enabled refinement performs bounded render/compare/existing-scene revision cycles before final preview review, consuming Codex time/usage. Enabled human checkpoints block continuation; concept and multi-view acceptance in the web UI resume the workflow. Returns immediately; poll get_project. Revision requires a completed sourceVersionId and feedback. Never automatically retry a usage limit.', { projectId: id, kind: z.enum(['generate', 'retry', 'revision']).default('generate'), sourceVersionId: id.optional(), feedback: z.string().optional() }, i => request(`/api/projects/${i.projectId}/generate`, 'POST', i));
  tool('regenerate_concept', 'Regenerate the text concept; concept review pauses before modeling when enabled. Reject pending concepts in the web UI first; image projects skip this stage.', { projectId: id, feedback: z.string().optional() }, i => request(`/api/projects/${i.projectId}/concepts`, 'POST', i));
  tool('regenerate_reference_set', 'Regenerate referenceSetId, preserving its base concept and modeling request; defaults to the latest set for the selected concept. Uses current project consistency settings. feedback repairs views separately from saved modeling feedback. Reject pending sets in the Web UI first. Inspection errors and invalid images block modeling; no automatic retry.', { projectId: id, referenceSetId: id.optional(), feedback: z.string().optional() }, i => request(`/api/projects/${i.projectId}/reference-sets`, 'POST', i));
  server.registerTool('get_reference_image', { description: 'Read an actual saved base concept or generated view, including previous and partial sets.', inputSchema: { projectId: id, imageId: id } }, async i => {
    try {
      const p = await request(`/api/projects/${i.projectId}`);
      const file = p.concepts.find(c => c.id === i.imageId)?.artifacts.image || p.referenceSets.flatMap(s => s.images).find(image => image.id === i.imageId)?.file;
      if (!file) throw new Error('Reference image not found');
      const response = await fetch(new URL(`/api/projects/${p.id}/artifacts/${file}`, target), { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Reference artifact unavailable');
      return { content: [{ type: 'image', mimeType: response.headers.get('content-type'), data: Buffer.from(await response.arrayBuffer()).toString('base64') }] };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });
  server.registerTool('get_artifact_image', { description: 'Inspect a saved input, comparison render or partial/history image using its project artifact path.', inputSchema: { projectId: id, file: z.string() } }, async i => {
    try {
      const response = await fetch(new URL(`/api/projects/${i.projectId}/artifacts/${i.file.split('/').map(encodeURIComponent).join('/')}`, target), { signal: AbortSignal.timeout(15000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Image artifact unavailable');
      return { content: [{ type: 'image', mimeType: response.headers.get('content-type'), data: Buffer.from(await response.arrayBuffer()).toString('base64') }] };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });
  tool('review_model', 'Record a completed model review when its human checkpoint is disabled; enabled preview checkpoints require a decision in the web UI.', { projectId: id, versionId: id, decision: z.enum(['approved', 'rejected']) }, i => request(`/api/projects/${i.projectId}/versions/${i.versionId}/review`, 'POST', i));
  tool('export_model', 'Get local download URLs for a completed GLB and Blender scene.', { projectId: id, versionId: id }, async i => {
    const p = await request(`/api/projects/${i.projectId}`);
    await request(`/api/projects/${i.projectId}/versions/${i.versionId}/export`);
    const v = p.versions.find(v => v.id === i.versionId && v.status === 'ready');
    if (!v) throw new Error('Choose a completed version');
    return Object.fromEntries(['glb', 'blend', 'render'].map(key => [key, new URL(`/api/projects/${p.id}/artifacts/${v.artifacts[key]}?download=1`, target).href]));
  });
  server.registerResource('projects', 'gen3d://projects', { description: 'Shared local project state', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await request('/api/projects')) }] }));
  server.registerResource('project', new ResourceTemplate('gen3d://projects/{projectId}', { list: undefined }), { mimeType: 'application/json' }, async (uri, { projectId }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await request(`/api/projects/${encodeURIComponent(projectId)}`)) }] }));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await createMcp().connect(new StdioServerTransport());
