// Opt-in LIVE validation: requires ChatGPT Codex login and a dedicated Blender
// bridge. Uses the subscription allowance; never retries a usage limit.
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Runner } from '../src/runner.js';

const output = path.resolve(process.env.GEN3D_REFINEMENT_OUTPUT || '.gen3d/refinement-validation');
const reference = process.env.GEN3D_REFINEMENT_REFERENCE;
const referenceDir = process.env.GEN3D_REFINEMENT_REFERENCE_DIR;
if (!reference && !referenceDir) throw new Error('Set GEN3D_REFINEMENT_REFERENCE to an approved original image or GEN3D_REFINEMENT_REFERENCE_DIR to an approved concept/four-view directory');
const bytes = reference ? fs.readFileSync(reference) : null, ext = reference ? path.extname(reference).slice(1) : null;
const conceptGenerator = referenceDir ? {
  provider: 'saved-original-reference-directory',
  async generate() { return { bytes: fs.readFileSync(path.join(referenceDir, 'concept.png')), ext: 'png' }; },
  async generateViews({ onImage }) { for (const view of ['front', 'side', 'back', 'three-quarter']) await onImage({ view, side: view === 'side' ? 'left' : undefined, bytes: fs.readFileSync(path.join(referenceDir, view + '.png')), ext: 'png' }); }
} : undefined;
const store = new Store(path.join(output, 'projects')), runner = new Runner(store, { conceptGenerator });
const p = store.create({ name: 'Live refinement validation', mode: reference ? 'image' : 'text', ...(reference ? { image: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytes.toString('base64')}` } : {}),
  profile: process.env.GEN3D_REFINEMENT_PROFILE || 'object', modelingMode: process.env.GEN3D_REFINEMENT_MODE || 'scratch',
  prompt: process.env.GEN3D_REFINEMENT_PROMPT || 'Reconstruct the subject in the original image, preserving its silhouette, proportions, parts, features and materials.',
  consistencySettings: { enabled: true, onFailure: process.env.GEN3D_REFINEMENT_ON_FAILURE || 'stop' },
  refinementSettings: { enabled: true, maxIterations: 1 }, checkpoints: { input: false, concept: false, multiView: false, preview: true } }, 'web');
const started = Date.now();
const progress = setInterval(() => console.log(JSON.stringify({ model: p.versions.at(-1)?.status, refinement: p.versions.at(-1)?.refinement.status, cycles: p.versions.at(-1)?.refinement.iterations.map(c => ({ number: c.number, stage: c.stage, status: c.status })), usageLimited: runner.usageLimited })), 15000);
try {
  runner.start(p.id, {}, 'web'); await runner.pending;
  const v = p.versions.at(-1);
  if (!v) {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ live: true, projectId: p.id, status: 'blocked-before-modeling', error: p.referenceSets.at(-1)?.error || p.concepts.at(-1)?.error, usageLimited: runner.usageLimited }, null, 2));
    throw new Error('Modeling blocked; inspect saved project/reference report.');
  }
  const report = { live: true, projectId: p.id, elapsedMs: Date.now() - started, modelingMode: v.modelingMode, status: v.status, error: v.error, refinement: v.refinement, artifacts: v.artifacts, usageLimited: runner.usageLimited,
    interpretation: 'Real Codex and Blender outputs. Visual judgments are subjective; mesh hash differences prove a geometry change, not quality improvement.' };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: v.status, refinement: v.refinement.status, cycles: v.refinement.iterations.length, usageLimited: runner.usageLimited }));
  if (v.status !== 'ready' || ['failed', 'usage-limit'].includes(v.refinement.status)) process.exitCode = 1;
} finally { clearInterval(progress); }
