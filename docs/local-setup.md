# Local setup and operation

## Prerequisites and startup

Use Node.js 24+, an installed Codex CLI, a ChatGPT account with Codex access, and Blender 4+ with Cycles and its standard glTF exporter. For text input, the CLI/account must support native image generation (`image_generation` feature). The [official CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli) describes image attachment and structured-output options; this implementation additionally verifies support against the installed CLI and real outputs. The CLI must also support `exec --image`, `--ignore-user-config`, `forced_login_method` and `mcp_servers.<server>.tools.<tool>.approval_mode`; the live validation used Codex 0.161.0 and Blender 5.1.2. Install Codex following its [official CLI setup](https://developers.openai.com/codex/cli), then use `codex login` and confirm `codex login status` reports ChatGPT. gen3d will reject API-key-only login. [Official authentication documentation](https://developers.openai.com/codex/auth) explains the subscription path.

From the repository, run `npm ci`. Start a dedicated Blender process:

```sh
blender -b --python blender/gen3d_bridge.py -- --serve
```

Then run `npm start` in a second terminal and open http://127.0.0.1:3333. `npm start` binds only to loopback. The Blender bridge also binds only to loopback, on port 9877. Both processes must run on the same machine with access to the project directory. Headless rendering uses Cycles on the CPU and requires no interactive GPU viewport.

For interactive Blender instead, install `blender/gen3d_bridge.py` through **Edit → Preferences → Add-ons → Install from Disk** (in recent Blender, under the Add-ons menu). Before enabling it, copy `blender/reference_runtime.py` into the same installed add-on directory as `gen3d_bridge.py` (not just the source/download directory). Enable the add-on, open the 3D View sidebar with **N**, and click **Start gen3d bridge** in the **gen3d** tab. Use a dedicated empty scene: new generation replaces its geometry. Revision opens the selected version's copied scene. The bridge runs Python on Blender's main thread; use it with trusted local clients and modeling instructions.

## Model and review

Create a text/image project from Home and choose creation or editing. The Model studio has sources on the left, an interactive preview and thumbnail history in the center, and Describe / Generate on the right. Use **Sources → Add image / Add 3D model** to attach sources. **Use as reference** adds appearance guidance directly. **More… → Use parts of this model** requires copying consent; **Edit this model → Edit selected parts** chooses the permitted scope visually and enables **Improve**. Exact names and protected features are available on demand. Imported originals stay unchanged. New projects default to automatic continuation across input, concept, four views and preview; text still generates and uses every required view. Image inputs skip concept/view generation. Successful results are immediately inspectable and downloadable. **Four-view check** (text only) and refinement are visible in the studio. New projects warn and continue on contradictions; invalid evidence and inspection errors stop. Optional pauses are visible in **Workflow editor → Review & execution settings**. Enabled gates use **Accept & continue / Reject** in the studio; changing settings never dismisses a waiting review.

The Workflow editor loads either preset, edits supported node settings and typed connections, adds/removes nodes, saves graph revisions and duplicates reusable presets. Click a node to inspect status, saved outputs and actual checkpoint records. Save downstream changes and choose **Branch from here** on an earlier valid checkpoint. Changed dependencies invalidate reuse; original accepted candidates and source branches stay intact. Studio users do not need the graph to run a preset.

Light / Dark uses the same layout and persists in browser storage across navigation/reload. Projects, runs, sources, reviews and artifacts persist on disk. See [workflow contracts, preservation limits and branching](workflows.md). Supported complete bases must pass the initial format roundtrip; unsupported rigs, expressions/material graphs or format capabilities produce a blocker before modeling. Never use reference-only geometry as an implicit editable base.

Optional consistency inspection has On/Stop, On/Warn and continue, and Off modes. Errors or invalid image evidence always block; Warn retains the failed report. Optional refinement is bounded to 1–5 revision cycles and uses existing comparison/change evidence. Its failures, iteration cap and review requests force human review of the last valid candidate. No setting change approves a waiting gate.

## AI-facing MCP

Keep the app server running. Configure a stdio MCP client to launch **an absolute path** to `src/mcp.js` using Node. For example, from the repository:

```sh
codex mcp add gen3d --env GEN3D_URL=http://127.0.0.1:3333 -- node "$PWD/src/mcp.js"
```

For other MCP clients:

```json
{
  "mcpServers": {
    "gen3d": {
      "command": "node",
      "args": ["/absolute/path/to/gen3d/src/mcp.js"],
      "env": { "GEN3D_URL": "http://127.0.0.1:3333" }
    }
  }
}
```

The project MCP server exposes the following tools. Prefer `run_workflow` for both presets and durable node checkpoints; `get_project` returns `workflow`, `workflowRuns`, node statuses, checkpoint files/hashes, lineage and candidate IDs. Base authorization and graph checkpoint approval are human-only; these operations have no MCP approval tool. Lower-level `generate_model` / regeneration tools remain for scripted pipeline operations and cannot bypass an active graph gate.

The project MCP server exposes:

| Tool | Operation |
| --- | --- |
| `list_workflows` | Read typed node catalog and built-in/saved presets |
| `save_workflow`, `save_workflow_preset` | Validate/save a project graph or duplicate a reusable preset |
| `run_workflow` | Start the saved graph; optional `runId` + `checkpointId` forks completed valid ancestors |
| `list_projects`, `get_project` | Read checkpoint/consistency settings, inspection statuses, warnings/reports/outcomes, input review, concepts/selection, reference sets/views/selection, consistency reports, reviews, linked model versions, artifact paths and history |
| `create_project`, `update_project` | Create a text/image project or change its name/prompt/profile and consistency settings |
| `add_reference` | Stage an image data URL for human review |
| `generate_model` | Start text→concept→views→inspection→model or image→model, retry or revision; poll `get_project` |
| `regenerate_concept` | Generate another text concept; pending concepts must first be rejected in the Web UI |
| `regenerate_reference_set` | Generate new views from the selected base; pending sets must first be rejected in the Web UI |
| `get_reference_image` | Read actual base/view image content by image ID, including prior and partial sets |
| `review_model` | Record review when human preview checkpoint is disabled; enabled reviews require the Web UI |
| `export_model` | Obtain GLB, Blender-scene and rendered-view download URLs |

Resources `gen3d://projects` and `gen3d://projects/{projectId}` expose the same JSON state. MCP calls proxy the HTTP service; they do not open a second independent store. Mutations are tagged `mcp` in activity; web mutations are tagged `web`. The UI polls the shared service every 1.5 seconds. A simple check is to use `update_project` to rename a project while its UI is open, then save instructions in the UI and read them using `get_project`.

The Web UI owns human checkpoint decisions and changes to checkpoint settings on existing projects. MCP can set initial settings in `create_project`, inspect all review state/history and request work, but cannot bypass enabled checkpoints.

The **project MCP** interface manages workflow state. The separate **Blender MCP** interface (`src/blender-mcp.js`) provides `get_scene_info` and `execute_blender_code` to the app's Codex modeling session. A Generate/Revise action authorizes those two operations in the dedicated scene for that job; the runner sets explicit per-tool approval settings, leaves the shell sandbox at `workspace-write`, and does not alter the user's global Codex configuration. See [official MCP configuration](https://developers.openai.com/codex/mcp).

## Persistence and configuration

The [local 3D model library](model-library.md) supports reusable managed imports, configured folder sources and per-project multi-selection with human inspection/reuse approval. It is stored in `<dataDir>/library/`, shared across projects. External source folders are never removed when clearing managed project data.

The default store is `~/.gen3d/`. Project schema is **3**; older schemas stop startup with a clean-start diagnostic. Each project has `project.json`, input/reference images and `runs/<runId>/<nodeId>/` containing immutable typed checkpoints and saved artifacts. Candidate metadata/reviews live in the shared `versions` collection. Saved reusable presets live in `workflow-presets.json`. Old lower-level pipeline directories can still occur through scripted operations. Successful MCP operation names and code hashes are audited; raw Codex streams and credentials are not served. The repository’s `.gen3d/` is ignored development data.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEN3D_DATA_DIR` | `~/.gen3d` | Server's project storage directory |
| `GEN3D_PORT` | `3333` | Local app port |
| `GEN3D_BLENDER_PORT` | `9877` | Dedicated bridge port; set for both Blender and server |
| `GEN3D_BLENDER_BIN` | `blender` | Local Blender binary for model-library inspection |
| `GEN3D_CODEX_BIN` | `codex` | Path to the installed CLI executable |
| `GEN3D_URL` | `http://127.0.0.1:3333` | App URL used by project MCP/browser check |

Only one server may own a data directory. Modeling is serialized globally across projects because Blender has one current scene. Each modeling job uses a fresh Codex session with the prompt, required base and all views/upload image, optional references and selected scene as its context. gen3d uses the CLI default subscription model, does not load unrelated global user MCP integrations/hooks, and does not alter credentials. Shell execution remains sandboxed; Blender Python executes inside the dedicated Blender process.

## Start fresh

This is an intentional breaking change. Use an empty gen3d data store; old projects, reports and generated state are unsupported. There is no migration, import, backfill or automatic deletion on startup. An unsupported `project.json` stops startup with a clean-start error.

1. Stop the gen3d server and its project MCP clients. Wait for any active job to finish so it cannot recreate deleted data.
2. Confirm the exact store used by the server: `~/.gen3d` by default, or the resolved `GEN3D_DATA_DIR` configured for that server. Check its contents before deleting anything.
3. If the directory is dedicated exclusively to gen3d, remove it explicitly. For the default store only:

   ```sh
   rm -r -- "$HOME/.gen3d"
   ```

   For a custom store, replace that path with its verified absolute path. Do not run a recursive deletion on a shared directory, a home directory, an external asset library or an arbitrary user folder. If unrelated files coexist in the custom store, remove only the confirmed gen3d project directories (UUID directories containing `project.json` and their managed artifacts) and the stopped server's `server.lock`; leave unrelated files untouched. Alternatively point `GEN3D_DATA_DIR` to a new empty directory dedicated to gen3d.
4. At the gen3d app's own origin (for example `http://127.0.0.1:3333`), remove only its saved browser project selection in the developer console:

   ```js
   localStorage.removeItem('gen3d-project');
   // Optional: reset only gen3d’s display preference.
   localStorage.removeItem('gen3d-theme');
   ```

   Reload the page after restarting the server. Do not clear all browser data or storage for other apps.
5. Start the server with the intended `GEN3D_DATA_DIR`, create a new text or image project, and choose its review, consistency and refinement settings.

Resetting gen3d application data discards its projects, reviews and generated artifacts. It never requires uninstalling user-installed Blender add-ons (including standalone MPFB), deleting third-party assets or changing Blender preferences. gen3d does not perform any of those operations.

## Failures and checks

- **Image generation unavailable:** the failed concept or reference set records a specific blocker and zero modeling jobs are launched. Verify `codex features list` and a real `codex exec` image task with ChatGPT login; feature announcements or an enabled flag alone do not establish account capability. There is no direct-text, paid-API or synthetic-image fallback. See [Issue #10 validation](validation-issue10.md).
- **Consistency failure:** Stop retains the failed report and blocks modeling. Warn and continue retains a visible warning and failed report, then permits the valid image set to proceed after any required human approval. Regenerate views to fix contradictions. Off intentionally skips inspection; it does not bypass artifact or review checks.
- **Inspection error:** an unavailable inspector, crash or malformed report is recorded as `error` and blocks modeling in both On modes. Deliberate regeneration uses the current project settings.
- **Bridge unavailable:** start Blender with the bridge, check that both processes use the same port, and retry manually.
- **Codex login/CLI incompatibility:** run `codex login status` and `codex exec --help`; install a CLI with the options above. Failed versions show the final Codex summary when available.
- **Usage limit:** gen3d stops the job and blocks further generation in that server session. It never redeems reset tickets, buys allowance, changes providers/models, or retries. Continue only after allowance is available through your normal account process.
- **Interrupted server:** unfinished graph runs/nodes recover as interrupted, while lower-level pipeline jobs recover as failed. Completed checkpoints and pending human reviews persist; explicitly fork a valid completed checkpoint to resume. Useful completed versions remain intact. A graceful shutdown waits for the current job before releasing the store lock. If the server was forcibly killed, stop its leftover Codex process and wait for Blender to finish any pending command before restarting.
- **WebGL unavailable:** the rendered preview and GLB/scene downloads remain available. Use a browser with WebGL enabled for orbit/pan/zoom.
- **Quality:** this MVP produces agent-authored mesh models with basic materials. Subject likeness and topology depend on the prompt and Codex output. Use review/revision; animation authoring, broad rig-format conversion and advanced topology are outside this slice; existing supported base rigs are preserved and validated.

Run `npm test`, `npm run check` and `git diff --check` for deterministic checks. Run `npm run test:browser` for the isolated graph/studio browser regression (Chrome/Chromium required; set `GEN3D_CHROME_BIN` if needed). It starts disposable local server/browser state with injected providers and replays recorded images/models; it never invokes Codex/Blender or spends allowance. Screenshots and a JSON report go to `.gen3d/studio-browser-check/`, or the directory set by `GEN3D_BROWSER_OUTPUT`. See [Issue #26 validation](validation-issue26.md) for current coverage and visual evidence. Tests inject synthetic artifacts solely to exercise workflow behavior; the production entry point always uses the real runner.

For an optional live browser check, start an isolated Chrome with remote debugging on port 9333 and a disposable user-data directory, then run:

```sh
GEN3D_PROJECT_ID=<project-uuid> node scripts/browser-check.js
```

Set `GEN3D_CHROME_URL` for a different debugging port, `GEN3D_VERSION_ID` for an earlier completed version, and `GEN3D_BROWSER_OUTPUT` for the screenshot/report directory. The check verifies actual GLB loading/download and changed screenshots after orbit, pan and zoom; it does not launch generation or spend Codex allowance. Live generation itself requires an authenticated subscription and running Blender. See [Issue #10 validation actually performed](validation-issue10.md) and [historical MVP evidence](validation.md).

## Optional visual refinement

Choose **Refine** on a ready candidate to start a bounded comparison/revision branch from its saved model. The dialog explains allowance cost and offers 1–5 cycles. To configure future runs, use **Workflow editor → Review & execution settings**, or edit a refine node; refinement defaults Off. Each comparison/revision consumes the local ChatGPT Codex allowance. All jobs retain original approved references and checkpoints. See [refinement settings, stop reasons, artifacts and API](refinement.md) and [Issue #18 validation](validation-issue18.md).

Run `npm run test:workflow-blender` for real complete-base copying, rig/weights/expression/UV/material retention, reopened GLB evidence and deliberate protection failures. It creates a representative fixture in `.gen3d/workflow-blender-check/` without using Codex. Then `npm run validate:workflow-live` runs focused object/base-edit graphs and checkpoint branches through actual Codex + Blender MCP, consuming subscription allowance. It stops on the first usage limit without retries. Keep fixture/mock browser results separate from those actual outputs.

To recheck the committed live evidence without spending allowance, run `GEN3D_WORKFLOW_ARTIFACT_INPUT=docs/validation/issue26/live npm run test:workflow-artifacts`. It reopens all saved scene/GLB pairs with the current validator and checks their hashes.
