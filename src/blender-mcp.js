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
  ['choose_reference_usage', 'choose_reference_usage', 'After inspecting a reference, record its role-specific suitability and choose reuse or visual-only with a concrete reason. Reuse requires human reuse-edit approval.', { assetId: z.string().uuid(), usage: z.enum(['reuse', 'visual-only']), reason: z.string().min(10).max(2000) }],
  ['get_scene_info', 'get_scene_info', 'Inspect the real Blender scene before modeling.', {}],
  ['execute_blender_code', 'execute_code', 'Execute Python with bpy in Blender on its main thread. Create or revise real mesh geometry. Use small steps and inspect the scene.', { code: z.string().min(1).max(200000) }],
]) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: name === 'get_scene_info', destructiveHint: name !== 'get_scene_info', openWorldHint: name !== 'get_scene_info' } }, async params => {
    try {
      let result;
      if (name === 'execute_blender_code' && process.env.GEN3D_AUDIT_DIR) {
        const dir = process.env.GEN3D_AUDIT_DIR, manifestFile = path.join(dir, 'model-references.json');
        if (fs.existsSync(manifestFile)) {
          const models = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).models;
          const auditFile = path.join(dir, 'mcp-audit.jsonl');
          const audit = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
          if (models.some(m => !audit.some(e => e.tool === 'inspect_reference_model' && e.assetId === m.assetId))) throw new Error('Inspect EVERY selected reference before executing modeling or inspection Python');
        }
      }
      if (['choose_reference_usage', 'reuse_reference_mesh'].includes(name)) {
        const dir = process.env.GEN3D_AUDIT_DIR;
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'model-references.json'), 'utf8'));
        const model = manifest.models.find(m => m.assetId === params.assetId);
        const auditFile = path.join(dir, 'mcp-audit.jsonl');
        const audit = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
        if (!model || !audit.some(e => e.tool === 'inspect_reference_model' && e.assetId === params.assetId)) throw new Error('Inspect this selected reference before choosing or reusing it');
        if (name === 'reuse_reference_mesh' && manifest.models.some(m => !audit.some(e => e.tool === 'inspect_reference_model' && e.assetId === m.assetId))) throw new Error('Inspect EVERY selected reference before reusing geometry');
        if ((name === 'reuse_reference_mesh' || params.usage === 'reuse') && model.permission !== 'reuse-edit') throw new Error('Human approval does not permit copying or editing this reference');
        if (name === 'reuse_reference_mesh' && audit.filter(e => e.tool === 'choose_reference_usage' && e.assetId === params.assetId).at(-1)?.usage !== 'reuse') throw new Error('Choose suitable starting geometry with choose_reference_usage before reuse');
        if (name === 'choose_reference_usage') result = params;
      }
      result ??= await blenderCall(type, params);
      // Evidence of successful MCP execution, without exposing user code or host details.
      if (process.env.GEN3D_AUDIT_DIR) fs.appendFileSync(path.join(process.env.GEN3D_AUDIT_DIR, 'mcp-audit.jsonl'), JSON.stringify({ tool: name, at: new Date().toISOString(), assetId: params.assetId, ...(name === 'choose_reference_usage' ? { usage: params.usage, reason: params.reason } : {}), ...(name === 'reuse_reference_mesh' ? result : {}), codeHash: params.code ? createHash('sha256').update(params.code).digest('hex') : undefined }) + '\n');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });
}
await server.connect(new StdioServerTransport());
