# Issue #18 validation

Validation performed on 2026-10-10 (JST), using Node.js 24+, ChatGPT-authenticated local Codex CLI 0.162.0 and Blender 5.1.2. See [refinement behavior and settings](refinement.md).

## Automated checks

- `npm test`: **116 passed, 0 failed** (includes 14 focused refinement tests and existing compatibility coverage).
- `npm run check`: passed, including the new inspector and live validation script.
- `npm run test:browser`: passed with injected provider/model fixtures. The recorded [browser report](validation/issue18/browser/report.json) labels these as fixtures, not live modeling. It covers Off defaults, saved On/maximum cycles, original reference/cycle renders, report access, mesh-change evidence, final human approval, existing reviews and exports, and desktop/narrow layouts. [Refinement history screenshot](validation/issue18/browser/refinement-history.png) and [narrow layout](validation/issue18/browser/refinement-narrow.png).
- Whitespace and local documentation links: checked before commit.

Focused coverage includes settings validation, atomic edits, persistence/migration, Off compatibility, initial pass, actual revision orchestration, scene-copy lineage, separate original/revised artifacts and instructions, scratch/MPFB mode preservation, mesh-change guard, iteration cap, missing/corrupt-view/report failures, modeling/inspection/usage failures, topology rejection, partial artifact recovery and publication, interrupted server recovery, review interruption at each operation boundary, original multi-view/supplementary reference attachment, observable/uncertain categories and truthful verdicts, all human review gates, real HTTP/MCP clients reading shared reports/settings/images, and a failed Codex turn preserving available Blender output without retrying the turn. Modeling and inspection are injected in these tests. Mesh changes in fixture tests are simulated; the live scratch run below supplies real geometry evidence.

An in-progress artifact test exposed that native filesystem notifications could miss an immediate file creation. The runner now polls only known cycle files during the operation, persists newly discovered artifact paths, and stops that polling at the operation boundary. The full suite passed after this correction. The inspector uses bounded structured output; models/providers/allowance are never switched/reset to complete a test.

## Live scratch: original uploaded image

