// Opt-in LIVE acceptance experiment. Uses the current ChatGPT Codex allowance.
// Start a dedicated MPFB-enabled Blender bridge first. Never retries a limit.
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Runner } from '../src/runner.js';

const output = path.resolve(process.env.GEN3D_MPFB_OUTPUT || '.gen3d/mpfb-validation');
const store = new Store(path.join(output, 'projects'));
const referenceDir = process.env.GEN3D_MPFB_REFERENCE_DIR;
const conceptGenerator = referenceDir ? {
  provider: 'local-reference-directory',
  async generate() { return { bytes: fs.readFileSync(path.join(referenceDir, 'concept.png')), ext: 'png' }; },
  async generateViews({ onImage }) {
    for (const view of ['front', 'side', 'back', 'three-quarter']) await onImage({ view, side: view === 'side' ? 'left' : undefined, bytes: fs.readFileSync(path.join(referenceDir, view + '.png')), ext: 'png' });
  }
} : undefined;
const runner = new Runner(store, { conceptGenerator });
const prompt = process.env.GEN3D_MPFB_PROMPT || 'A realistic fictional adult human with a lean build, natural human proportions and a calm neutral face. Short dark hair, warm medium skin tone, plain fitted teal short-sleeved T-shirt, dark charcoal trousers and simple dark shoes. No accessories, no text. Standing upright in a neutral A-pose. Focus on anatomically plausible hands, face, elbows and knees.';
const file = process.env.GEN3D_MPFB_REFERENCE;
const p = store.create({ name: 'MPFB comparison', mode: file ? 'image' : 'text', profile: 'character', prompt,
  ...(file ? { image: `data:image/${path.extname(file).slice(1) === 'jpg' ? 'jpeg' : path.extname(file).slice(1)};base64,${fs.readFileSync(file).toString('base64')}` } : {}),
  modelingMode: 'scratch', consistencySettings: { enabled: true, onFailure: process.env.GEN3D_MPFB_ON_FAILURE || 'stop' }, checkpoints: { input: false, concept: false, multiView: false, preview: false } }, 'web');
const report = { live: true, projectId: p.id, prompt, checkpoints: p.checkpoints, consistencySettings: p.consistencySettings, referenceProvider: referenceDir ? 'local-reference-directory' : file ? 'upload' : 'native-codex', runs: [], status: 'running' };
function save() { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
function record(v, elapsedMs) {
  report.runs.push({ id: v?.id, mode: v?.modelingMode, kind: v?.kind, status: v?.status, error: v?.error,
    elapsedMs, imageInputs: v?.imageInputs, referenceFingerprint: v?.referenceFingerprint,
    conceptId: v?.conceptId, referenceSetId: v?.referenceSetId, metrics: v?.metrics, mpfb: v?.mpfb, summary: v?.summary,
    artifacts: v?.artifacts }); save();
}
const progress = setInterval(() => {
  console.log(JSON.stringify({ concepts: p.concepts.map(c => c.status), views: p.referenceSets.map(s => s.status), models: p.versions.map(v => ({ mode: v.modelingMode, status: v.status })), usageLimited: runner.usageLimited }));
}, 15000);
try {
  save();
  for (const mode of ['scratch', 'mpfb']) {
    if (runner.usageLimited) throw new Error('Codex usage limit reached; stopping all generation without retry/reset/purchase/provider change.');
    store.update(p.id, { modelingMode: mode }, 'web');
    const before = p.versions.length, started = Date.now();
    runner.start(p.id, { kind: mode === 'scratch' ? 'generate' : 'retry' }, 'web'); await runner.pending;
    const v = p.versions.at(-1); record(p.versions.length > before ? v : null, Date.now() - started);
    if (p.versions.length === before || v.status !== 'ready') throw new Error(v?.error || p.referenceSets.at(-1)?.error || p.concepts.at(-1)?.error || 'Workflow did not complete. Inspect saved project state.');
  }
  if (report.runs[0].referenceFingerprint !== report.runs[1].referenceFingerprint) throw new Error('Comparison references differ');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; report.usageLimited = runner.usageLimited;
  console.error(error.message); process.exitCode = 1;
} finally { clearInterval(progress); save(); }
