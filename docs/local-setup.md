# Local setup and operation

## Prerequisites and startup

Use Node.js 24+, an installed Codex CLI, a ChatGPT account with Codex access, and Blender 4+ with Cycles and its standard glTF exporter. For text input, the CLI/account must support native image generation (`image_generation` feature). The [official CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli) describes image attachment and structured-output options; this implementation additionally verifies support against the installed CLI and real outputs. The CLI must also support `exec --image`, `--ignore-user-config`, `forced_login_method` and `mcp_servers.<server>.tools.<tool>.approval_mode`; the live validation used Codex 0.161.0 and Blender 5.1.2. Install Codex following its [official CLI setup](https://developers.openai.com/codex/cli), then use `codex login` and confirm `codex login status` reports ChatGPT. gen3d will reject API-key-only login. [Official authentication documentation](https://developers.openai.com/codex/auth) explains the subscription path.

From the repository, run `npm ci`. Start a dedicated Blender process:

```sh
blender -b --python blender/gen3d_bridge.py -- --serve
```

Then run `npm start` in a second terminal and open http://127.0.0.1:3333. `npm start` binds only to loopback. The Blender bridge also binds only to loopback, on port 9877. Both processes must run on the same machine with access to the project directory. Headless rendering uses Cycles on the CPU and requires no interactive GPU viewport.

For interactive Blender instead, install `blender/gen3d_bridge.py` through **Edit → Preferences → Add-ons → Install from Disk** (in recent Blender, under the Add-ons menu). Enable the add-on, open the 3D View sidebar with **N**, and click **Start gen3d bridge** in the **gen3d** tab. Use a dedicated empty scene: new generation replaces its geometry. Revision opens the selected version's copied scene. The bridge runs Python on Blender's main thread; use it with trusted local clients and modeling instructions.

## Optional MPFB humanoids

For a locally generated continuous human base mesh, see [MPFB setup](mpfb.md). It documents compatible versions, enabling the add-on in this same Blender process, optional local assets, the availability check, explicit modeling selection and comparisons. Existing Blender modeling and props remain usable without MPFB.

## Model and review

1. Click **New project** (+) and create a project using either a text description or a PNG/JPEG/WebP upload (maximum 10 MB). Image projects can optionally include modeling instructions. They do not require a preceding text/concept stage.
2. Configure **Pause for review** for input, concept image (text only), multi-view set (text only), and 3D preview. Defaults: input disabled; concept, multi-view and preview enabled. Accept input if that checkpoint is enabled, then click **Start workflow**.
3. Text projects run a separate subscription-authenticated Codex image session without Blender MCP. The resulting concept appears in the UI. If review is enabled, **Accept concept & generate views** starts reference generation; **Reject concept** stops it. **Regenerate concept** can include design feedback and creates a new image version before any modeling. Image projects proceed directly using the uploaded image.
4. Choose the **Humanoid / character** or **Object / prop** reference profile (or infer it from the description on creation). Text generates separate front, **left side**, back and three-quarter images from the selected concept, passing that concept and earlier views as actual image inputs to native image generation. Character views use a consistent neutral A-pose; object views show the whole object. Both use simple backgrounds, near-orthographic projection and consistent materials/proportions/framing/lighting. The original user description remains supplementary guidance, including dimensions, asymmetry and hidden parts. Providers may also supply additional detail views when useful; four distinct whole-subject views are always required.
5. Configure **Run consistency check** and **On consistency failure** under **Review checkpoints & advanced settings** in the new-project dialog, or use the **Review & settings** shortcut and save the project’s **Multi-view consistency (text)** form. Defaults are **On** and **Stop**, including existing projects. On runs a separate Codex inspection of the base and all views. Stop blocks inconsistent sets; **Warn and continue** keeps the failed report and visible warning while permitting modeling with the same valid images. **Off** never calls the inspector and marks inspection skipped. Inspection crashes, unavailable tools and malformed reports remain errors in either On mode. Required front, labeled side, back and three-quarter images must still be valid and belong to the source concept/set in every mode. Inspect the report and **Regenerate view set** with feedback to repair views without changing the base design. With multi-view review enabled, **Accept views & model** explicitly approves the set and resumes; **Reject view set** or regeneration retains the previous set and decision history. Changing settings or restarting never dismisses pending review. When multi-view review is disabled, sets allowed by their consistency policy continue automatically. Warn mode records a failed inspection and a “modeling continued despite inconsistency” activity entry; Off records a skipped inspection. Neither setting bypasses enabled human checkpoints. All images stay visible in the UI, including historical and partial failed sets.
6. Codex receives the base **and every generated view**, or the uploaded input for image projects, through `exec --image` and builds mesh geometry through Blender MCP. The app renders a PNG, saves a Blender scene and exports a self-contained GLB. Orbit, pan and zoom the preview; inspect the render. If preview review is enabled, approve before exporting or requesting more modeling. Rejection permits a deliberate retry/revision.
7. **Revise selected version** copies that version's scene and reuses its source concept and view set/upload, with natural-language feedback. Earlier artifacts/reviews remain intact. **Retry from input** creates a fresh model using the current selected concept and reference set. Changing the prompt invalidates the current input approval and concept/reference-set selection, retaining history; the next text workflow generates a new concept.
8. **Download GLB** and **Blender scene** become available after preview approval (or automatic acceptance when that checkpoint is disabled).

The workspace shows one stage at a time: **Input → Base concept → Multi-view → 3D model** for text, or **Input → 3D model** for image input. Click any stage to browse it, including completed intermediate images after automatic generation. Stage labels distinguish completed, running, needs-review, warning, failed and future states. **Next step** leads to the current required decision, even if you are viewing an older candidate. Review controls always apply to the candidate shown beside them; navigating alone never approves a checkpoint.

Use the concept/view selectors or compact thumbnails for earlier image candidates, and **Version** for earlier models. **Source concept** and **Source view set** in the model panel open its exact inputs. Consistency status and effective settings appear with each selected view set; expand **Consistency issues & report** for issues and the saved report link. **History** and **Review & settings** open collapsible secondary areas. Supplementary uploads/reviews are under **Supplementary references** in **Input**.

The browser polls shared project state every 1.5 seconds. New artifacts and MCP edits appear without refresh; browsing an explicitly selected historical candidate stays stable when a newer one arrives. Unsaved form edits survive polling. Revisions, regeneration and acceptance resume following the current workflow; the **Next step** button can also take you from a historical artifact to a pending review. On narrow screens, project navigation becomes a horizontal strip and contextual actions sit below the preview. Keyboard users can Tab through stage buttons, activate them with Enter/Space and use arrow keys to pan a focused 3D viewer; **Fit model** restores framing. If WebGL/model loading fails, inspect the rendered preview and use available exports.

The shared HTTP/MCP setting names are `input`, `concept`, `multiView` and `preview`, each a boolean under `checkpoints`. Disabled checkpoints continue automatically and record automatic acceptance. Changing checkpoint settings does not approve a pending concept/view-set/model/input. Explicit rejection remains effective until input/concept acceptance or deliberate regeneration. Existing text projects also require a concept and complete valid reference set allowed by its saved consistency policy for new modeling; their historical artifacts remain viewable.

Consistency settings use `consistencySettings: { enabled: true, onFailure: "stop" }` in shared HTTP/MCP state. `enabled` is boolean; `onFailure` is `"stop"` or `"continue"`. The failure selector is disabled in the UI when inspection is Off, while retaining its saved preference. Both settings persist in `project.json`; HTTP create/PATCH and MCP `create_project`/`update_project` accept them. Checkpoints remain controlled separately by human review.

New reference sets snapshot `consistencySettings`. Their `consistency` includes `status` (`pending`, `running`, `passed`, `failed`, `skipped`, or `error`), `issues`, inspection `report` when available, and `outcome` (`pending`, `allowed`, or `blocked`); failed continuation also exposes `warning`. “Allowed” means consistency permits modeling; human approval and artifact validation must still pass. Models snapshot settings/report and expose `continuedDespiteInconsistency`; their `status` records the actual modeling result. Image projects record inspection as `not-applicable` and retain their direct image-input path.

Setting changes apply to newly generated sets. Regenerate views to apply a changed policy to an existing project. Existing failed/error reports and pending reviews are not cleared by changing settings. Retry and revision reuse the source set’s saved policy and exact images, even if the current project has different settings. Previous reports, reviews and artifacts remain visible in history.

Supplementary references can be added through the UI or `add_reference` through MCP. Every pending reference requires human review; only approved references are attached alongside the required design images. A supplied reference does not satisfy the generated-concept stage for text.

The small image-provider interface has two methods:

- `generate({ prompt, profile, feedback, dir }) → { bytes, ext }` for the base concept.
- `generateViews({ prompt, profile, conceptFile, conceptId, feedback, dir, onImage })` for that specific design. Call and await `onImage({ view, side, bytes, ext })` as each image becomes available. Required `view` values: `front`, `side`, `back`, `three-quarter`; use `side: 'left'` or `side: 'right'` for the side view (the native provider generates a labeled left-side view). Additional detail views may use distinct lowercase names. `ext` is `png`, `jpg` or `webp`. Immediate publication preserves already generated views if a later call fails.

Persistence, typed provenance, human review and modeling belong to the runner. Inject a replacement object through `createApp({ conceptGenerator })` or `new Runner(store, { conceptGenerator })`; it must implement both stages or text modeling blocks. When enabled, the independent default inspector uses subscription-authenticated Codex. Tests can inject `inspectReferences` separately; replacing the image generator does not override the configured inspection policy or change the Blender flow. No generic provider framework, paid API or third-party 3D SaaS is required.

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

The project MCP server exposes:

| Tool | Operation |
| --- | --- |
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

The default store is `~/.gen3d/`. A project contains `project.json`, its input/reference images, `concepts/<uuid>/` directories with generated PNG/task/output metadata, `reference-sets/<uuid>/` directories with separate images, provider tasks/audits and consistency reports, and `versions/<uuid>/` directories holding its task snapshot, model, scene, render and MCP audit. The audit records successful Blender MCP operation names, timestamps and code hashes. Raw Codex streams and credentials are not stored or served. A bounded final modeling summary is kept with the version. Back up this directory to preserve projects. The repository's `.gen3d/` is ignored for development data.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEN3D_DATA_DIR` | `~/.gen3d` | Server's project storage directory |
| `GEN3D_PORT` | `3333` | Local app port |
| `GEN3D_BLENDER_PORT` | `9877` | Dedicated bridge port; set for both Blender and server |
| `GEN3D_CODEX_BIN` | `codex` | Path to the installed CLI executable |
| `GEN3D_URL` | `http://127.0.0.1:3333` | App URL used by project MCP/browser check |

Only one server may own a data directory. Modeling is serialized globally across projects because Blender has one current scene. Each modeling job uses a fresh Codex session with the prompt, required base and all views/upload image, optional references and selected scene as its context. gen3d uses the CLI default subscription model, does not load unrelated global user MCP integrations/hooks, and does not alter credentials. Shell execution remains sandboxed; Blender Python executes inside the dedicated Blender process.

## Failures and checks

- **Image generation unavailable:** the failed concept or reference set records a specific blocker and zero modeling jobs are launched. Verify `codex features list` and a real `codex exec` image task with ChatGPT login; feature announcements or an enabled flag alone do not establish account capability. There is no direct-text, paid-API or synthetic-image fallback. See [Issue #10 validation](validation-issue10.md).
- **Consistency failure:** Stop retains the failed report and blocks modeling. Warn and continue retains a visible warning and failed report, then permits the valid image set to proceed after any required human approval. Regenerate views to fix contradictions. Off intentionally skips inspection; it does not bypass artifact or review checks.
- **Inspection error:** an unavailable inspector, crash or malformed report is recorded as `error` and blocks modeling in both On modes. Deliberate regeneration uses the current project settings.
- **Bridge unavailable:** start Blender with the bridge, check that both processes use the same port, and retry manually.
- **Codex login/CLI incompatibility:** run `codex login status` and `codex exec --help`; install a CLI with the options above. Failed versions show the final Codex summary when available.
- **Usage limit:** gen3d stops the job and blocks further generation in that server session. It never redeems reset tickets, buys allowance, changes providers/models, or retries. Continue only after allowance is available through your normal account process.
- **Interrupted server:** unfinished concepts, reference sets and versions recover as failed on restart. Useful completed versions remain intact. A graceful shutdown waits for the current job before releasing the store lock. If the server was forcibly killed, stop its leftover Codex process and wait for Blender to finish any pending command before restarting.
- **WebGL unavailable:** the rendered preview and GLB/scene downloads remain available. Use a browser with WebGL enabled for orbit/pan/zoom.
- **Quality:** this MVP produces agent-authored mesh models with basic materials. Subject likeness and topology depend on the prompt and Codex output. Use review/revision; advanced topology, animation and rigging are outside the MVP.

Run `npm test`, `npm run check` and `git diff --check` for deterministic checks. Run `npm run test:browser` for the isolated stage-studio browser regression (Chrome/Chromium required; set `GEN3D_CHROME_BIN` if needed). It starts disposable local server/browser state with injected providers and replays recorded images/models; it never invokes Codex/Blender or spends allowance. Screenshots and a JSON report go to `.gen3d/studio-browser-check/`, or the directory set by `GEN3D_BROWSER_OUTPUT`. See [Issue #14 validation](validation-issue14.md) for coverage and visual evidence. Tests inject synthetic artifacts solely to exercise workflow behavior; the production entry point always uses the real runner.

For an optional live browser check, start an isolated Chrome with remote debugging on port 9333 and a disposable user-data directory, then run:

```sh
GEN3D_PROJECT_ID=<project-uuid> node scripts/browser-check.js
```

Set `GEN3D_CHROME_URL` for a different debugging port, `GEN3D_VERSION_ID` for an earlier completed version, and `GEN3D_BROWSER_OUTPUT` for the screenshot/report directory. The check verifies actual GLB loading/download and changed screenshots after orbit, pan and zoom; it does not launch generation or spend Codex allowance. Live generation itself requires an authenticated subscription and running Blender. See [Issue #10 validation actually performed](validation-issue10.md) and [historical MVP evidence](validation.md).
