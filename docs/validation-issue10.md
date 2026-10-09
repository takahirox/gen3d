# Validation for Issue #10

Executed on 2026-10-09 in the assigned worktree on macOS with Node 24.12.0, Codex CLI 0.161.0 signed in using ChatGPT, and Blender 5.1.2 in an isolated dedicated bridge. Native subscription image generation is exercised directly; no paid image/LLM API, third-party 3D service, reset ticket, allowance purchase or model/provider switch is used.

## Automated checks

`npm ci` succeeded with zero reported vulnerabilities. `npm test` passes **36 tests**. `npm run check` and whitespace checks pass.

The tests use injected providers, synthetic PNG/GLB/scene fixtures and mocked Codex/Blender operations. The HTTP service and SDK stdio MCP client run for real in the shared-state tests; they do not establish native image-generation or modeling quality.

Focused coverage includes:

- Character/object profiles and replacement providers with labeled left/right side views, exact source-concept image input, distinct required views, typed provenance and persistence.
- Input, concept, multi-view and preview transitions; explicit Web UI decisions; pending review surviving restart and checkpoint setting changes.
- Rejected/regenerated sets and immutable image/model history; source concept/set reuse in historical revisions.
- Missing, duplicate, malformed, unavailable and interrupted views; partial valid outputs remain accessible. A failed replacement set cannot fall back silently to an older set.
- Independent consistency inspection with the base and every view, structured reports, contradictions that cannot be approved away, and inspection failures that block modeling.
- Provider substitution without changing Blender modeling; providers lacking the multi-view method block text modeling.
- The actual `realGenerate` boundary with a mocked process runner/Blender transport: text receives exactly five required `--image` attachments (base plus four views), image input receives one. Missing/tampered sets fail before CLI/Blender calls. The model records the exact input list and view metadata.
- Shared HTTP/MCP images, statuses, reviews, consistency reports, regeneration/history and model linkage, including MCP image content rather than only URLs.
- Usage failures during concept, views, inspection and modeling stop subsequent generation without automatic retries or switches; final native-tool allowance reports also stop the process. Already produced valid images remain accessible.
- Existing image upload, revisions, version history, preview/export gating, GLB validation, concurrency and shutdown/store ownership.

## Live checks

These used the production `CodexConceptGenerator`, independent `CodexReferenceInspector`, runner, Blender MCP and HTTP server. Browser operations used isolated headless Chrome 154.0.8037.99 with WebGL. Review/regeneration UI actions were automated validation interactions, not a human assessment of artistic quality.

| Operation | Actual result | Evidence |
| --- | --- | --- |
| Object: native base plus front/left-side/back/three-quarter set 1 | Four distinct whole-object images saved. Inspection reported side-orientation mismatch; zero modeling jobs | [Base](validation/issue10/prop/concept-1/concept.png), [set 1 report](validation/issue10/prop/set-1/consistency.json), [browser](validation/issue10/prop-inconsistent-browser/references.png) |
| Regenerate object set 2 through the Web UI | Same base retained. Inspection caught a side panel rendered as “front” and an added side rail; modeling remained blocked | [Set 2 report](validation/issue10/prop/set-2/consistency.json), [UI regeneration](validation/issue10/object-regenerate-browser/report.json) |
| Regenerate object set 3 with the final provider prompt; all checkpoints disabled | Consistency passed; automatically modeled from the base plus all four views. 19 meshes, real Blender scene/render and 212,100-byte GLB | [Front](validation/issue10/prop/set-3/front.png), [left side](validation/issue10/prop/set-3/side.png), [back](validation/issue10/prop/set-3/back.png), [three-quarter](validation/issue10/prop/set-3/three-quarter.png), [inspection](validation/issue10/prop/set-3/consistency.json), [model task](validation/issue10/prop/model-1/TASK.md), [Blender MCP audit](validation/issue10/prop/model-1/mcp-audit.jsonl), [GLB](validation/issue10/prop/model-1/model.glb), [scene](validation/issue10/prop/model-1/scene.blend) |
| Character: native base plus four full-body views; regenerate after back-boot contradiction | Second set passed inspection and remained pending at the enabled multi-view checkpoint; zero model versions | [Base](validation/issue10/character/concept-1/concept.png), [front](validation/issue10/character/set-2/front.png), [left side](validation/issue10/character/set-2/side.png), [back](validation/issue10/character/set-2/back.png), [three-quarter](validation/issue10/character/set-2/three-quarter.png), [inspection](validation/issue10/character/set-2/consistency.json), [pending browser](validation/issue10/character-final-pending-browser/references.png) |
| Disable the character multi-view setting in the UI, then restart the server | Pending set retained its original enabled checkpoint. Modeling returned HTTP 409 before and after restart. Explicit acceptance remained available in the UI; MCP could neither continue nor regenerate the pending set | [Setting change](validation/issue10/character-pending-browser/report.json), [before restart](validation/issue10/pending-before-restart.json), [after restart](validation/issue10/final-report.json), [MCP shared state](validation/issue10/mcp-shared-state.json) |
| Upload the real cabinet concept as an image input, with concept/multi-view settings enabled | Zero concepts and zero generated sets; modeled directly from the upload. 20 meshes, real scene/render and 268,612-byte GLB | [Upload](validation/issue10/image/input.png), [task](validation/issue10/image/model-1/TASK.md), [MCP audit](validation/issue10/image/model-1/mcp-audit.jsonl), [GLB](validation/issue10/image/model-1/model.glb), [scene](validation/issue10/image/model-1/scene.blend), [browser](validation/issue10/image-browser/preview.png) |

