# Stage-based studio validation for Issue #14

Validated on 2026-10-09 with Node 24.12.0 and headless Chrome on macOS. This redesign changes browser presentation and browser validation only; server APIs, persisted project schema, Codex image generation, consistency policy, Blender modeling and MCP semantics are unchanged.

## Checks performed

- `npm test`: **94 tests passed**, including eight presentation-state tests for automatic intermediates, checkpoints, failures/warnings, revision reviews and changed input. Existing HTTP/MCP/workflow tests passed unchanged.
- `npm run check`: passed, including the new state module and browser regression script.
- `GEN3D_BROWSER_OUTPUT=docs/validation/issue14 npm run test:browser`: **17 check groups passed**, with no browser JavaScript exceptions. The machine-readable [report](validation/issue14/report.json) lists every group.
- `git diff --cached --check`: passed. Local documentation/evidence links were checked.

The deterministic browser regression starts a disposable server and Chrome profile. It injects fixture concept/view/inspection/model providers through the existing `createApp` interface and replays committed Issue #10 images, GLB, render, scene and audit assets. It does **not** run live Codex or Blender, spend allowance, or establish new model-generation quality. The existing optional `scripts/browser-check.js` was also exercised against these fixtures after adapting it to browse every concept and view set through the stage selectors. No fresh live generation was necessary for this frontend-only change; historical live pipeline evidence remains in the earlier validation documents.

## Browser coverage

| Area | Verified behavior |
| --- | --- |
| Workspace and automatic flow | Four text stages, one visible stage panel, dominant GLB viewer, completed concepts/views accessible after uninterrupted generation, explicit source links and GLB/.blend exports |
| Review checkpoints | Input acceptance; concept/view approval, rejection and feedback regeneration; pending preview blocks exports; changing a checkpoint does not dismiss an existing review; model rejection/retry |
| Artifacts and revisions | Earlier concept/view candidates and model versions selectable; revision requests work; selected older model and render remain stable while MCP publishes a new version; historical image selection survives polling |
| Consistency | Stop blocks acceptance and exposes issues/report; Warn and continue shows the saved warning and derived-model warning; Off disables the failure selector and records skipped inspection; changed settings do not rewrite existing outcomes |
| Shared state | MCP header edits, background generation, supplementary uploads and activity become visible through polling; unsaved local edits remain intact; refresh restores project selection; edited input offers a new workflow while retaining old artifacts |
| Image input | Project creation and file upload through the actual browser dialog, reduced Input → 3D path and supplementary human review |
| 3D and failures | Orbit, pan, zoom, fit, rendered preview, downloads, generation errors, inspection errors, partial view artifacts, failed GLB loading and WebGL fallback |
| Accessibility and responsiveness | 390px stage navigation without horizontal page overflow; keyboard Tab/Enter navigation and retained focus; Escape dismisses modal; discoverable history/settings shortcuts focus their expanded summaries; disconnection/reconnection status |

## Visual evidence

Screenshots use the replayed cabinet artifacts, not newly generated models. They were visually inspected for workspace hierarchy, readable controls, comparable modeling views and narrow-screen usability.

| Viewport | 3D workspace | Multi-view workspace |
| --- | --- | --- |
| Desktop, 1440 × 1050 | [Desktop model](validation/issue14/desktop-model.png) | [Desktop views](validation/issue14/desktop-views.png) |
| Narrow, 390 × 844 | [Narrow model](validation/issue14/narrow-model.png) | [Narrow views](validation/issue14/narrow-views.png) |

Run `npm run test:browser` to reproduce the browser checks. Set `GEN3D_CHROME_BIN` to a Chrome/Chromium executable if automatic discovery is insufficient. Default evidence output is `.gen3d/studio-browser-check/`; `GEN3D_BROWSER_OUTPUT` overrides it. The script removes its disposable server data and Chrome profile on completion.

Issue #14 requires no post-merge verification.
