# MVP validation for Issue #6

Validation was performed on 2026-10-08 in the assigned worktree, using macOS, Node 24.12.0, Codex CLI 0.161.0 authenticated with ChatGPT, Blender 5.1.2 in a dedicated headless process, and isolated headless Chrome 154.0.8037.99 with software WebGL. No separately billed LLM/image API or third-party 3D-generation SaaS was used. No allowance reset, purchase or provider/model switch was performed.

## Real end-to-end results

The production HTTP server and Codex runner were used for all three results. Codex's successful Blender MCP calls were recorded by the bundled MCP server; actual GLB, Blender scene and PNG files were validated and published by the app. These are real geometry outputs, not test fixtures.

| Input / operation | Result | Time to ready | Evidence |
| --- | --- | --- | --- |
| Text: rounded teal clay robot, cream head, dark eyes, orange arms, sturdy legs | 11 meshes; saved scene, rendered PNG and 228,588-byte GLB | 76.560 s | [Browser](validation/demo/text-browser.png), [GLB](validation/demo/text-model.glb), [scene](validation/demo/text-scene.blend), [render](validation/demo/text-preview.png), [MCP audit](validation/demo/text-mcp-audit.jsonl) |
| Revision: longer orange arms and vivid blue torso, retaining head/eyes/legs | 11 meshes; revised scene, render and 228,796-byte GLB | 47.306 s | [Browser](validation/demo/revision-browser.png), [GLB](validation/demo/revision-model.glb), [scene](validation/demo/revision-scene.blend), [render](validation/demo/revision-preview.png), [MCP audit](validation/demo/revision-mcp-audit.jsonl) |
| Image upload: robot PNG; only the generic instruction “Create a 3D model of the subject in the input image.” | 11 meshes; new scene, render and 406,384-byte GLB | 64.309 s | [Input](validation/demo/image-input.png), [browser](validation/demo/image-browser.png), [GLB](validation/demo/image-model.glb), [scene](validation/demo/image-scene.blend), [render](validation/demo/image-preview.png), [MCP audit](validation/demo/image-mcp-audit.jsonl) |

The image was uploaded through the actual web file input with the description left empty; generation was started using its Generate button. The image is the rendered text result used as an independent uploaded image project. The application does not require a text stage before image input. Codex received the PNG through `exec --image`, analyzed it, and authored fresh Blender mesh geometry and materials.

Revision feedback was submitted through the UI. Its first invocation exposed an image-argument parsing bug; after the fix, the same feedback and source version were resubmitted through the web API. The revised GLB and browser show longer arms and a blue torso. The exported material changed from `TealClay` to `VividBlueClay` for the torso. The original GLB SHA-256 remained `035298c9b0e2de9de146cc9eb38ca79278c72d314bd7f3dae7d9f11f733f98d8`; the revision's source scene copy exactly matches the original saved scene, and the original render remained unchanged. The original model's approval was retained. Reopening the original `.blend` in Blender with scripts disabled succeeded.

The [machine-readable report](validation/demo/report.json) records project/version IDs, prompt snapshots, feedback, source/reference IDs, durations, successful MCP operation names, artifact sizes/hashes, preservation checks and browser results. Task snapshots and MCP audits are included alongside the model artifacts. Runtime download URLs in that historical report refer to the local validation server; the linked committed artifacts above remain available independently.

## Browser and shared MCP state

`scripts/browser-check.js` loaded each real completed GLB in Chrome, downloaded it through the UI's GLB URL, and verified its header/hash. Mouse orbit, right-drag pan and wheel zoom each changed the captured preview. All three browser checks passed with no JavaScript exceptions. [Text](validation/demo/text-orbit-pan-zoom.png), [revision](validation/demo/revision-orbit-pan-zoom.png) and [image](validation/demo/image-orbit-pan-zoom.png) screenshots record the changed views. The screenshots were also visually inspected for the expected robot geometry and revision.

A real SDK MCP client launched `src/mcp.js` over stdio against the same running app server. It renamed the text project; the open browser title changed to **MCP renamed · clay robot**. Modeling instructions were then changed and saved through the UI; `get_project` returned the updated prompt. Both operations appeared in shared activity history with their respective actors.

That MCP client staged a reference using `add_reference`. The image appeared in the browser with a pending review. A `generate_model` request returned an error while review was pending. Clicking **Approve reference** in the UI enabled the workflow, and the approved reference ID was included in the revision snapshot. Clicking **Approve** for the original model persisted its decision. This demonstrates review of an AI-supplied image before use; the runner itself does not internally generate/gather reference images, and the initial text result needed no image capability.

## Automated and static checks

- `npm ci`: installed the locked dependencies successfully; npm reported zero vulnerabilities.
- `npm test`: **11 tests passed**. Coverage includes alternative input persistence/validation, reference gating, source-copy revisions and branches, prompt/artifact preservation, global Blender serialization, failures/manual retry, usage-limit termination, restart recovery/store ownership, HTTP validation/origin/host/artifact boundaries, a real stdio MCP client sharing API state, MCP resources and export URLs, CLI image/auth arguments, and compressed Blender/artifact validation.
- `npm run check`: JavaScript syntax checks passed for all application modules and the browser-check script.
- `python3 -m py_compile blender/gen3d_bridge.py`: passed.
- Local Markdown link checks and `git diff --cached --check`: passed.

Workflow unit tests deliberately inject synthetic artifacts; they exercise state behavior and do not prove modeling. The live results above use the production runner and real Blender. Usage-limit tests use local synthetic child-process errors; no real allowance limit was encountered or bypassed during validation.

## Failures found and corrected

1. Noninteractive Codex initially refused MCP operations because their approval mode was unspecified. The runner now scopes explicit approval to the two authorized Blender modeling tools for the job and keeps shell execution at `workspace-write`.
2. Blender 5.1 initially saved a Zstandard-compressed `.blend` that the first validator rejected after real geometry/export succeeded. The validator now supports raw, Zstandard and gzip scene headers; new exports explicitly request uncompressed scenes. Regression checks cover both compressed forms.
3. An approved reference exposed that Codex's variadic `--image` option consumed the positional prompt as an image filename. The runner now inserts `--` before the prompt. The later reference-backed revision and independent image-only generation both succeeded.

Failed candidates remained in local history, and each new attempt used a fresh version directory. The real text result is version 4 and its successful revision is version 6; the image project completed on its first generation. The record does not count failed attempts as passing demonstrations.

## Unperformed checks and remaining limits

The optional interactive Blender add-on panel was not exercised; the documented primary headless bridge, real main-thread Python execution, scene reopening, CPU rendering and GLB export were exercised. Other operating systems/browsers and subjective production-quality topology/likeness were not validated. They are not required post-merge checks for this Issue. There is no pending mandatory post-merge verification.
