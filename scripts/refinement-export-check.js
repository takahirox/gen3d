// Real local Blender exporter regression. Deterministic edits; no Codex usage
// or visual quality judgment. Outputs stay inspectable in an isolated folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { exportCode, runProcess, validateArtifacts } from '../src/runner.js';

const output = path.resolve(process.env.GEN3D_REFINEMENT_EXPORT_OUTPUT || '.gen3d/refinement-export-check');
fs.mkdirSync(output, { recursive: true });
const stages = ['initial', 'material', 'camera', 'reopened', 'multi-view'];
for (const stage of stages) fs.mkdirSync(path.join(output, stage), { recursive: true });
fs.mkdirSync(path.join(output, 'invalid'), { recursive: true });
const code = stage => exportCode(path.join(output, stage), { refinementSettings: { enabled: true },
  modelingImages: stage === 'multi-view' ? ['front', 'side', 'back', 'three-quarter'].map(view => ({ view })) : [] });
const python = `import bpy, json, os
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()
body = bpy.context.object
material = bpy.data.materials.new('body')
material.use_nodes = True
material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0, 0, 1, 1)
body.data.materials.append(material)
bpy.context.scene['gen3d_reference_camera_direction'] = [0, -1, 0]
${code('initial')}
material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (1, 0, 0, 1)
${code('material')}
bpy.context.scene['gen3d_reference_camera_framing'] = {'input': {'center': [1, 2, 3], 'orthoScale': 42.0}}
${code('camera')}
assert abs(bpy.context.scene.camera.data.ortho_scale - 42) < 0.001
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(path.join(output, 'camera/scene.blend'))}, use_scripts=False)
assert abs(bpy.context.scene.camera.data.ortho_scale - 42) < 0.001
${code('reopened')}
labels = ['front', 'side', 'back', 'three-quarter']
bpy.context.scene['gen3d_reference_camera_directions'] = {'front': [0,-1,0], 'side': [-1,0,0], 'back': [0,1,0], 'three-quarter': [-1,-1,0.1]}
bpy.context.scene['gen3d_reference_camera_framing'] = {label: {'center': [i * 0.1, 0, 0.5], 'orthoScale': 5.0 + i} for i, label in enumerate(labels)}
${code('multi-view')}
# Invalid overrides must fail explicitly rather than reset to bounds.
for bad in [{'orthoScale': 0}, {'orthoScale': float('nan')}, {'center': [0, float('inf'), 0]}, {'center': [0, 0]}]:
    bpy.context.scene['gen3d_reference_camera_framing'] = {'input': bad}
    try:
        exec(${JSON.stringify(exportCode(path.join(output, 'invalid'), { refinementSettings: { enabled: true } }))})
    except (RuntimeError, TypeError, ValueError) as error:
        assert 'framing' in str(error), str(error)
    else:
        raise AssertionError('Invalid camera framing was silently accepted')
print('REFINEMENT_EXPORT_CHECK_PASSED')
`;
const script = path.join(output, 'check.py');
fs.writeFileSync(script, python);
const log = await runProcess(process.env.GEN3D_BLENDER_BIN || 'blender', ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', '--python', script], { timeout: 180000 });
fs.writeFileSync(path.join(output, 'blender.log'), log);
assert.match(log, /REFINEMENT_EXPORT_CHECK_PASSED/);
const read = (stage, file) => JSON.parse(fs.readFileSync(path.join(output, stage, file), 'utf8'));
const hash = (stage, file) => createHash('sha256').update(fs.readFileSync(path.join(output, stage, file))).digest('hex');
for (const stage of stages) validateArtifacts(path.join(output, stage));
const geometry = stages.map(stage => read(stage, 'geometry.json').sha256);
assert.equal(new Set(geometry).size, 1);
assert.notEqual(hash('initial', 'input.png'), hash('material', 'input.png'));
assert.notEqual(hash('material', 'input.png'), hash('camera', 'input.png'));
for (const stage of ['camera', 'reopened']) {
  const [camera] = read(stage, 'cameras.json');
  assert.equal(camera.orthoScale, 42); assert.deepEqual(camera.center, [1, 2, 3]);
}
const multiView = read('multi-view', 'cameras.json');
assert.equal(multiView.length, 4);
multiView.forEach((camera, i) => { assert.equal(camera.orthoScale, 5 + i); assert.ok(Math.abs(camera.center[0] - i * 0.1) < 1e-6); assert.equal(camera.center[2], 0.5); });
const report = { realBlender: true, codexUsed: false, checkedAt: new Date().toISOString(),
  checks: ['material-only edit changes exported GLB and input render while preserving mesh hash', 'camera-only edit changes input render while preserving mesh hash', 'scale 42 and target [1,2,3] honored in fresh renders and after scene reopen/export', 'all four views honor independent scales and target centers', 'invalid scale/center overrides fail explicitly'],
  geometryHashes: geometry, cameras: read('camera', 'cameras.json'), multiView,
  renderHashes: Object.fromEntries(['initial', 'material', 'camera'].map(stage => [stage, hash(stage, 'input.png')])),
  limitation: 'Deterministic Blender export check, not a fresh Codex modeling/inspection trial or evidence of visual quality improvement.' };
assert.notEqual(hash('initial', 'model.glb'), hash('material', 'model.glb'));
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Real Blender exporter checks passed. Saved evidence: ${output}`);
