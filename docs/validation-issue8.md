# Validation for Issue #8

Executed on 2026-10-08 in the assigned worktree, using macOS, Node 24.12.0, Codex CLI 0.161.0 signed in with ChatGPT, Blender 5.1.2 in a dedicated headless bridge, and isolated Chrome 154.0.8037.99 with software WebGL. These runs used the production server, native Codex concept generator and Blender MCP runner. No separately billed image/LLM API, third-party 3D service, allowance reset/purchase or model/provider switch was used.

## Real concept-to-model validation

The account/CLI capability was established by executing image generation, rather than inferred from the feature flag or announcements. [Official image-generation documentation](https://learn.chatgpt.com/docs/image-generation) describes the built-in subscription path; [pricing documentation](https://learn.chatgpt.com/docs/pricing#image-generation-usage-limits) explains its shared usage limits. Actual access on other accounts/CLI releases still requires a real run.

| Operation | Actual result | Generation time | Evidence |
| --- | --- | --- | --- |
| Text: small teal clay robot, cream round head, dark eyes, orange arms and sturdy legs | Real 1,987,370-byte concept PNG; paused, zero model versions | 57.393 s | [Concept 1](validation/issue8/concept-1-concept.png), [pending review in browser](validation/issue8/concept-review-browser.png) |
| Reject concept and regenerate with rounded-torso feedback through the UI | Rejected first concept retained; new 1,850,371-byte PNG; paused, still zero model versions | 50.314 s | [Concept 2](validation/issue8/concept-2-concept.png), [generator task](validation/issue8/concept-2-TASK.md), [output metadata](validation/issue8/concept-2-image-generation.json) |
| Accept concept 2 in the UI, then model from it | 35 meshes, real Blender scene, render and 1,145,592-byte GLB; paused for preview approval | 129.979 s | [Text browser](validation/issue8/text-browser/preview.png), [GLB](validation/issue8/text-model.glb), [scene](validation/issue8/text-scene.blend), [modeling task](validation/issue8/text-TASK.md), [Blender MCP audit](validation/issue8/text-mcp-audit.jsonl) |
| Uploaded image with generic modeling instructions, input/preview checkpoints disabled and concept setting enabled | Zero concepts; directly modeled uploaded image; 12 meshes and 316,356-byte GLB; automatic preview acceptance | 129.562 s | [Upload](validation/issue8/image-input.png), [image browser](validation/issue8/image-browser/preview.png), [GLB](validation/issue8/image-model.glb), [scene](validation/issue8/image-scene.blend), [MCP audit](validation/issue8/image-mcp-audit.jsonl) |
| Revision requested through real gen3d MCP: longer orange arms and vivid blue torso | Same source concept, copied original scene, 35 meshes and 1,145,892-byte GLB; approved through UI | 65.678 s | [Revision browser](validation/issue8/revision-browser/preview.png), [GLB](validation/issue8/revision-model.glb), [scene](validation/issue8/revision-scene.blend), [MCP audit](validation/issue8/revision-mcp-audit.jsonl) |

The full [machine-readable report](validation/issue8/report.json) records inputs, checkpoint settings, selected concepts, prompt/feedback snapshots, derived concept/model IDs, decisions and activity, durations, artifact sizes/hashes and material colors. Concept output metadata records the requested native tool, authentication mode and saved file; it is an output receipt, not a transcript of native tool calls. Raw CLI streams and credentials are excluded.

The concept is the first modeling image, passed through `codex exec --image`; original text remains supplementary context. Both real text models record concept 2's ID and image path. Their task snapshots explicitly require modeling that image. The fresh model's segmented arms, open claws and ear shapes match the generated image; the revision retains that subject and changes the requested geometry/material. The exported revision contains `Clay • vivid blue torso` with RGBA approximately `(0.015, 0.19, 0.8, 1)`.

Original scene, GLB, render, task and audit hashes remained unchanged after revision. The source scene copy exactly matches the original. Original GLB SHA-256: `1d3c891a28f973f7084033e35791e9eea029a153e15c143780d42d1e12d1dc0f`; revision: `4c04a23835b62e42e71f4f4eae9e71e91667ca558c8c39721abb163f402689c2`.

## Checkpoints, browser and shared state

An enabled input checkpoint returned HTTP 409 before any concept/model job; explicit input acceptance permitted concept generation. The UI displayed a pending concept and disabled the workflow button. Rejection and regeneration were performed through browser buttons/forms without generating any 3D version. Accepting the second concept started modeling. A clean server restart while concept review was pending preserved the checkpoint.

A completed text model with preview review enabled kept further generation and downloads disabled. UI approval enabled export. The image-only project had input/preview review disabled, automatically advanced and recorded acceptance; its enabled concept setting was ignored because it was an image project.

The real SDK stdio MCP client read exactly the same JSON as HTTP `get_project` and the project resource, including both concept reviews, selection, derived model ID and history. It exported the approved original and renamed the project; the revised browser displayed the MCP-updated name. [Shared-state evidence](validation/issue8/mcp-shared-state.json) records those comparisons. The revision was requested through that MCP connection.

All three GLBs loaded in the Web UI and downloaded with matching hashes. Orbit, pan and zoom changed the rendered views; there were no JavaScript exceptions. Browser reports: [text](validation/issue8/text-browser/report.json), [image](validation/issue8/image-browser/report.json), [revision](validation/issue8/revision-browser/report.json). Runtime URLs in reports refer to the disposable validation server; the committed artifacts remain independently available. The screenshots were visually inspected.

## Automated validation and limits

`npm ci` succeeded with zero reported vulnerabilities. `npm test` passed **22 tests**; `npm run check` and whitespace checks passed. The workflow tests use synthetic images/geometry and injected generators solely to test transitions; they do not establish real image generation or modeling.

Tests cover mandatory concept generation and the final Blender image boundary; input/concept/preview gating; explicit rejection and regeneration; immutable artifacts and revision branches; automatic continuation when checkpoints are disabled; image input skipping concepts; unavailable/invalid generators; native-image allowance errors; interrupted concepts; migration of historical text projects; HTTP/MCP shared concepts, resources and history; human-only decisions and checkpoint changes; export gating; subscription login/environment/CLI arguments; concurrency and store ownership.

A replaceable generator object is exercised without changing the modeling flow. Concept-review-disabled automatic continuation, unavailable-account behavior, usage-limit handling and changing settings while reviews are pending are covered by deterministic tests, not live failures or a separate live concept-review-disabled run. No actual usage limit was encountered. Other accounts, CLI versions, operating systems and the interactive Blender add-on were not validated. No mandatory post-merge verification remains.

The initial standalone capability probe produced a real PNG but a preliminary validator incorrectly required a distinct image-call JSONL event. CLI 0.161.0 did not emit that event. The final provider validates the actual saved PNG instead; both production concept attempts above passed. No synthetic substitute or paid fallback was added.
