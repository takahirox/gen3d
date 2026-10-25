# Issue #34 validation

Validated on 2026-10-25.

- `npm test`: **137 passed**, zero failed or skipped. Covers the lower-level pipeline and graph execution, HTTP and a real local MCP client, saved presets/overrides, malformed reports/views, source permissions, review gates, preservation blockers and policy-sensitive checkpoint reuse.
- `npm run check`: **passed**.
- `GEN3D_BROWSER_OUTPUT=docs/validation/issue34/browser npm run test:browser`: **31 checks passed**, zero browser exceptions. [Browser report](validation/issue34/browser/report.json).
- `git diff --check`: **passed**.

The browser uses real headless Chrome, the local HTTP server and an interactive Three.js viewer at 1440 × 1050 and 390 × 844. Image generation, consistency inspection, modeling and preservation are injected providers using recorded assets. These checks do **not** constitute a real Codex/Blender generation or preservation trial. The optional live Codex + Blender trial and standalone Blender checks were not run; no modeling/runtime Blender code changed and no generation allowance was consumed.

## Behavior and layout audit

The new default retains a failed contradiction report and all four generated views while continuing to an exportable model. Off skips only optional inspection; explicit project/node Stop policies block contradictions. Execution/parsing errors, missing/wrong/duplicate/mislinked views, invalid images, permission violations and protected-base failures remain blockers. Saved runs and waiting approvals retain their captured settings; changing policy does not restart or approve them. Policy changes preserve reusable concept/views checkpoints and invalidate checked views/downstream outputs; fully overridden defaults preserve valid reuse.

The studio directly exposes source-add actions, reference profile, Four-view check and relevant refinement controls. Image-only input hides the four-view policy; workflows without refinement hide its control. Review settings are directly visible in the editor. Raw graph JSON, exact hashes, checkpoint internals and protected-feature exceptions remain on demand. Workflow overrides and differing saved-run policies are shown beside the project choice.

Browser coverage includes all three policy selections and reload persistence, a default allowed warning, explicit Stop/Off execution, a node Stop overriding project Off, unchanged stopped/waiting snapshots, human-only approvals, text/image context, focus restoration, the policy's accessible name in Chrome's accessibility tree, keyboard controls, both themes and narrow-width overflow checks.

## Recorded screenshots

- [Initial studio controls](validation/issue34/browser/desktop-empty.png)
- [Default warning, desktop Dark](validation/issue34/browser/policy-warning-desktop-dark.png) / [Light](validation/issue34/browser/policy-warning-desktop-light.png)
- [Warning report and original views](validation/issue34/browser/policy-warning-details.png)
- [Project Off with workflow Stop override and differing saved run](validation/issue34/browser/policy-node-override.png)
- [Narrow Dark](validation/issue34/browser/policy-warning-narrow-dark.png) / [Light](validation/issue34/browser/policy-warning-narrow-light.png) / [warning details](validation/issue34/browser/policy-warning-narrow-details.png)
- [Visible editor settings, desktop](validation/issue34/browser/desktop-workflow.png) / [narrow](validation/issue34/browser/narrow-workflow.png)