The object’s final view generation/inspection took 248.077 s and modeling/export took 79.438 s. The character’s second set generation/inspection took 261.151 s; its human review remains deliberately pending. Image-input modeling/export took 57.477 s. Source concepts and every previous reference-image hash remained unchanged across regeneration; [follow-up](validation/issue10/followup-report.json) and [final](validation/issue10/final-report.json) records contain those comparisons.

The final provider prompt explicitly defines side orientation and reiterates the requested output angle **after** retry feedback. Live set 2 demonstrated why feedback about one angle must not override another angle’s output. Set 3 exercised that final prompt successfully. Earlier inconsistent sets and their reports remain committed, rather than being overwritten or relabeled as successful.

The real SDK stdio MCP client matched HTTP/project-resource JSON for all three projects. `get_reference_image` returned the same actual PNG bytes as HTTP for all **22 generated images** (two bases and twenty views, including rejected sets). Both real models exported through MCP. The text model records reference set 3 and exactly five input files; the production CLI attaches those files through repeated `--image` flags, with their labels in the task. Native output receipts record requested tool/authentication, actual output and parent image paths; they are receipts, not native-tool transcripts.

Both GLBs loaded in the Web UI and downloaded with matching hashes. Orbit, pan and zoom changed the previews; no JavaScript exceptions were reported. The object browser displayed and loaded its base and all **12 views across three sets**, including the automatic run’s intermediate images; the character browser displayed its base and all eight historical/current views. Browser reports: [object](validation/issue10/prop-browser/report.json), [image input](validation/issue10/image-browser/report.json), [pending character](validation/issue10/character-final-pending-browser/report.json).

The [complete report and artifact manifest](validation/issue10/report.json) retain profiles, prompts, typed image provenance, checkpoints/reviews, decisions/activity, consistency reports and model linkage, with source/evidence hashes and file mappings. Paths in text evidence are sanitized to `<worktree>`; image/model bytes are unchanged. Runtime URLs refer to the disposable validation server; committed artifacts remain independently accessible. Raw CLI streams and credentials are excluded.

## Limits and post-merge checks

Explicit approval and ensuing modeling at the enabled multi-view checkpoint, live revisions, malformed/unavailable provider behavior and usage-limit handling are covered by deterministic tests rather than additional live runs. No actual usage limit was encountered. Other accounts, CLI releases, operating systems and the interactive Blender add-on are not validated. The consistency check is a pragmatic Codex visual judgment and can produce false positives or miss errors; reported inconsistencies block modeling and retain the agreed base for deliberate regeneration. No advanced scoring/repair system is claimed. No required post-merge verification is specified by the issue.
