# gen3d

gen3d aims to be a local-first environment where humans and AI agents collaboratively create 3D models. Its focus is an iterative, reviewable workflow: inspect intermediate results, make decisions, revise earlier steps, and continue toward a useful final model.

The first MVP is a local browser application: enter text to generate a concept image **or** upload an image, then let subscription-authenticated Codex model that image through Blender MCP, inspect and revise the model, and download a GLB. Projects, inputs, renders, Blender scenes, reviews and version history persist on your machine. The direction follows [Project vision and goals (Issue #3)](https://github.com/takahirox/gen3d/issues/3).

## Run locally

Prerequisites: Node.js 24+, Blender 4+ with Cycles and the bundled glTF exporter, and an installed Codex CLI supporting `--ignore-user-config` and per-tool MCP approval configuration (tested with 0.161.0). Sign in with your existing ChatGPT subscription with native image-generation access for text input; no separate LLM/image API or 3D-generation service is required. Text workflows fail with a visible blocker if the installed CLI/account cannot generate a concept. [Codex authentication](https://developers.openai.com/codex/auth) describes subscription and API-key sign-in.

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

Open **http://127.0.0.1:3333**. Create a text or image project, choose **Pause for review** settings, then click **Start workflow**. Text input generates a concept first; with concept review enabled, accept it to start modeling or reject/regenerate it. Orbit, pan and zoom the GLB in the viewer; inspect the rendered view; approve/reject; request a natural-language revision; choose earlier versions from the dropdown; download the GLB or Blender scene. Retry starts a new candidate from the input. Revision starts from a copy of the selected scene, retaining the original.

See [local setup, MCP integration and troubleshooting](docs/local-setup.md), [Issue #8 validation](docs/validation-issue8.md), and [historical MVP validation](docs/validation.md).

## Workflow

```text
Text → Input checkpoint → Codex concept image → Concept checkpoint ─┐
Image → Input checkpoint ──────────────────────────────────────────┤
                                                                  ▼
                  Codex + Blender MCP → 3D preview checkpoint → Export
```

Input, concept and preview pauses are configurable in the Web UI. Defaults are input off, concept on, preview on; concept settings apply only to text. Disabled checkpoints continue automatically. Enabled checkpoints require an explicit decision in the Web UI; MCP can inspect and request work but cannot accept those human checkpoints. Preview approval unlocks export. Changing a setting does not dismiss an already pending checkpoint.

Text never models directly: Codex first generates a real concept PNG, and the modeling CLI receives that image through `--image`, with the original text as supplementary context. Image projects use their uploaded image immediately, without concept generation. Optional reference uploads remain a separate human-reviewed supplement and cannot replace the mandatory generated text concept.

Concepts and models have immutable artifact directories, selection/review state, prompt snapshots and shared history. Reject/regenerate a concept without spending time modeling it. Retry a model from the selected concept, revise a copy of any completed scene using its original concept, or edit the input to generate a new design. If subscription-backed image generation is unavailable, the text workflow stops and records the blocker; it never substitutes direct-text modeling, a paid API or a synthetic image.

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
git diff --check
```

Tests cover mandatory concept generation, no-bypass and checkpoint transitions, concept regeneration, shared HTTP/MCP state, image input, reference review gating, revisions, immutable artifacts, concurrency, failures, restart recovery, exports and subscription CLI arguments. Test-only synthetic artifacts do not demonstrate real generation; the live validation record distinguishes those checks from real Codex/Blender/browser runs.

Implementation: `src/concept.js` exposes a small `generate({ prompt, feedback, dir }) → { bytes, ext }` generator interface; `CodexConceptGenerator` is the first implementation. The server/runner constructor accepts a replacement generator without changing modeling. `src/codex.js` owns subscription process handling. `src/store.js` owns disk state, `src/server.js` exposes the local HTTP service, `src/mcp.js` proxies project operations to that service, `src/runner.js` orchestrates Codex and artifact publication, and `src/blender-mcp.js` connects MCP to `blender/gen3d_bridge.py`. `web/` is a plain browser UI with locally served Three.js; no CDN or build step is required.

This repository is managed by ProjectWeave. For contribution and review guidance:

- [Development flow](docs/development-flow.md)
- [Review guidelines](docs/review-guidelines.md)
