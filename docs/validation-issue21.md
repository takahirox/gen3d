# Issue #21 validation — reusable local 3D reference library

Implemented on the assigned GitWeave worktree after merging current `main`
`d30321eedda2`, including the complete #20 MPFB/schema cleanup. No push, PR,
merge to a remote branch, issue comment, allowance reset/purchase or model switch
was performed.

## Automated and browser checks

- `npm test`: **91 passed, 0 failed**. Includes persistent managed/folder entries,
  cross-project 0/1/multiple selection, human approvals and role/permission/content
  invalidation, unsafe names/paths/symlinks, corrupt/unsupported/external resources,
  missing/moved folders/files, 95-model scanning/search/pagination, HTTP/MCP parity,
  actual production reference-load code and per-asset MCP inspection enforcement.
  Both Text and Image with multiple references preserve their required imagery,
  source lineage, retries/revisions, and bounded refinement snapshots/cycles.
- `npm run check` and `git diff --check`: **passed**.
- `npm run test:browser`: **22 checks passed**, no browser exceptions, at desktop
  and 390px. Browser uploads import GLB and .blend once, multi-select, set roles and
  reuse permission, explicitly approve, configure/search/page a 57-entry library,
  show missing folder files, reuse an entry in an Image project and detach to zero.
  Existing concept/view/checkpoint/consistency/revision/refinement/export/history
  and WebGL-failure checks pass. Its Blender inspection and generation providers
  are **injected fixtures**, not proof that an AI used references.

[Check summary](validation/issue21/automated-checks.json),
[browser report](validation/issue21/browser-report.json),
[narrow library dialog](validation/issue21/library-narrow.png).

## Real Blender checks

`npm run test:library-blender`: **passed**, local Blender **5.1.2**. Creates real
self-contained GLB and uncompressed .blend fixtures (with material and shape key),
imports/inspects both formats, rejects a valid-header corrupt file and unpacked
external texture dependencies, loads separate inspection scenes, refuses
inspection-only duplication and copies independent authorized mesh/material/shape
key data. It intentionally links a reference-only object into the deliverable,
then verifies production cleanup excludes it from render, GLB and saved .blend.
Reopening the saved .blend finds exactly one mesh/scene. All source hashes match.

[Blender report and hashes](validation/issue21/blender-report.json),
[GLB source](validation/issue21/sources/style.glb),
[Blender source](validation/issue21/sources/head.blend),
[isolated render](validation/issue21/isolation/preview.png),
[isolated GLB](validation/issue21/isolation/model.glb),
[isolated .blend](validation/issue21/isolation/scene.blend).

`node scripts/refinement-export-check.js`: **passed** with real Blender. Confirms
material/camera changes, fresh/retry resets, existing-scene lineage and four-view
camera framing survive the new reference cleanup. During validation, its ordinary
no-reference fresh/retry fixture exposed overly broad orphan cleanup; cleanup now
purges unused data only when removing reference scenes/objects. The check passed
after that correction. [Exporter report](validation/issue21/refinement-export-report.json).

## Live Codex + Blender modeling

One live trial completed **ready** in **72,923 ms** through the actual production
runner, default subscription Codex configuration and owned local Blender bridge.
Its primary image is the recorded
[stylized cabinet concept](validation/issue10/prop/concept-1/concept.png).
The recorded [cabinet GLB](validation/issue10/prop/model-1/model.glb) was imported
into the managed library and approved for **reuse-edit**. The recorded
[.blend](validation/issue10/prop/model-1/scene.blend) was selected from a configured
folder and approved for **reference-only** proportions/material inspection.

The [MCP audit](validation/issue21/live/mcp-audit.jsonl) records successful
`inspect_reference_model` calls for **both** asset IDs and **19**
`reuse_reference_mesh` calls for the authorized GLB ID only. Codex also inspected
and edited the real geometry/materials through ordinary Blender MCP. Its
[summary](validation/issue21/live/summary.txt) describes the roles used.
[Loaded-source evidence](validation/issue21/live/model-references.json) records the
separate reference scenes, real mesh/material/shape-key inventory and job snapshot.

The resulting scene has **19 deliverable meshes**, **19 authorized reused meshes**,
**one scene**, and **zero reference-tagged objects**. Both original source hashes
remain unchanged. Final human preview approval was intentionally left pending;
no export approval was fabricated. Saved source/render/export artifacts are
reviewable independently in this checkpoint:

- [Live render](validation/issue21/live/preview.png)
- [Live GLB](validation/issue21/live/model.glb)
- [Live .blend](validation/issue21/live/scene.blend)
- [Live report, permissions and hashes](validation/issue21/live-report.json)
- [Actual modeling task](validation/issue21/live/TASK.md)

The live run proves real use of selected GLB/.blend references, permission-aware
reuse, export isolation and unchanged originals for this cabinet. It is **not** a
live Text-to-concept/four-view generation trial or an anime-character aesthetic
comparison. Text/multiple-reference continuity and refinement are covered by
provider-injected tests; subjective style improvement is unmeasured. Compressed
.blend, standalone glTF/FBX, linked libraries and external caches/textures remain
explicitly unsupported; see [format and file boundaries](model-library.md).
