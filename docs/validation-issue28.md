# Issue #28 validation

The Model studio now uses sources / interactive preview / current action columns,
with a compact thumbnail strip. Project details are optional; execution settings,
node records, hashes, graph JSON and refinement comparisons live in the Workflow
editor. Light and Dark use the same components and responsive layout.

New projects default input, concept, four-view and preview pauses to Off. Text
still generates the concept and all four required modeling views. Automatic
continuation uses the existing scheduler and system review policy; it does not
invent a human decision. Source reuse and complete-base scope still require
separate explicit human authorization before execution. Existing runs retain their
snapshotted settings and real human decisions.

## Checks performed

| Command | Result | What it exercises |
| --- | --- | --- |
| `npm test` | 122 passed, zero failed | Default text/image execution and export, required references, immutable checkpoints, manual reviews, source permissions, preservation gates, bounded refinement, branching/restart and shared HTTP/MCP state |
| `npm run check` | Passed | Repository JavaScript syntax checks |
| `GEN3D_BROWSER_OUTPUT=docs/validation/issue28/browser npm run test:browser` | 21 grouped checks passed; zero uncaught browser exceptions | Real headless Chrome and WebGL, injected image/model/inspection/Blender responses, recorded GLB assets |
| `GEN3D_WORKFLOW_BLENDER_OUTPUT=docs/validation/issue28/blender npm run test:workflow-blender` | 135 checks passed | Real local Blender; complete base copy, permitted Hair edit, scene/GLB roundtrip and deliberate protected-feature violations |
| `git diff --cached --check` | Passed | Staged whitespace checks, including new documentation |

The first two full unit runs failed at the native `model-reference-visuals.test.js`
module boundary without a diagnostic (other tests passed). Its seven isolated
checks passed, and the subsequent full `npm test` passed all 122 tests. No cause
is asserted. During browser development, the expanded harness exposed timing and
fixture issues and the image-to-text dialog reset and repeat-refinement paths
were corrected before the final passing run. The browser harness explicitly
injects the runner's Blender calls; the separate Blender report is real execution.

## Browser coverage

The [machine-readable browser report](validation/issue28/browser/report.json)
records every grouped assertion. The check covers:

- Creating text and image projects through the UI, optional project names,
  Generate from Model studio, required concept/four-view outputs for text, and
  zero human-review decisions in default runs. Creating text after an image
  project does not accidentally require another image upload.
- Actual GLB loading and GLB/.blend download responses, source/render comparison,
  preparation-image inspection, candidate thumbnails, keyboard selection/focus,
  Restore, Retry with valid preparation reuse, and explicit Accept.
- In-place supplementary image selection, library import and reuse/edit consent,
  pending MCP-proposed permissions blocking generation, and HTTP denials when MCP
  attempts source approval or editable-base authorization.
- Selecting an existing complete-base source and exact editable parts in the
  studio, separately authorizing scope, then Improve reaching preview. The
  browser's preservation evidence is synthetic; real protection validation is
  covered by the independent Blender check.
- On-demand refinement with an allowance notice and cycle bound, original-model
  checkpoint reuse, and another real scheduler refinement node when refining an
  already refined candidate. Every prior checkpoint remains intact.
- Explicit manual input/concept/four-view/preview pauses, four audited web
  approvals, export blocking before preview approval, MCP review denial, and
  changing future settings without approving the waiting run.
- Stop consistency, incomplete views, failed image/model tools, required
  preservation failure, and an injected usage limit. These stop visibly; the
  usage-limit case disables generation and does not retry. Explicit Warn and
  continue retains its failed report and a visible contextual warning.
- Workflow editor access, actual node settings, graph save, preset duplication,
  typed rewiring/removal, checkpoint branching and valid ancestor reuse.
- Identical Light/Dark navigation and components, theme persistence across
  navigation/reload, 1440 × 1050 desktop columns, 390 × 844 stacked controls,
  contained graph scrolling, no page overflow, accessible control names, and
  keyboard activation of view controls and graph nodes.

## Screenshot evidence

| Surface | Evidence |
| --- | --- |
| Desktop Model studio, Dark | [Screenshot](validation/issue28/browser/desktop-studio-dark.png) |
| Desktop Model studio, Light | [Screenshot](validation/issue28/browser/desktop-studio-light.png) |
| Narrow Model studio, Dark | [Screenshot](validation/issue28/browser/narrow-studio-dark.png) |
| Narrow Model studio, Light | [Screenshot](validation/issue28/browser/narrow-studio-light.png) |
| Empty Model studio | [Screenshot](validation/issue28/browser/desktop-empty.png) |
| Explicit base consent | [Screenshot](validation/issue28/browser/desktop-base-consent.png) |
| Manual concept pause | [Screenshot](validation/issue28/browser/desktop-manual-review.png) |
| Source/render comparison | [Screenshot](validation/issue28/browser/desktop-comparison.png) |
| Desktop Workflow editor | [Screenshot](validation/issue28/browser/desktop-workflow.png) |
| Narrow Workflow editor | [Screenshot](validation/issue28/browser/narrow-workflow.png) |

Screenshots show replayed fixture models, not newly generated Codex output.
The [real Blender report](validation/issue28/blender-report.json) retains all 135
checks, measured preservation/deformation evidence and the unchanged source hash.
Large regenerated fixture binaries are omitted; the check command regenerates them.

No new real Codex + Blender generation or informal human first-use walkthrough was
performed. Those are optional supplements. No allowance was purchased, reset or
bypassed. No post-merge verification is required by this Issue.
