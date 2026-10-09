import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { mpfbCode, mpfbResult } from './mpfb.js';
import { blenderCall } from './blender.js';

const server = new McpServer({ name: 'gen3d-blender', version: '0.1.0' });
for (const [name, type, description, inputSchema] of [
  ['get_scene_info', 'get_scene_info', 'Inspect the real Blender scene before modeling.', {}],
  ['mpfb_status', 'mpfb_status', 'Validate the enabled local MPFB version and real Python API. Does not install or download anything.', {}],
  ['create_mpfb_human', 'create_mpfb_human', 'Create a continuous base human using the installed MPFB HumanService.create_human API. Call once for a new MPFB job, then adapt this body using execute_blender_code. No downloads.', {}],
  ['execute_blender_code', 'execute_code', 'Execute Python with bpy in Blender on its main thread. Create or revise real mesh geometry. Use small steps and inspect the scene.', { code: z.string().min(1).max(200000) }],
]) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: ['get_scene_info', 'mpfb_status'].includes(name), destructiveHint: !['get_scene_info', 'mpfb_status'].includes(name), openWorldHint: !['get_scene_info', 'mpfb_status'].includes(name) } }, async params => {
    try {
      if (name === 'create_mpfb_human' && process.env.GEN3D_MODELING_MODE !== 'mpfb') throw new Error('MPFB creation requires an explicitly selected MPFB humanoid job.');
      const isMpfb = ['mpfb_status', 'create_mpfb_human'].includes(name);
      const raw = await blenderCall(isMpfb ? 'execute_code' : type, isMpfb ? { code: mpfbCode(name === 'mpfb_status' ? 'status' : 'create') } : params);
      const result = isMpfb ? mpfbResult(raw) : raw;
      // Evidence of successful MCP execution, without exposing user code or host details.
      if (process.env.GEN3D_AUDIT_DIR) fs.appendFileSync(path.join(process.env.GEN3D_AUDIT_DIR, 'mcp-audit.jsonl'), JSON.stringify({ tool: name, at: new Date().toISOString(), codeHash: params.code ? createHash('sha256').update(params.code).digest('hex') : undefined }) + '\n');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });
}
await server.connect(new StdioServerTransport());
