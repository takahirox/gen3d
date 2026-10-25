# Issue #32 — direct source actions and visual edit scope

Validated on 2026-10-25 with Node 24.12.0, desktop Chrome, and local Blender.
No Codex generation, external generation service, usage reset, or allowance
purchase was used.

## Changes verified

The studio keeps Sources / Preview / Describe, with one **+ Add** affordance.
Project cards show a name and available preview; source thumbnails no longer
repeat approval/status captions. Ordinary ready states and empty-history help
are removed. Source use is available through contextual actions; workflow
settings, technical records, exact part names and feature exceptions stay on
demand. Image alternatives, source-use descriptions, live progress/errors,
keyboard controls and focus indicators remain available.

**Use as reference** inspects, validates, selects and audits only that one asset
in one server transaction. It does not copy geometry. Uploading alone grants
nothing. **Use parts of this model** requires a contextual copying-rights
confirmation and stores the precise intended use. Pending MCP proposals remain
pending until a human chooses their use; selecting another source never approves
them. Changing use, removing an image/model, changing edit scope and removing an
editable source retain prior version evidence and shared library assets.

**Edit this model** opens a read-only orbitable preview. Clicking geometry or
selecting numbered parts with the keyboard chooses exact original mesh names;
focus/hover highlights the corresponding geometry. **Edit selected parts** stores
explicit full-base scope. Ordinary existing creation projects switch to
**Improve** while retaining graph settings. Ambiguous custom graphs continue to
use the advanced Workflow editor. Other parts/features remain protected unless
explicit exceptions are enabled. Cancelling grants nothing. Missing visual
mapping/preview failure produces a warning and leaves exact names available.
The display GLB is never used as the base, exported result, or preservation proof.

## Actual checks

| Command | Outcome |
| --- | --- |
| Unchanged `npm run test:browser` | 25 checks passed; before screenshots captured |
| `npm test` | Initially passed; later default parallel runs intermittently reported only a child-file failure for `model-reference-visuals.test.js`, without a cause/diagnostic |
| `node --test tests/model-reference-visuals.test.js` | All 7 tests passed independently |
| `npm test -- --test-reporter=tap` | All 132 tests passed |
| `npm test -- --test-concurrency=1` | All 132 tests passed |
| `npm run check` | Passed, including the new visual picker module |
| `GEN3D_BROWSER_OUTPUT=.gen3d/issue32-after npm run test:browser` | 26 checks passed, zero uncaught browser exceptions |
| `GEN3D_BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender GEN3D_LIBRARY_OUTPUT=.gen3d/issue32-blender npm run test:library-blender` | Passed with real Blender; no Codex |
| `git diff --check` | Passed |

The intermittent parallel child-process exit was not reproduced in the isolated
suite or the complete TAP run; its cause is undetermined. No test was removed or
skipped to obtain the final passing results.

The browser uses injected image/model/Blender/preservation providers and recorded
GLBs. It checks new text/image projects, supplementary images, upload without
rights, keyboard direct-reference selection, copy consent/cancellation, source
changes/removal, exact base scope, cancelling/reopening the visual picker,
existing-project editing, immutable earlier scopes after base removal, generated
result controls, comparison, refine/retry/accept/export, checkpoint inspection
and branching. It also retains regression checks for optional manual review,
MCP denial, preservation failures, incomplete views, tool errors, usage-limit
stops without retries, and project deletion.

At 1440×1050 and 390×844 it exercises Light/Dark studio layouts and source
selection, page/modal overflow, native modal Escape/focus restoration, keyboard
part selection and view controls. Browser assertions inspect accessible names
and reference/copy/edit distinctions; no real screen-reader user study was run.
Real Blender checks separately exercise GLB and packed `.blend` picker exports,
exact mesh-name mapping, cached source-hashed previews, unchanged source bytes,
reference-only reuse denial, actual mesh reuse and exported artifact checks.
There was no real Codex modeling or live preservation-generation run. Informal
first-use observation was not performed (optional).

Reports: [before browser](validation/issue32/before-browser-report.json),
[after browser](validation/issue32/after-browser-report.json),
[real Blender](validation/issue32/blender-report.json).

## Actual screenshots

These are Chrome captures of the existing and changed UI with deterministic
providers, not design mockups. The additional before chooser capture used a
temporary screenshot variant of the unchanged browser script, intentionally
stopped immediately after capture. That temporary script was removed.

| Surface | Before | After |
| --- | --- | --- |
| Empty studio | [Before](validation/issue32/before/desktop-empty.png) | [After](validation/issue32/after/desktop-empty.png) |
| Generated model | [Before](validation/issue32/before/desktop-studio.png) | [After](validation/issue32/after/desktop-studio.png) |
| Source chooser | [Before](validation/issue32/before/desktop-asset-selection.png) | [After](validation/issue32/after/desktop-asset-selection.png) |

Additional captures: [copy consent](validation/issue32/after/desktop-copy-consent.png),
[visual edit scope](validation/issue32/after/desktop-base-consent.png),
[desktop Light](validation/issue32/after/desktop-studio-light.png),
[desktop Dark](validation/issue32/after/desktop-studio-dark.png),
[narrow Light](validation/issue32/after/narrow-studio-light.png),
[narrow Dark](validation/issue32/after/narrow-studio-dark.png),
[narrow chooser Light](validation/issue32/after/narrow-asset-selection-light.png),
[narrow chooser Dark](validation/issue32/after/narrow-asset-selection-dark.png).

No post-merge verification is required by the Issue.

## Review regression: unsaved workflow settings when switching to editing

The added Chrome regression first reproduced the reported defect: after applying
node instructions without saving the graph, choosing an editable base and clicking
Improve executed a creation node. The conversion now uses the active draft and
synchronizes it with the saved edit graph. The passing regression checks the
executed edit node, retained instructions, base connection, selected asset, exact
protected scope, candidate feedback and synthetic preservation result.

After the fix, `npm test` passed all 132 tests, `npm run check` passed, and
`GEN3D_BROWSER_OUTPUT=.gen3d/issue32-draft-regression-after npm run test:browser`
passed all 27 checks with zero uncaught browser exceptions. `git diff --check`
passed. This run used injected providers and recorded GLBs; no real Codex
generation or Blender preservation run was performed for this regression.
