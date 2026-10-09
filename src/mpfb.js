import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../blender/mpfb_runtime.py', import.meta.url), 'utf8');
export function mpfbCode(action) {
  if (!['status', 'create', 'verify'].includes(action)) throw new Error('Unknown MPFB action');
  return runtime + `\nprint('GEN3D_MPFB_RESULT=' + json.dumps(gen3d_mpfb_${action}()))\n`;
}
export function mpfbResult(result) {
  const line = result?.output?.split('\n').findLast(line => line.startsWith('GEN3D_MPFB_RESULT='));
  if (!line) throw new Error('MPFB validation returned no result. Update the local Blender bridge and see docs/mpfb.md.');
  return JSON.parse(line.slice('GEN3D_MPFB_RESULT='.length));
}
