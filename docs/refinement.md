# Optional visual refinement

In **Review & settings**, turn **Enable refinement** On and choose **Maximum revision cycles** (1–5, default 2). New projects and older saved projects default to **Off**. Creation settings and later edits are shared through the Web UI, HTTP and project MCP; settings persist across server restart. Each new Generate, Retry or Revise job snapshots the current refinement settings. Changing settings does not rewrite existing models or dismiss pending approvals.

With refinement Off, modeling and reviews follow the existing workflow. With refinement On, the initial Codex/Blender model is exported and rendered before a separate Codex visual comparison. A cycle is a revision of that initial scene, not a new concept/model from scratch. At most the selected number of revision cycles run, with an initial comparison plus a fresh comparison after each revision. Every comparison and revision consumes Codex time and subscription usage; complex scenes can take several minutes per cycle. No paid image/3D API or cloud service is added.

Text projects compare **all** original approved modeling views (front, labeled left/right side, back and three-quarter), with the original base concept and approved supplementary references attached for context. The initial modeler inspects each original view and saves an explicit direction in the scene camera map; revisions can correct the map. Missing/invalid required directions are errors, not fallback viewpoints. The base design remains authoritative when the configured consistency policy permits contradictory views. Uploaded-image projects compare only the available input viewpoint, with the original upload and approved supplementary references. The initial modeler sets a saved camera direction based on that image; a missing direction is an explicit error. Camera direction, orthographic framing, center and scale are recorded in `cameras.json`. Per-view framing overrides are saved in `scene['gen3d_reference_camera_framing']`, keyed by view label (`input` for uploads), with `center` (three finite world coordinates) and `orthoScale` (positive finite number). Export uses these validated overrides and preserves them through scene revisions; omitted values use model bounds. These are reference-aligned AI choices and framing rules, not calibrated camera measurements. Missing views are errors; invisible details are uncertain, never invented ground truth.

Each structured `comparison.json` contains an overall verdict, summary, per-view observations and actionable revision instructions. Each view reports silhouette, proportions, part placement, missing/extra features, and colors/materials. Character projects also report anatomy, face, limbs and pose. An observation is acceptable, a concrete discrepancy, or uncertain. **Pass** requires all observable categories in every required view to be acceptable, with no discrepancies or revision instructions. A completely unobservable view cannot pass. This is a pragmatic AI visual judgment; it does not guarantee photorealism, measured geometric accuracy or proven quality improvement.

Concrete discrepancies become `NEXT-REVISION.md`. Each new report lists `revisionTargets`: `geometry`, `materials` and/or `camera`, identifying every type of correction required. The following cycle copies the saved scene to `source.blend`, retains the executed instructions and required targets in `REVISION.md`, opens that scene through the existing local Blender bridge, and modifies it. MPFB revisions preserve the original continuous body and verify its topology; MPFB remains limited to humanoid projects. Geometry corrections require a changed hash of evaluated mesh vertices/topology in world coordinates. Material corrections require changed exported materials, embedded textures or material assignments (`materials.json`); camera corrections require changed direction or framing (`cameras.json`). Every requested target must change before re-evaluation. Material-only and camera-only corrections can proceed with unchanged meshes and record `geometryChanged: false`. Older reports without targets retain the mesh guard, except solely colors/materials discrepancies use material evidence. Changed evidence establishes the type of edit, not visual improvement.

## Stops and review

The shared `version.refinement.status` distinguishes `off`, `running`, `passed`, `iteration-limit`, `failed`, `usage-limit`, `review-requested` and `interrupted`. The cycle status and stage show modeling, revising or comparing, with timestamps, reports and errors.

- A passing comparison ends the loop immediately.
- At the revision cap, unresolved discrepancies and the `iteration-limit` outcome remain visible. The model proceeds to the configured final preview review; with preview review disabled, the model follows existing automatic acceptance, while the unresolved visual verdict remains explicit.
- Inspection/modeling errors, missing renders, missing evidence and unchanged required targets stop without automatic retries. The last validated model is retained as a usable preview; failure explicitly requires Web UI preview approval before export, even if automatic preview acceptance was configured.
- A Codex usage limit stops further Codex operations. No automatic retry, reset ticket, purchase or model/provider switch occurs. The server also blocks subsequent jobs until allowance is available and it is manually restarted.
- **Stop for human preview review** can be requested while a job is running, including initial modeling. It finishes the current operation to preserve usable artifacts, then stops before further inspection/revision. This enables a required preview checkpoint for that version; MCP cannot approve it.
- After server interruption, running jobs/cycles become failed/interrupted on restart. Saved artifacts remain inspectable; no job resumes automatically.

