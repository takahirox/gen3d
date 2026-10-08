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
  async function request(route, method = 'GET', data) {
    const response = await fetch(new URL(route, target), { method, headers: { 'Content-Type': 'application/json', 'X-Gen3d-Client': 'mcp' }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(15000) });
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
  tool('list_projects', 'Read projects and history shared with the local web UI.', {}, () => request('/api/projects'));
  tool('get_project', 'Read a project, input, reference reviews, model versions, artifacts and activity.', { projectId: id }, i => request(`/api/projects/${i.projectId}`));
  tool('create_project', 'Create text or image input. image is a PNG/JPEG/WebP base64 data URL. Does not start modeling.', { name: z.string(), mode: z.enum(['text', 'image']), prompt: z.string().optional(), image: z.string().optional() }, i => request('/api/projects', 'POST', i));
  tool('update_project', 'Update the project name or modeling prompt; changes appear in the web UI. Existing version snapshots are retained.', { projectId: id, name: z.string().optional(), prompt: z.string().optional() }, i => request(`/api/projects/${i.projectId}`, 'PATCH', i));
  tool('add_reference', 'Add a generated/gathered concept or reference image (base64 data URL) for HUMAN review. All pending references block modeling until reviewed in the web UI.', { projectId: id, label: z.string(), image: z.string() }, i => request(`/api/projects/${i.projectId}/references`, 'POST', i));
  tool('generate_model', 'Ask subscription-authenticated Codex to create, retry or revise real Blender geometry. Returns immediately; poll get_project. Revision requires a completed sourceVersionId and feedback. Never automatically retry a usage limit.', { projectId: id, kind: z.enum(['generate', 'retry', 'revision']).default('generate'), sourceVersionId: id.optional(), feedback: z.string().optional() }, i => request(`/api/projects/${i.projectId}/generate`, 'POST', i));
  tool('review_model', 'Approve or reject a completed model version and record the decision in shared history.', { projectId: id, versionId: id, decision: z.enum(['approved', 'rejected']) }, i => request(`/api/projects/${i.projectId}/versions/${i.versionId}/review`, 'POST', i));
  tool('export_model', 'Get local download URLs for a completed GLB and Blender scene.', { projectId: id, versionId: id }, async i => {
    const p = await request(`/api/projects/${i.projectId}`);
    const v = p.versions.find(v => v.id === i.versionId && v.status === 'ready');
    if (!v) throw new Error('Choose a completed version');
    return Object.fromEntries(['glb', 'blend', 'render'].map(key => [key, new URL(`/api/projects/${p.id}/artifacts/${v.artifacts[key]}?download=1`, target).href]));
  });
  server.registerResource('projects', 'gen3d://projects', { description: 'Shared local project state', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await request('/api/projects')) }] }));
  server.registerResource('project', new ResourceTemplate('gen3d://projects/{projectId}', { list: undefined }), { mimeType: 'application/json' }, async (uri, { projectId }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await request(`/api/projects/${encodeURIComponent(projectId)}`)) }] }));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await createMcp().connect(new StdioServerTransport());
