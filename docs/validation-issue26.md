# Issue #26 validation

## Review fix: protected expression deformation masks

The expression-mask preservation finding from PR #27 was fixed and checked locally on 2026-10-24. Snapshots now record each expression's vertex-group binding, actual mask weights (distinguishing empty and missing groups), mute state and Blender-evaluated deformation at value 1 relative to value 0. Measurement restores the original expression values. Candidate validation compares protected scene features before export compatibility checks; masked bases block with an explicit object/expression/group diagnostic because this GLB path cannot preserve their mask configuration.

The real Blender regression saves/reopens the complete rigged fixture with only Hair authorized and an empty `ExpressionMask` assigned to protected `HeadMesh.Smile`. Raw morph coordinates and skin weights stay unchanged, while measured Smile displacement falls from approximately 0.05 to zero. Validation rejects the saved scene/export without writing success evidence. Partial-weight and missing-group bindings are also rejected; unsupported masked bases fail preparation. The ordinary Hair edit retains its expression and passes scene/GLB checks.

| Check | Result |
| --- | --- |
| `npm test` | 119 passed, 0 failed, 0 skipped |
| `npm run check` | Passed |
| `npm run test:workflow-blender` | 93 real Blender checks passed; no Codex calls |
| `npm run test:browser` | 11 checks passed, no uncaught exceptions; injected providers/recorded GLBs |
| `GEN3D_WORKFLOW_ARTIFACT_INPUT=docs/validation/issue26/live npm run test:workflow-artifacts` | Four saved scene/GLB outputs revalidated; original artifact hashes unchanged |
| `git diff --check` | Passed |

Saved reports: [Blender and measured expression evidence](validation/issue26/expression-mask-fix/blender-report.json), [browser](validation/issue26/expression-mask-fix/browser-report.json), [saved-output revalidation](validation/issue26/expression-mask-fix/artifact-report.json). Dependencies were installed with `npm ci`. The initial new regression failed because it held a Blender object reference across reopening a file; reacquiring the object fixed the harness. Final failures/skipped/unavailable checks: none. No new Codex generation, human approval, allowance change, push or merge was performed. Earlier live-generation records below remain historical.

## Review fixes: functional skin bindings and protected visibility

The two remaining preservation findings from PR #27 were fixed and checked locally on 2026-10-24:

- Armature evidence now records modifier order, targets, vertex-group/envelope binding, influence masks, preserve-volume/multiple-modifier modes and enable/display flags. The real Blender regression reopens a saved candidate with only Hair authorized, proves that disabling Body's vertex-group binding stops Root from deforming Body, and verifies that candidate validation rejects it without writing publication evidence. The authorized Hair edit still passes scene/GLB validation and Body follows a 0.25 Root translation. An export-only lost skin binding is also rejected.
- Object evidence now protects render/viewport hiding, per-object view-layer hiding, ray visibility, holdout and shadow-catcher flags. Changing protected Body's `hide_render` alongside a valid Hair edit fails candidate validation without producing publication evidence. Every recorded binding and visibility setting is tested individually. Base preparation explicitly blocks GLB roundtrips that lose preserve-volume skinning or render visibility, naming the affected object and feature.

| Check | Result |
| --- | --- |
| `npm test` | 119 passed, 0 failed, 0 skipped |
| `npm run check` | Passed |
| `npm run test:workflow-blender` | 85 real Blender checks passed; no Codex calls |
| `npm run test:browser` | 11 checks passed, no uncaught exceptions; injected providers/recorded GLBs |
| `GEN3D_WORKFLOW_ARTIFACT_INPUT=docs/validation/issue26/live npm run test:workflow-artifacts` | Four saved scene/GLB outputs revalidated; original artifact hashes unchanged |
| `git diff --check` | Passed |

