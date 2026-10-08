# gen3d

gen3d aims to be a local-first environment where humans and AI agents collaboratively create 3D models. Its focus is an iterative, reviewable workflow: inspect intermediate results, make decisions, revise earlier steps, and continue toward a useful final model.

The project is at an early stage: this repository currently contains documentation, with no application or build/test setup. The workflow and architecture below describe the intended direction, based on [Project vision and goals (Issue #3)](https://github.com/takahirox/gen3d/issues/3).

## Workflow

```text
Text / image → References / concepts → Human / AI review
    → 3D blockout → Human / AI review → Refinement
    → Materials / rigging / finishing → Review → Export
```

Concept images, blockouts, refined models, and rendered views should provide checkpoints for review. Humans and AI should be able to approve, reject, revise, retry, or branch from earlier results, with useful history preserved across candidates and versions. The goal is a collaborative review-and-revision loop rather than one-shot autonomous generation.

The initial focus is **humanoid / character-like models** and **general objects / props**, prioritizing that loop before broad feature coverage.

## Architecture

```text
Human ── Web UI ──────────┐
                         ▼
                  Local app server ── Blender integration ── Blender
                         ▲
AI agents ── MCP ────────┘
```

- **Local app server:** owns shared project state, artifacts, workflow and version history, and activity logs. Humans and AI operate the same project; AI changes and generated artifacts should be visible in the Web UI.
- **Web UI:** lets humans inspect references and 3D results, review candidates, give revision instructions, navigate history, and export.
- **MCP (Model Context Protocol):** exposes project-level operations to AI agents such as Claude or Codex, including inspecting state, requesting blockouts and renders, refining models, and exporting artifacts.
- **Blender:** provides the initial 3D workspace and execution environment, integrated through MCP and/or scripting to create, inspect, render, revise, and export models. Integrations should remain replaceable so other 3D backends can be supported later.

The core app server and Blender are intended to run on the user's machine. Optional cloud services may provide LLMs, image generation, or search; the core workflow should not require a third-party 3D-generation SaaS.

## Development

This repository is managed by ProjectWeave. For contribution and review guidance:

- [Development flow](docs/development-flow.md)
- [Review guidelines](docs/review-guidelines.md)
