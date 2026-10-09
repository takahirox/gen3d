import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Mock the TCP bridge, but exercise the real stdio MCP server and adapter dispatch.
test('local MPFB MCP tools use the existing execute_code bridge, gate creation and audit successes only', async t => {
  const requests = [], sockets = new Set(); let fail = false;
  const bridge = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let data = '';
    socket.on('data', chunk => {
      data += chunk;
      if (!data.includes('\n')) return;
      const request = JSON.parse(data.split('\n')[0]); requests.push(request);
      socket.end(JSON.stringify(fail ? { status: 'error', message: 'MPFB is disabled. Enable it; see docs/mpfb.md.' }
        : { status: 'success', result: { output: 'GEN3D_MPFB_RESULT={"available":true,"vertices":19158}\n' } }) + '\n');
    });
  });
  bridge.listen(0, '127.0.0.1'); await once(bridge, 'listening');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen3d-mpfb-mcp-'));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => bridge.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  async function connect(mode) {
    const client = new Client({ name: 'mpfb-bridge-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/blender-mcp.js')], env: { ...process.env, GEN3D_BLENDER_PORT: String(bridge.address().port), GEN3D_MODELING_MODE: mode, GEN3D_AUDIT_DIR: dir }, stderr: 'pipe' }));
    t.after(() => client.close()); return client;
  }
  const scratch = await connect('scratch');
  const rejected = await scratch.callTool({ name: 'create_mpfb_human', arguments: {} });
  assert.equal(rejected.isError, true); assert.equal(requests.length, 0); assert.equal(fs.existsSync(path.join(dir, 'mcp-audit.jsonl')), false);
  const mpfb = await connect('mpfb');
  const available = await mpfb.callTool({ name: 'mpfb_status', arguments: {} });
  assert.equal(JSON.parse(available.content[0].text).available, true);
  await mpfb.callTool({ name: 'create_mpfb_human', arguments: {} });
  assert.equal(requests.length, 2); assert.ok(requests.every(r => r.type === 'execute_code'));
  assert.match(requests[1].params.code, /gen3d_mpfb_create\(\)/); assert.match(requests[1].params.code, /service.create_human/);
  fail = true;
  const unavailable = await mpfb.callTool({ name: 'create_mpfb_human', arguments: {} });
  assert.equal(unavailable.isError, true); assert.match(unavailable.content[0].text, /Enable it/);
  const audit = fs.readFileSync(path.join(dir, 'mcp-audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(audit.map(e => e.tool), ['mpfb_status', 'create_mpfb_human']);
});
