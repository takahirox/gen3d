import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { blenderCall } from './blender.js';

const server = new McpServer({ name: 'gen3d-blender', version: '0.1.0' });
for (const [name, type, description, inputSchema] of [
  ['inspect_reference_model', 'inspect_reference', 'Inspect an already loaded approved 3D reference scene: mesh names, topology, materials and shape keys.', { assetId: z.string().uuid() }],
  ['reuse_reference_mesh', 'reuse_reference', 'Copy an approved reuse-edit reference mesh and its materials/shape keys into the deliverable. Reference-only copies are refused.', { assetId: z.string().uuid(), objectName: z.string().min(1).max(200) }],
  ['get_scene_info', 'get_scene_info', 'Inspect the real Blender scene before modeling.', {}],
  ['execute_blender_code', 'execute_code', 'Execute Python with bpy in Blender on its main thread. Create or revise real mesh geometry. Use small steps and inspect the scene.', { code: z.string().min(1).max(200000) }],
]) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: name === 'get_scene_info', destructiveHint: name !== 'get_scene_info', openWorldHint: name !== 'get_scene_info' } }, async params => {
    try {
      const result = await blenderCall(type, params);
      // Evidence of successful MCP execution, without exposing user code or host details.
      if (process.env.GEN3D_AUDIT_DIR) fs.appendFileSync(path.join(process.env.GEN3D_AUDIT_DIR, 'mcp-audit.jsonl'), JSON.stringify({ tool: name, at: new Date().toISOString(), assetId: params.assetId, codeHash: params.code ? createHash('sha256').update(params.code).digest('hex') : undefined }) + '\n');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });
}
await server.connect(new StdioServerTransport());
