# Issue #12 validation

Validated on 2026-10-09 in the assigned worktree using Node.js 24.12.0. No required post-merge verification.

## Automated checks

- `npm ci`: succeeded; no vulnerabilities reported.
- `npm test`: 84 tests passed, zero failed/skipped. This includes existing workflows and new coverage for On + Stop, On + Warn and continue, Off, inspection crashes/unavailable tools/malformed reports, missing/invalid images and altered provenance/attachments, checkpoint approval across settings changes/restart, persisted settings and failed reports after a real HTTP server restart, shared HTTP/MCP tools/resources/history, retry/revision source snapshots, regeneration with changed settings, usage limits and interrupted inspection recovery.
- `npm run check`: passed.
- `git diff --check`: passed.

Automated modeling checks use synthetic artifacts and mocked CLI/Blender calls. They assert the exact five image attachments at the final modeling boundary; they do not demonstrate real model generation.

### Publication after image-validation fix

On 2026-10-09, publication validation after commit `d16c612` ran `npm ci` (zero reported vulnerabilities), `npm test` (86 passed, zero failed/skipped), `npm run check`, and `git diff 3f11d54 HEAD --check`; all passed. The additional regressions cover decoding PNG/JPEG/WebP and rejecting signature-preserving truncation/corruption before inspection/modeling in every consistency mode and at the final modeling boundary. Original image bytes are preserved for modeling inputs.

The browser and live Codex/Blender checks recorded below preceded this image-validation fix and were not rerun during publication. No fresh image generation or live consistency inspection was performed during publication.

## Browser checks

A disposable headless Google Chrome profile used the actual HTTP server and Web UI with synthetic reference-image fixtures, an injected failed inspection, and copied historical model artifacts. These checks verified:

- New-project defaults are On + Stop; both settings can be selected and saved.
- The failure selector is disabled when Off and retains its saved preference.
- Existing-project settings can be edited and survive page reload.
- Warn mode shows the failed inspection, warning, report link, model warning and continuation history.
- Off calls no inspector and shows skipped status.
- Off with multi-view review enabled pauses without creating a model; explicit **Accept views & model** resumes.
- No browser runtime exceptions were observed.

Evidence: [browser report](validation/issue12/ui-report.json), [warning screenshot](validation/issue12/ui-warning.png), [Off awaiting human review](validation/issue12/ui-off-review.png). These screenshots use fixture references and a historical model; they are not screenshots of the new live generation runs below.

## Live Codex + Blender modeling

Two modeling runs used the installed subscription-authenticated Codex CLI and a newly launched dedicated headless Blender bridge on a separate loopback port. Both reused the same saved real base concept and four reference images from Issue #10 (`prop/concept-1` and `prop/set-3`); no fresh images were generated. The warning report was deliberately injected to test the continuation path deterministically. A live consistency inspection was not performed.

| Mode | Inspection | Actual modeling result |
| --- | --- | --- |
| On + Warn and continue | Injected failed report; one inspector call | Ready; 20 meshes; 352,652-byte GLB; five image inputs; continuation warning/history recorded |
| Off | Skipped; zero inspector calls | Ready; 19 meshes; 202,780-byte GLB; five image inputs |

Both passed the app's GLB/Blender-scene/render validation and successful Blender MCP modeling audit check. Export was available. The saved report records effective policies, statuses, warnings, relevant history, identical input-image hashes and GLB hashes. No allowance limit was encountered; no reset tickets, purchases, provider/model switches or automatic retries were used.

Evidence: [live report](validation/issue12/live-report.json), [warning-mode task](validation/issue12/warn/TASK.md), [warning-mode MCP audit](validation/issue12/warn/mcp-audit.jsonl), [warning-mode GLB](validation/issue12/warn/model.glb), [warning-mode render](validation/issue12/warn/preview.png), [Off task](validation/issue12/off/TASK.md), [Off MCP audit](validation/issue12/off/mcp-audit.jsonl), [Off GLB](validation/issue12/off/model.glb), [Off render](validation/issue12/off/preview.png).

On + Stop blocking and all failure/gating cases were validated by automated tests, not an additional live Codex run. Fresh native concept/view generation and a live consistency inspector were not rerun for this settings change. Existing native generation/inspection behavior remains covered by the prior validation and current automated tests.
