# Issue #38 validation

Blender 5.1.2 and Node 26.12.1 were used locally. All modeling in this validation is a deterministic mesh edit; no Codex generation, external asset, paid service or provider allowance was used.

## Reproduction

`baseline-reproduction.json` records the real baseline failure against commit `2d67b35fad2cbbcc02c641cf142f971a9a7527e3`: `Protected GLB export requires a rest pose: mixamorig:Spine`.

The fixture is maintained in `scripts/posed-rig-check.py`: a rolled spine, parent/child hierarchy, nonidentity translation and two bone rotations, two independently named skinned triangle meshes, mixed 0.3/0.7 weights, UV seams, basic material, mesh placement, and a non-bone object ancestor. To reproduce the old failure:

```sh
mkdir -p .gen3d
git show 2d67b35fad2cbbcc02c641cf142f971a9a7527e3:blender/preservation.py > .gen3d/issue38-baseline.py
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/posed-rig-check.py -- --baseline .gen3d/issue38-baseline.py
```

## Roundtrip strategy and results

The default Blender exporter drops the static pose when animations are disabled. Selecting current-pose export alone preserves appearance but the default importer can choose that pose as the new rest frame. Neither is acceptable protection evidence. The implementation exports posed joints with the original inverse binds, declares the existing skeleton ancestor, imports with inverse-bind reconstruction, and independently measures the imported rest matrices, posed joints, weights and visible skinned triangles against the raw GLB. Scene/GLB comparison also protects corner normals and the existing scene features. No pose/rest/mesh conversion is performed on the source.

`blender-report.json` records the full existing regression suite and the additional posed tests. Both packed `.blend` and posed `.glb` prepare, make complete protected copies, accept a measurable Hair-only edit, reopen candidate scenes/GLBs and re-export/reimport again. Body geometry, original bones, pose and weights remain protected. Euler-to-quaternion representation equivalence passes without granting edit rights. An additional scaled-bone case passes. Missing optional skeleton metadata is inferred only from an unambiguous existing named armature ancestor in a temporary import copy; source hashes stay unchanged.

The 31 negative cases reject spine/child pose changes, hierarchy/bind changes, skin weights, protected geometry, unauthorized bone parenting of the editable mesh, REST display mode, a no-op, an inconsistent exported pose, default-export pose loss, export-only inverse-bind mutation, 0.0001-unit export surface drift, constraints, drivers (object and armature data), authored action/NLA animation, and missing inverse binds. Stale success reports are removed on failure. Existing rest-pose, expression/mask, inheritance, visibility, skin-binding, shading, winding, normals, UV and material tests still pass.

`source-scene-evidence.json` retains the fixture's original raw rest/pose/parenting/skin and evaluated surface measurements. `posed-source.glb` and `posed-edited.glb` are compact inspectable outputs. Bone authoring lengths and the exact saved-scene basis remain protected in `.blend`; GLB carries the verified static joint/bind/skin representation rather than Blender authoring controls. Rigs without an unambiguous reconstructible bind frame, incompatible inheritance/evaluation, animation/constraints/drivers, unsupported extensions or the existing shape-key limitations still block. This is not a claim of arbitrary humanoid/animation format support. Old prepared baselines lacking the new measured fields fail closed and should be prepared again with this version.

The real Store/workflow test in `scripts/posed-workflow-check.js` exercises the production preparation, exporter, candidate validation, persisted human scope and export gate. Posed `.blend` and `.glb` runs complete with one authorization; a constrained base fails before the deterministic modeler is called and produces no base checkpoint. Library source hashes remain unchanged. The ordinary workflow unit suite additionally checks that failed pose preflight retains authorization without modeling or publishing a checkpoint.

## Commands

- `npm test`: **passed**, 138 tests, zero failures.
- `npm run check`: **passed**.
- `npm run test:workflow-blender`: **passed**, real Blender, existing regressions plus posed fixtures and real Store/workflow preparation/export/validation.
- `npm run test:library-blender`: **passed**, real Blender; summarized in `library-report.json`.
- `GEN3D_BROWSER_POSED_FIXTURES=.gen3d/workflow-blender-check/posed npm run test:browser`: **passed**, 36 checks and zero uncaught exceptions; recorded in `checks.json` and `browser-report.json`.

The optional browser cases exercise **Edit this model → Edit selected parts → Improve** for both posed formats, with real Blender preparation, production export/render and preservation. The modeler is deterministic; surrounding provider and asset-inspection callbacks are fixtures. The part preview uses the posed GLB, while the separate real Store test performs real asset inspection. Existing browser cases retain their injected providers and cover permissions, shared Web/MCP state, reviews, layout and failures. No live Codex generation is claimed.
