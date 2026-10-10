// Opt-in LIVE validation: requires ChatGPT Codex login and a dedicated Blender
// bridge. Uses the subscription allowance; never retries a usage limit.
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Runner } from '../src/runner.js';

const output = path.resolve(process.env.GEN3D_REFINEMENT_OUTPUT || '.gen3d/refinement-validation');
const reference = process.env.GEN3D_REFINEMENT_REFERENCE;
if (!reference) throw new Error('Set GEN3D_REFINEMENT_REFERENCE to an approved input image');
const bytes = fs.readFileSync(reference), ext = path.extname(reference).slice(1);
const store = new Store(path.join(output, 'projects')), runner = new Runner(store);
const p = store.create({ name: 'Live refinement validation', mode: 'image', image: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytes.toString('base64')}`,
  profile: process.env.GEN3D_REFINEMENT_PROFILE || 'object',
  prompt: process.env.GEN3D_REFINEMENT_PROMPT || 'Reconstruct the subject in the original image, preserving its silhouette, proportions, parts, features and materials.',
  refinementSettings: { enabled: true, maxIterations: 1 }, checkpoints: { input: false, concept: false, multiView: false, preview: true } }, 'web');
const started = Date.now();
const progress = setInterval(() => console.log(JSON.stringify({ model: p.versions.at(-1)?.status, refinement: p.versions.at(-1)?.refinement.status, cycles: p.versions.at(-1)?.refinement.iterations.map(c => ({ number: c.number, stage: c.stage, status: c.status })), usageLimited: runner.usageLimited })), 15000);
try {
  runner.start(p.id, {}, 'web'); await runner.pending;
  const v = p.versions.at(-1);
  const report = { live: true, projectId: p.id, elapsedMs: Date.now() - started, status: v.status, error: v.error, refinement: v.refinement, artifacts: v.artifacts, usageLimited: runner.usageLimited,
    interpretation: 'Real Codex and Blender outputs. Visual judgments are subjective; mesh hash differences prove a geometry change, not quality improvement.' };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: v.status, refinement: v.refinement.status, cycles: v.refinement.iterations.length, usageLimited: runner.usageLimited }));
  if (v.status !== 'ready' || ['failed', 'usage-limit'].includes(v.refinement.status)) process.exitCode = 1;
} finally { clearInterval(progress); }
