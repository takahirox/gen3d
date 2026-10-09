# gen3d

gen3d aims to be a local-first environment where humans and AI agents collaboratively create 3D models. Its focus is an iterative, reviewable workflow: inspect intermediate results, make decisions, revise earlier steps, and continue toward a useful final model.

The first MVP is a local browser application: enter text to generate a base concept and four modeling views **or** upload an image, then let subscription-authenticated Codex model those images through Blender MCP, inspect and revise the model, and download a GLB. Projects, inputs, renders, Blender scenes, reviews and version history persist on your machine. The direction follows [Project vision and goals (Issue #3)](https://github.com/takahirox/gen3d/issues/3).

## Run locally

Prerequisites: Node.js 24+, Blender 4+ with Cycles and the bundled glTF exporter, and an installed Codex CLI supporting `--ignore-user-config` and per-tool MCP approval configuration (tested with 0.161.0). Sign in with your existing ChatGPT subscription with native image-generation access for text input; no separate LLM/image API or 3D-generation service is required. Text workflows fail with a visible blocker if the installed CLI/account cannot generate the required images. [Codex authentication](https://developers.openai.com/codex/auth) describes subscription and API-key sign-in.

```sh
npm ci
codex login
codex login status
```

Use a **dedicated Blender process**. In one terminal, from this repository:

```sh
blender -b --python blender/gen3d_bridge.py -- --serve
```

On macOS, use `/Applications/Blender.app/Contents/MacOS/Blender` if `blender` is not on PATH. In a second terminal:

```sh
npm start
```

Open **http://127.0.0.1:3333**. Click **New project** (+), enter text or upload an image, then click **Start workflow**. The studio has navigable **Input → Base concept → Multi-view → 3D model** stages; image projects use **Input → 3D model**. Each stage puts its artifact in the main workspace and its decisions alongside it. The stage indicators and **Next step** identify progress, pending human review, warnings and failures.

Projects can optionally enable bounded render–compare–revise refinement in **Review & settings** (default Off, 1–5 revision cycles). Each cycle consumes Codex time/usage. Original references, comparison reports, renders and intermediate scenes stay inspectable; AI visual passes do not prove geometric accuracy or quality improvement. See [visual refinement](docs/refinement.md).

Humanoid projects can optionally select **MPFB-assisted humanoid** with a user-installed local MPFB add-on. The default **Existing Blender modeling** remains available without MPFB. Both modes share approved images, review/consistency policy, saved-scene revisions and exports; new humanoid versions include front/side/three-quarter comparisons. See [MPFB setup and experiment](docs/mpfb.md) and [issue #16 validation](docs/validation-issue16.md).

Use **Review & settings** for **Pause for review**, **Run consistency check** (On / Off), and **On consistency failure** (Stop / Warn and continue). New-project settings are also available under **Review checkpoints & advanced settings**. Text generates a base concept first; **Accept concept & generate views** explicitly continues an enabled checkpoint. Compare the base/front/side/back/three-quarter images, inspect consistency issues/report, then **Accept views & model**, reject or regenerate. All concept and view candidates remain available in their selectors and thumbnail strips, including uninterrupted automatic runs.

In **3D model**, orbit, pan and zoom the GLB, **Fit model**, inspect the rendered preview, approve/reject, request a revision, switch model versions and download GLB or **Blender scene**. **Source concept** and **Source view set** open the exact images used by the selected model. Retry starts a new candidate from the input; revision copies the selected scene and retains its source artifacts. **History** opens shared activity and version history. Browser polling shows MCP updates without a manual refresh, while preserving unsaved edits and explicitly selected older candidates.

See [local setup, MCP integration and troubleshooting](docs/local-setup.md), [UI redesign validation (Issue #14)](docs/validation-issue14.md), [Issue #12 validation](docs/validation-issue12.md), [Issue #10 validation](docs/validation-issue10.md), [historical Issue #8 validation](docs/validation-issue8.md), and [historical MVP validation](docs/validation.md).

## Workflow

```text
Text → Input checkpoint → Base concept → Concept checkpoint
                                          ↓
                          Multi-view set → Optional consistency check
                                          ↓
                                Multi-view checkpoint ───┐
Image → Input checkpoint ────────────────────────────────┤
                                                        ▼
              Codex + Blender MCP → 3D preview checkpoint → Export
```

Input, concept, multi-view and preview pauses are configurable in the Web UI. Defaults are input off, concept on, multi-view on, preview on; concept and multi-view settings apply only to text. Disabled checkpoints continue automatically. Enabled checkpoints require an explicit decision in the Web UI; MCP can inspect and request work but cannot accept those human checkpoints. Preview approval unlocks export. Changing a setting does not dismiss an already pending checkpoint.

Text never models directly: Codex first generates a real base concept PNG, then generates separate near-orthographic front, left-side, back and three-quarter views using that exact concept as an image reference. Choose **Humanoid / character** (full-body neutral A-pose) or **Object / prop** (whole object), or let the app infer a profile from the description. When **Run consistency check** is On, a separate Codex session inspects all images for changed parts, proportions, colors, materials and identity. **Stop** blocks inconsistent sets; **Warn and continue** saves the failed report, visibly warns and allows modeling with the same valid images. **Off** skips inspection and records it as skipped. Inspection crashes, malformed reports and unavailable tools still block modeling when the check is On. Missing, invalid or mismatched required images always block modeling. Human multi-view approval remains a separate checkpoint in every mode. The modeling CLI receives the base and every view through `--image`, with original symmetry, dimensions, materials and hidden-part guidance preserved as supplementary text. Image projects use their uploaded image immediately, without concept generation. Optional reference uploads remain a separate human-reviewed supplement and cannot replace the mandatory generated text concept.

Both consistency settings persist locally and are shared by HTTP/Web UI and gen3d MCP. Each new reference set snapshots its effective settings, inspection status, issues/report and outcome; models record their source report and whether modeling continued despite inconsistency. Changes apply to newly generated view sets: regenerate views to use a different policy. Retry and revision preserve their source set’s policy and images. Changing settings never approves a pending human checkpoint.

Concepts, reference sets and models have immutable artifact directories, selection/review state, prompt snapshots and shared history. Reject/regenerate a concept without spending time modeling it. Retry a model from the selected concept and reference set, revise a copy of any completed scene using its original concept and reference set, or edit the input to generate a new design. Every generated image remains saved and visible, including automatic runs, historical sets and partial failed sets. Each view records its role, direction, parent concept and provider; models record the reference set and exact image inputs. Reject/regenerate views before modeling without overwriting earlier images or models. If subscription-backed image generation is unavailable, the text workflow stops and records the blocker; it never substitutes direct-text modeling, a paid API or a synthetic image.

The initial focus is **humanoid / character-like models** and **general objects / props**, prioritizing that loop before broad feature coverage.

## Architecture

```text
Human ── Web UI ──────────┐
                         ▼
AI agents ── gen3d MCP → Local app server → Codex CLI
                         │                    │
                         ▼                    ▼
                   Project/artifact      Blender MCP
                   store + history            │
                                              ▼
                                           Blender
```

- **Local app server:** owns shared project state, artifacts, workflow and version history, and activity logs. Humans and AI operate the same project; AI changes and generated artifacts should be visible in the Web UI.
- **Web UI:** lets humans inspect references and 3D results, review candidates, give revision instructions, navigate history, and export.
- **MCP (Model Context Protocol):** exposes project-level operations to AI agents such as Claude or Codex, including inspecting state, requesting blockouts and renders, refining models, and exporting artifacts.
- **Blender:** the bundled loopback bridge executes Codex's Python modeling operations in Blender on its main thread. The app exports a self-contained GLB, saves the scene and renders a PNG after modeling. Jobs are serialized across projects to protect the shared scene.

The app server, project store and Blender run on your machine. Codex inference uses your authenticated subscription online, including any attached input/approved reference images. The app removes API-key environment variables from its Codex child process and enforces ChatGPT login. It does not reset usage limits, purchase allowance, switch providers, or retry automatically.

## Development

```sh
npm test
npm run check
npm run test:browser # Chrome/Chromium; injected fixtures, no Codex allowance
git diff --check
```

Tests cover all three consistency modes, inspection errors, settings persistence and shared state, mandatory base/view generation, consistency failures, no-bypass and checkpoint transitions, concept regeneration, shared HTTP/MCP state, image input, reference review gating, revisions, immutable artifacts, concurrency, failures, restart recovery, exports and subscription CLI arguments. Test-only synthetic artifacts do not demonstrate real generation; the live validation record distinguishes those checks from real Codex/Blender/browser runs.

Implementation: `src/concept.js` exposes a small `generate({ prompt, profile, feedback, dir }) → { bytes, ext }` base generator and `generateViews({ prompt, profile, conceptFile, conceptId, feedback, dir, onImage })` view generator interface; views are published separately with `onImage({ view, side, bytes, ext })`. `src/reference-set.js` handles view validation and the independent Codex consistency inspection; `CodexConceptGenerator` is the first implementation. The server/runner constructor accepts a replacement generator without changing modeling. `src/codex.js` owns subscription process handling. `src/store.js` owns disk state, `src/server.js` exposes the local HTTP service, `src/mcp.js` proxies project operations to that service, `src/runner.js` orchestrates Codex and artifact publication, and `src/blender-mcp.js` connects MCP to `blender/gen3d_bridge.py`. `web/` is a plain browser UI with locally served Three.js; no CDN or build step is required.

This repository is managed by ProjectWeave. For contribution and review guidance:

- [Development flow](docs/development-flow.md)
- [Review guidelines](docs/review-guidelines.md)
