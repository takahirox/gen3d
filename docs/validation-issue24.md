# Issue #24 validation

Validated locally on 2026-10-10 with Node, the installed Codex CLI authenticated
through ChatGPT, and `/Applications/Blender.app/Contents/MacOS/Blender`.
No paid API, reset ticket, allowance purchase, provider/model switch, push or
GitHub comment was used.

## Checks actually performed

| Check | Result |
| --- | --- |
| `npm test` | 97 tests passed, zero failed/skipped |
| `npm run check` | Passed |
| Python compilation and relevant local Markdown links | Passed |
| `npm run test:browser` | Passed desktop and 390px checks, including versioned role/permission sheets loading in source history; providers/sheets injected |
| `npm run test:library-blender` with local Blender binary | Passed real imports, packed files, independent mesh/material/shape-key/node-group/image copies, permission refusal, source hashes and export isolation |
| Semantic edit/export check in the Blender script | Shape-key value 0.7 and controlled Z scaling, independent Displacement texture and optional Subdivision Surface; real GLB reimport matched evaluated vertex positions and triangle counts; rendered and reopened `.blend` |
| Invalid modifier/dependency cases | Source-object Mirror dependency and empty Mask result explicitly rejected |
| `npm run validate:library-live` with local Blender binary | Genuine four-GLB Codex generation and one bounded refinement cycle completed; final preview review remains pending |
| Saved-scene reuse/adaptation check | 19 surviving permitted meshes have changed world-space geometry compared with the original approved source |
| `git diff --cached --check` | Passed before commit |

Unit coverage includes 0/1/4/32 selections, original image preservation, ordered
contact-sheet attachments, camera/image mapping, changed/missing/blank render errors,
33-reference rejection before Codex, bounded Blender requests despite large saved inspections, inspection-before-modeling, permission and
suitability guards, actual surviving reuse provenance, role report validation and
comparison attachment order. Existing refinement cap, stop, review, usage-limit,
text concept/four-view and revision tests remain passing. The 32-selection check
uses a simulated Blender renderer; no large live performance trial was run.

Real Blender evidence: [report](validation/issue24/blender/report.json),
[render](validation/issue24/blender/preview.png),
[GLB](validation/issue24/blender/model.glb),
[scene](validation/issue24/blender/scene.blend).
Browser evidence: [report](validation/issue24/browser-report.json) and
[narrow reference history](validation/issue24/reference-sheets-narrow.png).

## Genuine Codex + Blender trial

The trial exported four distinct example GLBs from the recorded cabinet scene:
[body](validation/issue24/live/sources/body.glb),
[doors](validation/issue24/live/sources/doors.glb),
[hardware](validation/issue24/live/sources/hardware.glb) and
[feet](validation/issue24/live/sources/feet.glb). Body was approved for reuse/edit;
the three other role-specific assets were approved for visual inspection only.
The primary input was the original cabinet image, with an instruction to adapt
the reusable cabinet to be eight percent taller while preserving its design.

The final trial took **301,025 ms**. All four assets have eight saved material
views and an identifiable contact sheet, attached alongside the original upload
to modeling and both comparisons. Audits show all four structural inspections
and suitability choices before modeling. Codex reused all 19 body meshes and
adapted their world-space geometry; no reference-only geometry was incorporated.
All four source hashes remained unchanged. Reopening the selected final `.blend`
found one scene, zero inspection objects and 19 permitted reused meshes.

The initial comparison reported material and camera discrepancies, including
role-specific hardware/feet color feedback. The same-scene revision changed
exported materials and camera framing (`materialsChanged: true`,
`cameraChanged: true`, `geometryChanged: false`) and was freshly compared with
all original inputs and reference sheets. The **one-cycle cap** stopped the loop
with `iteration-limit`: pale colors, weak wood texture, knob/foot size and camera
differences remained reported. This proves the integration and bounded feedback
path ran; **no visual quality improvement or anime likeness is claimed**.
No human A/B comparison, live text image-generation trial or cross-version
Blender performance test was performed.

[Trial report](validation/issue24/live/report.json),
[actual reuse/adaptation](validation/issue24/live/reuse-adaptation.json), and
[saved project/history](validation/issue24/live/project/project.json).
The version directory retains input attachment manifests, all per-asset renders,
source/camera mappings, suitability/provenance records, modeling tasks, sanitized
MCP audits, comparison reports and initial/refined GLB/`.blend` files. Absolute
temporary job paths in copied comparison manifests were replaced with project
relative paths; model images/geometry and source hashes are unchanged.

Earlier validation exposed and fixed a missing renderer import, SVG raster sizing
and incomplete saved-render whitelisting during refinement. The final four-GLB
trial completed after those fixes. Its observed audit order also satisfies the
subsequently added enforced inspection-before-modeling guard. No automatic
usage-limit retries occurred.
