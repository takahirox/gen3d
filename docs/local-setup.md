# Local setup and operation

## Prerequisites and startup

Use Node.js 24+, an installed Codex CLI, a ChatGPT account with Codex access, and Blender 4+ with Cycles and its standard glTF exporter. For text input, the CLI/account must support native image generation (`image_generation` feature). The CLI must also support `exec --image`, `--ignore-user-config`, `forced_login_method` and `mcp_servers.<server>.tools.<tool>.approval_mode`; the live validation used Codex 0.161.0 and Blender 5.1.2. Install Codex following its [official CLI setup](https://developers.openai.com/codex/cli), then use `codex login` and confirm `codex login status` reports ChatGPT. gen3d will reject API-key-only login. [Official authentication documentation](https://developers.openai.com/codex/auth) explains the subscription path.

From the repository, run `npm ci`. Start a dedicated Blender process:

```sh
blender -b --python blender/gen3d_bridge.py -- --serve
```

Then run `npm start` in a second terminal and open http://127.0.0.1:3333. `npm start` binds only to loopback. The Blender bridge also binds only to loopback, on port 9877. Both processes must run on the same machine with access to the project directory. Headless rendering uses Cycles on the CPU and requires no interactive GPU viewport.

For interactive Blender instead, install `blender/gen3d_bridge.py` through **Edit → Preferences → Add-ons → Install from Disk** (in recent Blender, under the Add-ons menu). Enable the add-on, open the 3D View sidebar with **N**, and click **Start gen3d bridge** in the **gen3d** tab. Use a dedicated empty scene: new generation replaces its geometry. Revision opens the selected version's copied scene. The bridge runs Python on Blender's main thread; use it with trusted local clients and modeling instructions.

## Model and review

1. Create a project using either a text description or a PNG/JPEG/WebP upload (maximum 10 MB). Image projects can optionally include modeling instructions. They do not require a preceding text/concept stage.
2. Configure **Pause for review** for input, concept image (text only), and 3D preview. Defaults: input disabled, concept and preview enabled. Accept input if that checkpoint is enabled, then click **Start workflow**.
3. Text projects run a separate subscription-authenticated Codex image session without Blender MCP. The resulting concept appears in the UI. If review is enabled, **Accept concept & model** starts modeling; **Reject concept** stops it. **Regenerate concept** can include design feedback and creates a new image version before any modeling. Image projects proceed directly using the uploaded image.
4. Codex receives the concept/upload through `exec --image` and builds mesh geometry through Blender MCP. The app renders a PNG, saves a Blender scene and exports a self-contained GLB. Orbit, pan and zoom the preview; inspect the render. If preview review is enabled, approve before exporting or requesting more modeling. Rejection permits a deliberate retry/revision.
5. **Revise selected version** copies that version's scene and reuses its source concept/upload, with natural-language feedback. Earlier artifacts/reviews remain intact. **Retry from input** creates a fresh model using the current selected concept. Changing the prompt invalidates the current input approval and concept selection, retaining history; the next text workflow generates a new concept.
6. **Download GLB** and **Blender scene** become available after preview approval (or automatic acceptance when that checkpoint is disabled).

Disabled checkpoints continue automatically and record automatic acceptance. Changing checkpoint settings does not approve a pending concept/model/input. Explicit rejection remains effective until input/concept acceptance or deliberate regeneration. Existing text projects also require a concept for new modeling; their historical artifacts remain viewable.

Supplementary references can be added through the UI or `add_reference` through MCP. Every pending reference requires human review; only approved references are attached alongside the required design image. A supplied reference does not satisfy the generated-concept stage for text.

The generator interface is `generate({ prompt, feedback, dir }) → { bytes, ext }`, with `ext` equal to `png`, `jpg` or `webp`. Persistence, review and modeling belong to the runner. Inject a replacement object through `createApp({ conceptGenerator })` or `new Runner(store, { conceptGenerator })`; no provider framework or separately billed service is required.

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
| `list_projects`, `get_project` | Read checkpoint settings, input review, concepts/selection, versions, artifact paths and history |
| `create_project`, `update_project` | Create a text/image project or change its name/prompt |
| `add_reference` | Stage an image data URL for human review |
| `generate_model` | Start text→concept→model or image→model, retry or revision; poll `get_project` |
| `regenerate_concept` | Generate another text concept; pending concepts must first be rejected in the Web UI |
| `review_model` | Record review when human preview checkpoint is disabled; enabled reviews require the Web UI |
| `export_model` | Obtain GLB, Blender-scene and rendered-view download URLs |

Resources `gen3d://projects` and `gen3d://projects/{projectId}` expose the same JSON state. MCP calls proxy the HTTP service; they do not open a second independent store. Mutations are tagged `mcp` in activity; web mutations are tagged `web`. The UI polls the shared service every 1.5 seconds. A simple check is to use `update_project` to rename a project while its UI is open, then save instructions in the UI and read them using `get_project`.

The Web UI owns human checkpoint decisions and changes to checkpoint settings on existing projects. MCP can set initial settings in `create_project`, inspect all review state/history and request work, but cannot bypass enabled checkpoints.

The **project MCP** interface manages workflow state. The separate **Blender MCP** interface (`src/blender-mcp.js`) provides `get_scene_info` and `execute_blender_code` to the app's Codex modeling session. A Generate/Revise action authorizes those two operations in the dedicated scene for that job; the runner sets explicit per-tool approval settings, leaves the shell sandbox at `workspace-write`, and does not alter the user's global Codex configuration. See [official MCP configuration](https://developers.openai.com/codex/mcp).

## Persistence and configuration

The default store is `~/.gen3d/`. A project contains `project.json`, its input/reference images, `concepts/<uuid>/` directories with generated PNG/task/output metadata, and `versions/<uuid>/` directories holding its task snapshot, model, scene, render and MCP audit. The audit records successful Blender MCP operation names, timestamps and code hashes. Raw Codex streams and credentials are not stored or served. A bounded final modeling summary is kept with the version. Back up this directory to preserve projects. The repository's `.gen3d/` is ignored for development data.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEN3D_DATA_DIR` | `~/.gen3d` | Server's project storage directory |
| `GEN3D_PORT` | `3333` | Local app port |
| `GEN3D_BLENDER_PORT` | `9877` | Dedicated bridge port; set for both Blender and server |
| `GEN3D_CODEX_BIN` | `codex` | Path to the installed CLI executable |
| `GEN3D_URL` | `http://127.0.0.1:3333` | App URL used by project MCP/browser check |

Only one server may own a data directory. Modeling is serialized globally across projects because Blender has one current scene. Each modeling job uses a fresh Codex session with the prompt, required concept/upload image, optional references and selected scene as its context. gen3d uses the CLI default subscription model, does not load unrelated global user MCP integrations/hooks, and does not alter credentials. Shell execution remains sandboxed; Blender Python executes inside the dedicated Blender process.

## Failures and checks

- **Concept generation unavailable:** the failed concept records a specific blocker and zero modeling jobs are launched. Verify `codex features list` and a real `codex exec` image task with ChatGPT login; feature announcements or an enabled flag alone do not establish account capability. There is no direct-text, paid-API or synthetic-image fallback. See [Issue #8 live validation](validation-issue8.md).
- **Bridge unavailable:** start Blender with the bridge, check that both processes use the same port, and retry manually.
- **Codex login/CLI incompatibility:** run `codex login status` and `codex exec --help`; install a CLI with the options above. Failed versions show the final Codex summary when available.
- **Usage limit:** gen3d stops the job and blocks further generation in that server session. It never redeems reset tickets, buys allowance, changes providers/models, or retries. Continue only after allowance is available through your normal account process.
- **Interrupted server:** unfinished versions recover as failed on restart. Useful completed versions remain intact. A graceful shutdown waits for the current job before releasing the store lock. If the server was forcibly killed, stop its leftover Codex process and wait for Blender to finish any pending command before restarting.
- **WebGL unavailable:** the rendered preview and GLB/scene downloads remain available. Use a browser with WebGL enabled for orbit/pan/zoom.
- **Quality:** this MVP produces agent-authored mesh models with basic materials. Subject likeness and topology depend on the prompt and Codex output. Use review/revision; advanced topology, animation and rigging are outside the MVP.

Run `npm test`, `npm run check` and `git diff --check` for deterministic checks. Tests inject synthetic artifacts solely to exercise workflow behavior; the production entry point always uses the real runner.

For an optional live browser check, start an isolated Chrome with remote debugging on port 9333 and a disposable user-data directory, then run:

```sh
GEN3D_PROJECT_ID=<project-uuid> node scripts/browser-check.js
```

Set `GEN3D_CHROME_URL` for a different debugging port, `GEN3D_VERSION_ID` for an earlier completed version, and `GEN3D_BROWSER_OUTPUT` for the screenshot/report directory. The check verifies actual GLB loading/download and changed screenshots after orbit, pan and zoom; it does not launch generation or spend Codex allowance. Live generation itself requires an authenticated subscription and running Blender. See [Issue #8 validation actually performed](validation-issue8.md) and [historical MVP evidence](validation.md).