Saved reports: [Blender](validation/issue26/skin-visibility-fixes/blender-report.json), [browser](validation/issue26/skin-visibility-fixes/browser-report.json), [saved-output revalidation](validation/issue26/skin-visibility-fixes/artifact-report.json). The initial unit run lacked dependencies; `npm ci` resolved that setup failure. A later concurrent run had the existing `model-reference-visuals.test.js` module exit without a diagnostic; its isolated seven tests and the final standalone full suite passed. An initial export-only regression incorrectly expected disabling vertex groups to survive GLB export; Blender normalizes that flag on import. The final test separately verifies rejection of the disabled binding in the saved scene and an export-only missing binding. Final failures/skipped/unavailable checks: none. No new Codex generation, human approval, allowance change, push or merge was performed. Earlier live-generation records below remain historical.

## Review fixes: material protection and checkpoint evidence

The two findings from PR #27 were fixed and checked locally on 2026-10-24:

- Material snapshots now compare every Principled input, shader settings, surface/culling settings and image sampling/color settings. Unsupported output wiring and muted nodes block preservation. The real Blender regression changes every accepted Principled socket individually and reproduces the unauthorized red-emission edit alongside a valid Hair edit. Both scene changes and an export-only emission change fail preservation, preventing acceptance/export evidence from being published.
- Model checkpoints now persist and hash all comparison renders plus geometry, material and camera evidence, including when refinement is Off. Refinement copies only recorded artifacts/evidence. Replacing any of the five renders or three evidence JSON files blocks checkpoint reuse, forking and export before comparison runs; injected directory contents are excluded. Valid downstream refinement still reuses the original model.

| Check | Result |
| --- | --- |
| `npm test` | 119 passed, 0 failed, 0 skipped |
| `npm run check` | Passed |
| `npm run test:browser` | 11 checks passed, no uncaught exceptions; injected providers/recorded GLBs |
| `npm run test:workflow-blender` | 57 real Blender checks passed, including all 31 Principled inputs and both emission regressions |
| `GEN3D_WORKFLOW_ARTIFACT_INPUT=docs/validation/issue26/live npm run test:workflow-artifacts` | Four saved scene/GLB outputs revalidated; original artifact hashes unchanged |
| `git diff --check` | Passed |

Saved reports: [Blender](validation/issue26/review-fixes/blender-report.json), [browser](validation/issue26/review-fixes/browser-report.json), [saved-output revalidation](validation/issue26/review-fixes/artifact-report.json). An initial expanded Blender test failed because Blender 5 exposes an inert deprecated `blend_method` setter. The final code uses current surface settings when available and legacy settings only on older Blender versions; the final check passed. No checks were skipped or unavailable. No new Codex generation, human approval, allowance change, push or merge was performed for these fixes. The earlier live-generation evidence below remains historical.

## Original implementation validation

Validation was performed locally on 2026-10-24 with Node 24.12.0, Blender 5.1.2, Chrome, and a Codex CLI reporting ChatGPT authentication. No allowance reset, purchase, provider/model switch, push, PR, merge or GitHub comment was used.

## Results

| Check | Final result | Scope |
| --- | --- | --- |
| `npm test` | 109 passed, 0 failed, 0 skipped | Graph parsing/contracts, actual adapter order, rewiring, lineage/invalidation, parallel upstream reuse, fork/resume, persisted runs/presets, interrupted state, HTTP/real MCP shared state, human gates (including stop during initial modeling), protection boundaries and existing pipeline/library/refinement tests |
| `npm run check` | Passed | All registered JavaScript syntax checks |
| `npm run test:browser` | 11 checks passed; no uncaught exceptions | Real isolated Chrome; injected providers and recorded models, no live generation |
| `npm run test:workflow-blender` | 16 checks passed | Real full-body rigged/expression fixture, complete `.blend` and GLB base loading, unchanged source hash, valid edit and reopened export; deliberate weights, morph, UV, material, armature, pose, UV-name and protected-object violations blocked |
| `GEN3D_WORKFLOW_LIVE_OUTPUT=.gen3d/workflow-live-final npm run validate:workflow-live` | Four completed graph runs | Actual Codex/Blender MCP object generation, object checkpoint fork, complete humanoid base edit and altered downstream base-checkpoint fork |
| `GEN3D_WORKFLOW_ARTIFACT_INPUT=.gen3d/workflow-live-final npm run test:workflow-artifacts` | Four saved outputs passed | Final validator reopens actual scene/GLB files, measures preservation and confirms file hashes remain unchanged; no extra Codex call |
| `scripts/browser-check.js` against the two live projects | Both passed | Actual generated GLBs downloaded/loaded, orbit/pan/zoom changed the viewer, no browser exceptions |
| `git diff --cached --check` | Passed before commit | Tracked implementation, docs and evidence whitespace |