Existing input, supplementary-reference, concept and multi-view checkpoints run before modeling and remain authoritative. Refinement runs before the configured final preview review, never replaces its approval. Manual retries/revisions create new model versions and preserve earlier history and exports.

## Inspecting artifacts and shared state

Open **Refinement comparisons & history** in the model workspace. It includes each initial/revised scene, original references alongside per-view renders, camera, mesh and material evidence, evaluation prompt/schema/report, executed and next revision instructions, MCP audit, summary, GLB and Blender scene. Known files are published while each operation runs; partial/failed cycles remain available. History links use artifact inspection endpoints so running and failed scene/model files can be opened. Final download controls retain the preview approval gate and point to the last validated scene, while earlier cycle outputs keep distinct paths.

HTTP project state is `GET /api/projects/:id`. Settings use `POST /api/projects` or `PATCH /api/projects/:id`, for example:

```json
{"refinementSettings":{"enabled":true,"maxIterations":2}}
```

The project MCP `create_project` and `update_project` expose the same settings. `get_project` and the existing project resource return settings, cycles, reports, artifact paths and history from the HTTP server's single store. `get_artifact_image` reads a saved comparison/reference image using `projectId` and its manifest `file` path. Reports and other artifacts use the existing `/api/projects/:id/artifacts/:file` endpoint. The Web UI review-interruption action posts to `/api/projects/:id/versions/:versionId/refinement-review` and is subject to the existing human-review boundary.

## Development and validation

`tests/refinement.test.js` covers defaults/settings/persistence/migration, initial/revision/stop branches, scratch and MPFB continuity, original references, uncertain observations, immutable artifacts, partial failures/restart, Web UI review gates and real HTTP/MCP state sharing. These tests inject synthetic modeling/inspection outputs and do not demonstrate visual improvement. The studio browser regression also uses injected fixtures.

`node scripts/refinement-export-check.js` runs deterministic material/camera edits through the production exporter in real local Blender, checks mesh stability, changed renders, saved framing across reopen/export and independent multi-view framing, and rejects invalid overrides. It uses no Codex allowance or visual inspector. Set `GEN3D_BLENDER_BIN` to the Blender executable if needed; `GEN3D_REFINEMENT_EXPORT_OUTPUT` overrides the default `.gen3d/refinement-export-check` evidence folder.

For opt-in live validation, start a **dedicated** Blender bridge and run:

```sh
GEN3D_BLENDER_PORT=19877 blender -b --python blender/gen3d_bridge.py -- --serve
GEN3D_BLENDER_PORT=19877 GEN3D_REFINEMENT_REFERENCE=/path/to/approved.png node scripts/refinement-validation.js
```

The script uses authenticated ChatGPT Codex and real Blender. It records one bounded job, original project state, render comparisons and scene/model outputs under `.gen3d/refinement-validation`. Set `GEN3D_REFINEMENT_MODE=mpfb` and `GEN3D_REFINEMENT_PROFILE=character` to exercise a locally enabled MPFB path; `GEN3D_REFINEMENT_OUTPUT` selects an isolated output directory and `GEN3D_REFINEMENT_PROMPT` supplies supplementary design context. Alternatively set `GEN3D_REFINEMENT_REFERENCE_DIR` to a directory containing original approved `concept.png`, `front.png`, `side.png` (left), `back.png`, and `three-quarter.png`; this replays those saved references through the existing text/concept/view approval flow without generating replacements. `GEN3D_REFINEMENT_ON_FAILURE=continue` explicitly selects the existing Warn and continue consistency policy for that trial. It never retries a usage limit. See [Issue #18 validation](validation-issue18.md) for actual results and limitations.