Ran `scripts/refinement-validation.js` against the saved original [Issue #8 robot upload](validation/issue18/scratch/original.png), with scratch modeling, refinement On, maximum one revision cycle and final preview review enabled. A dedicated bridge ran on loopback port 19877. No reference image was generated or substituted.

The production runner completed initial Codex modeling → Blender render/export → separate Codex comparison of the original upload and corresponding input render → saved instructions → reopening/correcting the existing scene through Blender MCP → fresh render/export and re-evaluation. Both turns recorded successful Blender MCP operations. The mesh hashes differ and cycle 1 records `geometryChanged: true`. The last model remained `ready`, with final human review **pending** and exports gated. Elapsed time: **219,360 ms**. No usage limit occurred.

The stop outcome was **`iteration-limit`**, with unresolved framing, arm-silhouette and washed-out-material discrepancies. This run demonstrates loop execution, scene continuity, real geometry modification, exports and truthful bounded stopping. It does **not** demonstrate a proven visual quality improvement or a passing final comparison. The severe overexposure remains visible in the retained renders; do not infer aesthetic success from the successful job/export status.

- [Side-by-side original / initial / revised renders](validation/issue18/comparisons.html)
- [Live run report](validation/issue18/scratch/report.json) and [shared project state snapshot](validation/issue18/scratch/project-state.json)
- [Initial structured comparison](validation/issue18/scratch/initial/comparison.json), [initial scene](validation/issue18/scratch/initial/scene.blend), [initial GLB](validation/issue18/scratch/initial/model.glb)
- [Executed revision instructions](validation/issue18/scratch/cycle-1/REVISION.md), [fresh structured comparison](validation/issue18/scratch/cycle-1/comparison.json), [revised scene](validation/issue18/scratch/cycle-1/scene.blend), [revised GLB](validation/issue18/scratch/cycle-1/model.glb)

Saved cycle folders also contain the evaluation tasks/schemas, modeling tasks/summaries, successful MCP audit, camera provenance and mesh hashes. The snapshot preserves the live project's original manifest paths; artifact copies in this evidence directory are organized as `initial` and `cycle-1` for review.

## Live MPFB: original concept and multi-view references

Ran the production runner with MPFB enabled and the original saved [Issue #16 concept/four-view references](validation/issue18/mpfb/references/concept.png), replayed through the existing text/concept/view flow without generating replacements. The existing consistency inspector passed the full set; the explicitly configured Warn and continue policy was not needed to override any contradiction. Refinement was On, maximum one revision cycle, with final preview review enabled.

Initial MPFB creation used the local `HumanService.create_human` API. The loop compared the original base concept plus front, labeled left side, back and three-quarter images to all four model renders, revised the copied existing scene, exported fresh renders/scenes/GLBs, and re-evaluated every view. Cycle 1 records a real changed mesh hash. MPFB verification retained **19,158 body vertices, 18,486 body polygons and the original topology hash**, with `topologyPreserved: true`. The version was `ready`, with final human review **pending**. Elapsed time: **892,493 ms**. No usage limit occurred.

The outcome was **`iteration-limit`**, with unresolved hair, face, body-shape, clothing, materials and camera differences. This trial verifies real MPFB scene revision and bounded stopping; it does not prove better likeness or visual quality. It also exposed a defect in the initial fixed side/three-quarter cameras. Those original renders and reports remain unchanged in the evidence.

- [Live MPFB report](validation/issue18/mpfb/report.json) and [shared state snapshot](validation/issue18/mpfb/project-state.json)
- [Initial comparison](validation/issue18/mpfb/initial/comparison.json), [executed revision instructions](validation/issue18/mpfb/cycle-1/REVISION.md), [fresh comparison](validation/issue18/mpfb/cycle-1/comparison.json)
- [Initial MPFB verification](validation/issue18/mpfb/initial/mpfb.json), [revised verification](validation/issue18/mpfb/cycle-1/mpfb.json), [revised scene](validation/issue18/mpfb/cycle-1/scene.blend) and [GLB](validation/issue18/mpfb/cycle-1/model.glb)
- All original/initial/revised per-view images are displayed in the [comparison page](validation/issue18/comparisons.html).

## Camera correction and live renderer follow-up

The final implementation requires the initial modeler to inspect every original view and save a per-view direction map, which subsequent scene revisions may update. It no longer assumes a fixed side/three-quarter sign and elevation. It also avoids overwriting a required aligned render with a generic character comparison render.

After both complete live loop trials, a separate real Blender check reopened the initial MPFB scene with scripts disabled. Running the corrected exporter without the required camera map raised the expected explicit error; its partial scene/model/preview remain saved under `camera-followup/missing`. The validation agent then supplied front `[0,-1,0]`, side `[-1,0,0]`, back `[0,1,0]` and three-quarter `[-1,-1,0.05]`, chosen after inspecting the original references. The corrected exporter honored all four directions, rendered all four PNGs, produced valid GLB/Blender artifacts, and retained the original evaluated mesh hash exactly. This was camera validation, **not** another geometry refinement cycle.

A fresh real Codex inspection received all five original reference images and all four corrected renders together. It reported broadly correct view directions but still found body, face/hair, clothing/shoe and material discrepancies. No pass or measured improvement is claimed. See the [follow-up report](validation/issue18/camera-followup/report.json), [fresh structured comparison](validation/issue18/camera-followup/aligned/comparison.json) and [recorded directions](validation/issue18/camera-followup/aligned/cameras.json). The comparison page includes each original, earlier fixed-camera render, and corrected-camera render.

The full MPFB generation/refinement trial preceded this camera correction; the corrected renderer and separate real comparison were exercised afterward. A new complete MPFB generation with Codex choosing the new map was not rerun. Unit tests cover the revised modeling prompt and preserved scene-map/render boundary.

## Limits

AI judgments are subjective and camera alignment is approximate, without calibrated cameras, geometric measurements or quantitative quality scores. Material/camera-only edits without mesh changes are not counted as geometry refinement; the review follow-up below allows them to proceed using the corresponding evidence. No real allowance was exhausted; usage-limit/error scenarios were tested with local synthetic errors. Other operating systems, hardware profiles and interactive Blender add-on UI were not exercised. Optional human aesthetic comparison is not a completed check. No post-merge verification was requested.

## Review fixes for Issue #18

Fixed the three blocking review findings: verification now follows structured geometry/material/camera revision targets, saved per-view scale/target-center overrides survive export and scene reopen, and historical scene/model inspection links work during running and failed jobs while final downloads retain approval checks.

- `npm test`: **119 passed, 0 failed**, including **17** focused refinement tests. New synthetic cases exercise material-only and camera-only cycles in scratch and MPFB modes with `geometryChanged: false`, require every requested change, reject unrelated mesh changes or missing/invalid camera evidence, and accept older material-only reports.
- `npm run check`: passed.
- `npm run test:browser`: passed. The [new fixture report](validation/issue18/review-fixes/browser-report.json) includes fetching the actual DOM-generated GLB/Blender history links during a running job, after its initial failure and before preview approval. Inspection returned HTTP 200; final download attempts remained blocked (400 for running/failed versions, 409 for unapproved ready versions).
- `node scripts/refinement-export-check.js`: passed with real Blender 5.1.2, using deterministic edits and the production exporter. A material-only change and a camera-only change each changed the input render while all five stage mesh hashes stayed identical. Scale **42** and target center **[1, 2, 3]** remained in fresh camera renders and after reopening/exporting the saved scene. All four reference views honored independent scale/center overrides. Invalid overrides failed explicitly. See the [Blender report](validation/issue18/review-fixes/blender-report.json) and [initial](validation/issue18/review-fixes/initial.png), [material edit](validation/issue18/review-fixes/material.png), and [camera edit](validation/issue18/review-fixes/camera.png) renders.

These follow-up checks did not run a fresh authenticated Codex modeling/visual-inspection trial. The runner/MPFB cases and browser cases use injected outputs; the exporter check uses real Blender. They verify corrections and retained gates, without claiming aesthetic improvement or a human approval result.

## Fresh-job framing reset follow-up

Fresh generation and retry now clear `gen3d_reference_camera_framing` alongside camera directions, preventing a shared Blender scene from carrying another project's optional center/scale overrides into new comparison renders. Existing-scene revisions preserve the saved overrides.

- `npm test`: **120 passed, 0 failed**. The added mocked runner regression exercises consecutive projects, retry and an existing-scene revision through the production modeling boundary.
- `npm run check`: passed.
- `node scripts/refinement-export-check.js`: passed with real Blender **5.1.2**. The check captures the production preparation code with mocked authentication/image validation, then executes it and the production exporter in Blender. A revision retained scale **42** and center **[1, 2, 3]**. Subsequent generation and retry cleared both direction properties and framing, then rendered a new cube without framing overrides at the bounds-based scale **2.6** and center **[0, 0, 0]**. See the [saved Blender report](validation/issue18/framing-reset/blender-report.json).

No Codex modeling/inspection turn or human visual review was performed for this reset fix; these checks establish state isolation and framing behavior without claiming visual quality improvement.