An earlier full-suite attempt while browser checks ran concurrently had `model-reference-visuals.test.js` exit without a diagnostic. The isolated module check and final standalone `npm test` passed. No cause is asserted. Final failures and unavailable prerequisites: none. Initial development failures in graph test expectations, Blender format normalization and browser timing were corrected before the recorded successful checks.

The deterministic tests and fixture browser replay do **not** demonstrate Codex generation. The real Blender-only check does **not** use Codex. The live report and actual scenes below provide separate generation evidence. Live generation ran with preview gates explicitly disabled; the harness authorized only Hair on its own generated base. Human decisions were exercised through the real browser/API boundary tests, not claimed as a human aesthetic approval of the live models.

## Live scenes and branches

| Run | Result | Actual artifacts |
| --- | --- | --- |
| Object | `completed` | [GLB](validation/issue26/live/data-KE6lZq/0ea17dcd-951e-4027-8a8d-f017bbafde58/runs/54f7f0d8-4704-443a-91cb-f19db53d3dae/model/model.glb) · [scene](validation/issue26/live/data-KE6lZq/0ea17dcd-951e-4027-8a8d-f017bbafde58/runs/54f7f0d8-4704-443a-91cb-f19db53d3dae/model/scene.blend) · [preview](validation/issue26/live/data-KE6lZq/0ea17dcd-951e-4027-8a8d-f017bbafde58/runs/54f7f0d8-4704-443a-91cb-f19db53d3dae/model/preview.png) |
| Object checkpoint fork | `completed` | [GLB](validation/issue26/live/data-KE6lZq/0ea17dcd-951e-4027-8a8d-f017bbafde58/runs/54f7f0d8-4704-443a-91cb-f19db53d3dae/model/model.glb) · [scene](validation/issue26/live/data-KE6lZq/0ea17dcd-951e-4027-8a8d-f017bbafde58/runs/54f7f0d8-4704-443a-91cb-f19db53d3dae/model/scene.blend) · [preview](validation/issue26/live/data-KE6lZq/0ea17dcd-951e-4027-8a8d-f017bbafde58/runs/54f7f0d8-4704-443a-91cb-f19db53d3dae/model/preview.png) |
| Full-body base edit (15% hair width) | `completed` | [GLB](validation/issue26/live/data-KE6lZq/2dc2a8c4-fdca-49a3-8078-7f1198cc3a74/runs/e7ea01e2-219f-44cc-a867-c0a81e36d461/edit/model.glb) · [scene](validation/issue26/live/data-KE6lZq/2dc2a8c4-fdca-49a3-8078-7f1198cc3a74/runs/e7ea01e2-219f-44cc-a867-c0a81e36d461/edit/scene.blend) · [preview](validation/issue26/live/data-KE6lZq/2dc2a8c4-fdca-49a3-8078-7f1198cc3a74/runs/e7ea01e2-219f-44cc-a867-c0a81e36d461/edit/preview.png) |
| Base-checkpoint fork (25% hair width) | `completed` | [GLB](validation/issue26/live/data-KE6lZq/2dc2a8c4-fdca-49a3-8078-7f1198cc3a74/runs/84898582-c9f2-4897-8fe5-64ad460b7724/edit/model.glb) · [scene](validation/issue26/live/data-KE6lZq/2dc2a8c4-fdca-49a3-8078-7f1198cc3a74/runs/84898582-c9f2-4897-8fe5-64ad460b7724/edit/scene.blend) · [preview](validation/issue26/live/data-KE6lZq/2dc2a8c4-fdca-49a3-8078-7f1198cc3a74/runs/84898582-c9f2-4897-8fe5-64ad460b7724/edit/preview.png) |

