# gen3d

gen3d is a local-first modeling studio where humans and AI share projects, assets, executable workflows and review history. Choose a preset in the Model studio, or edit its actual node graph in the Workflow editor. Codex uses a ChatGPT subscription and local Blender MCP to model approved images. Every completed node saves a typed, hashed checkpoint; branches retain earlier candidates and accepted models.

## Run locally

Use Node.js 24+, Blender 4+ with Cycles/glTF, and an installed Codex CLI supporting `--ignore-user-config` and per-tool MCP approval configuration. Sign in using ChatGPT; text input additionally needs native image-generation access. No separate image/LLM API or 3D-generation service is required.

```sh
npm ci
codex login
codex login status
```

Start a **dedicated** Blender process in one terminal:

```sh
blender -b --python blender/gen3d_bridge.py -- --serve
```

Start the app in a second terminal:

```sh
npm start
```

Open **http://127.0.0.1:3333**. Create a project with text or an uploaded image and choose **Object from text / image** or **Humanoid from editable base**. For a humanoid, import a complete GLB/packed `.blend` in Asset library, then explicitly authorize the source and editable mesh names in the studio. Click **Run workflow**. Enabled human checkpoints pause for **Accept & continue / Reject** in the studio.

This release uses project schema 3. Old generated state is unsupported. Follow the [scoped clean-start procedure](docs/local-setup.md#start-fresh); no startup operation deletes external assets or Blender installations.

## Studio and workflows

The same project has **Home / Projects**, **Model studio**, **Workflow editor** and **Asset library** navigation. Light / Dark changes display colors and persists in the browser across navigation/reloads.

The studio puts an interactive 3D viewer beside contextual design and review controls. Switch to a source/render comparison, select a candidate or saved run, inspect intermediate artifacts, restore an accepted model, or branch from a completed checkpoint. GLB and Blender-scene export require the candidate’s saved approval/preservation conditions. Partial failures retain their artifacts and error messages.

The workflow editor displays connected executable nodes with saved statuses. Click a node to edit supported settings and typed input connections, add/remove nodes, save the project graph, or duplicate it as a reusable local preset. Graph JSON is also editable. Disconnected required ports, incompatible types, unused nodes, unknown settings and cycles fail validation. Bounded refinement replaces unrestricted cycles.

Both presets use the same scheduler:

```text
Input → Concept → Four views → Consistency ──┐
  └──→ Approved secondary references ────────┤
  └──→ Complete editable base (humanoid) ────┤
                                            ↓
                       Model / Edit base → Bounded refine → Review → Output
```

Image input passes through concept/views without generating substitutes. Text generates the base image and four distinct labeled views. Optional consistency inspection supports Stop, Warn and continue, and Off. Inspection errors and invalid image evidence block modeling. Optional model-library references are rendered as contact sheets and retain their per-source roles/permissions. The [existing refinement loop](docs/refinement.md) retains its 1–5 cycle bound, concrete change evidence, error/usage stops and human review semantics.

Each run snapshots its graph revision, accepted sources, settings and implementation hashes. Completed nodes persist typed output data, source identities, dependency IDs, artifact hashes and an immutable checkpoint record. To change a later step, save the edited graph and choose **Branch from here** on an earlier valid checkpoint. Its valid ancestors and unchanged parallel preparation paths are reused; downstream nodes execute into new output directories. Changed upstream input/settings/connections, source files, implementation or artifacts block stale reuse. Restart never automatically resumes interrupted jobs or dismisses pending review.

## Complete-base editing

Editable bases have a separate human authorization from reference-only or mesh-reuse assets. The app copies the complete scene, preserving object hierarchy, armature, skin weights, expressions/shape keys, UVs and materials. Only named editable meshes may change; feature exceptions and new objects require explicit authorization. Protected objects and features are compared after editing, and the exported GLB is reopened and checked. Source hashes must stay unchanged. Failed protection checks cannot be accepted as a candidate.

The first slice deliberately supports a conservative, verifiable subset: one modeling scene, triangulated meshes, relative shape keys, skin armatures and basic glTF-compatible Principled materials. Unsupported animations, constraints/drivers, modifiers, materials/extensions or format roundtrip mismatches produce concrete blockers. It does not promise preservation of arbitrary Blender/VRM features. See [workflows and preservation contracts](docs/workflows.md).

## MCP and architecture

The browser and project MCP use one loopback HTTP server/store. MCP can read the catalog, save graphs/presets, run/fork workflows, inspect the same checkpoints/images and request exports. Human review and editable-base authorization remain Web UI operations. See [setup and MCP usage](docs/local-setup.md#ai-facing-mcp).

`src/workflow.js` validates/schedules graphs and persists lineage. `src/workflow-operations.js` connects nodes to existing concept/view generation, inspection, modeling, refinement and exports. `src/base-model.js` and `blender/preservation.py` handle complete-base copying and measured preservation. `src/store.js` owns project persistence; `src/asset-library.js` owns reusable models; `src/mcp.js` proxies the server. `web/` uses locally served Three.js with no CDN/build step.

Files and Blender run locally. Codex inference runs online through your authenticated subscription and receives attached images. Jobs are serialized across projects. Usage limits stop work without reset tickets, allowance purchases, provider/model switches or automatic retries.

## Development

```sh
npm test
npm run check
npm run test:browser             # real Chrome; injected providers, no allowance
npm run test:workflow-blender    # real Blender, no Codex
npm run validate:workflow-live   # opt-in real Codex + Blender; uses allowance
```

Tests distinguish mocked scheduler/browser fixtures from actual generation. The focused live check requires the representative base fixture produced by `test:workflow-blender`. See [Issue #26 validation and evidence](docs/validation-issue26.md), [local model library](docs/model-library.md), [development flow](docs/development-flow.md) and [review guidelines](docs/review-guidelines.md). Historical validation documents describe their release’s UI/schema.