The object result reopens as 17 meshes and three materials. Its checkpoint fork reuses the model and publishes an independent candidate without overwriting its original run/candidate. The humanoid fixture contains a torso, head, hair, both arms and legs, a six-bone skeleton with skin weights, a Smile expression, UVs and materials. Codex changes only Hair vertex coordinates. Both humanoid candidates pass complete-scene and reopened-GLB preservation checks; Rig, Body, HeadMesh, both arm meshes and both leg meshes remain unchanged. The branch changes width from 15% to 25%, reuses the saved complete-base checkpoint, and leaves the accepted source candidate intact.

The source file stayed unchanged during the live trial, SHA-256:

`58be75aa70d22f094e7d74915fef096bd0b1f1998a5ac30f87c5315190347ead`

[Live execution report](validation/issue26/live/report.json) records run IDs, graph versions, source snapshots, reuse/parent lineage, checkpoints, modeling operations, candidate summaries and artifact paths. Its accompanying data directory retains project state, copied source/baseline, checkpoint records, tasks, audit hashes, scenes, previews, exports and validation JSON. After preservation checks were strengthened, [final artifact recheck](validation/issue26/artifact-recheck/report.json) verified all saved outputs against regenerated baselines from their complete copied base scenes. It records Hair geometry changes separately from unchanged topology and verifies protected pose, bone lengths and UV layer metadata. This recheck consumed no Codex allowance and changed none of the saved scene/GLB files.

## Browser and preservation evidence

- [Fixture browser report](validation/issue26/browser/report.json), [desktop studio](validation/issue26/browser/desktop-studio.png), [connected workflow](validation/issue26/browser/desktop-workflow.png), [comparison](validation/issue26/browser/desktop-comparison.png).
- [Narrow studio](validation/issue26/browser/narrow-studio.png) and [narrow workflow](validation/issue26/browser/narrow-workflow.png): 390px viewport, stacked review controls and graph scrolling contained in its panel; no page overflow. Light / Dark persisted through navigation and reload.
- [Real object browser report](validation/issue26/live-browser/object/report.json) and [real full-body browser report](validation/issue26/live-browser/humanoid/report.json), with their preview/interaction screenshots.
- [Blender preservation report](validation/issue26/blender/report.json) and [measured changed/unchanged evidence](validation/issue26/blender/preservation.json). Unsupported capabilities fail before a candidate checkpoint instead of being silently discarded.
- [Machine-readable verification](validation/issue26/verification.json) and [SHA-256 inventory](validation/issue26/manifest.json) tie the saved evidence to exact bytes.

## Scope of validation

No live text concept/four-view image generation or live **enabled** refinement was repeated in this trial. Those paths use the existing providers/loop and are covered here by deterministic adapter/graph tests, with historical live records in earlier validation documents. The current live object trial uses an uploaded image. Optional supplementary-model rendering/reuse remains covered by existing library tests and earlier live library evidence; these focused live runs used no supplementary model selections.

The representative full-body asset is deliberately small and triangulated, with basic Principled materials and a rest-pose skin rig. This is not a production-character quality assessment or a claim that arbitrary animation rigs, drivers, constraints, VRM extensions or complex material graphs preserve correctly. Unsupported bases block transparently. Broad character evaluations and human aesthetic review remain unperformed optional work; generalized cycles, animation authoring and detailed shader authoring remain outside Issue #26.

See [workflow contracts](workflows.md) for implementation limits and [setup / clean start](local-setup.md#start-fresh) for schema 3. Historical validation bundles are evidence, not supported project migrations. No post-merge verification is required by the Issue.
