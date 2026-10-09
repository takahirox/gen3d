# Optional local MPFB humanoid mode

MPFB-assisted modeling is a focused experiment for humanoids. Existing Blender modeling (`scratch`) remains the default for every project, and objects/props cannot select MPFB. There is no 3D SaaS, new server, automatic dependency installation, or asset download during modeling. Codex still uses the ChatGPT subscription path and gen3d's local Blender MCP bridge.

## Install in the Blender used by gen3d

1. Use Blender **4.2–5.x** and MPFB **2.0.x**. The adapter checks the enabled version and API at runtime; the validation report records the exact combination actually tested. Blender 4.0/4.1 and MPFB 1.x/unknown major versions are rejected. The original modeling mode still only needs gen3d's usual Blender prerequisites.
2. In that Blender's **Edit → Preferences → Get Extensions**, find **MPFB**, install it, and verify it is enabled under **Add-ons**. Save preferences. Alternatively install an official MPFB extension ZIP through **Install from Disk**. Follow [MPFB's installation guide](https://static.makehumancommunity.org/mpfb/docs/getting_started.html). Installation is an explicit user setup step with network access; modeling itself needs only local files.
3. MakeHuman is not required. Leave its auto-discovery and socket integration disabled. An untextured human can be created with MPFB's bundled base mesh and targets. Optionally obtain local eyes, hair, skin, clothing or target packs before modeling. Install downloaded ZIP packs in the MPFB sidebar under **Apply assets → Library settings → Load pack from zip file**, and restart Blender. The [system asset pack](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) supplies common body parts and materials. Additional packs are optional; exact hair, clothing, skin and identity likeness are not guaranteed. Check each asset's own license.
4. Restart the dedicated Blender process after installing/enabling MPFB. For headless gen3d, run `blender -b --python blender/gen3d_bridge.py -- --serve` using the same executable, user configuration and extension repository as the installation. A different Blender version/profile or `--factory-startup` will not necessarily load the add-on. Interactive bridge setup is unchanged; see [local setup](local-setup.md).
5. With the bridge running, execute:

   ```sh
   node scripts/mpfb-check.js
   # For a non-default bridge port:
   GEN3D_BLENDER_PORT=19877 node scripts/mpfb-check.js
   ```

   This performs a read-only check through the existing bridge. Success reports `available`, `module`, `mpfbVersion`, `blenderVersion` and `api`. Missing/disabled MPFB, unsupported versions or a changed Python signature produce setup feedback and a nonzero exit code. No installation or automatic enabling occurs.

## Select, adapt and revise

In **New project** or **Input**, select **Humanoid / character** and **MPFB-assisted humanoid**. Uploaded images also expose the profile and modeling selector; without a meaningful description, choose the humanoid profile explicitly. Text still passes through concept generation, four views, saved consistency policy and optional human checkpoints. Image input still proceeds directly to modeling.

Before clearing a scene or launching the modeling session, gen3d checks MPFB in the connected Blender. Codex then calls `mpfb_status` and `create_mpfb_human` through **gen3d_blender MCP**. The latter invokes the installed add-on's documented `HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True, scale=0.1)` and records the actual nontrivial base mesh. No guessed operator is used. The official [API documentation](https://github.com/makehumancommunity/mpfb2/blob/v2.0.17/docs/services/humanservice.md) and [create-human operator source](https://github.com/makehumancommunity/mpfb2/blob/v2.0.17/src/mpfb/ui/new_human/newhuman/operators/createhuman.py) document this entry point; the real operator is `mpfb.create_human`. Both extension module names (`bl_ext.<repository>.mpfb`) and the legacy `mpfb` namespace are recognized when enabled.

Codex receives the original prompt and every approved image as before, and adjusts the MPFB body/face, proportions, pose, styling and GLB-compatible materials. Shape keys, targets and proportional edits preserve the base topology. Installed local assets may supply details; missing assets and reconstruction compromises belong in the modeling summary. Primitive replacement, hiding the body and destructive remeshing are blocked by the final body/topology check. This check establishes retained geometry, not anatomical accuracy or identity likeness. No photorealistic skin/hair, advanced garments, rigging or animation is promised.

Missing/incompatible MPFB fails the version with actionable feedback. The task/audit remain available in history. Install/fix MPFB and deliberately retry, or explicitly choose **Existing Blender modeling**. There is no silent substitution. A usage limit stops the run without resets, purchases, provider changes or automatic retries.

The project setting is `modelingMode: "scratch" | "mpfb"` in HTTP create/PATCH, MCP `create_project`/`update_project`, and shared `project.json`. MPFB requires `profile: "character"`; objects require `scratch`. Mode changes alone retain the approved concept, reference set, consistency report and pending reviews. Every model snapshots `profile`, `modelingMode`, `imageInputs` and a SHA-256 `referenceFingerprint` of the original text and exact image paths/bytes. Older projects/scenes default to `scratch`.

**Revise selected version** copies its saved scene and keeps that version's modeling mode and image sources, even after project settings change. MPFB revisions edit the original body and do not create a new one. **Retry from input** creates a fresh model using the current project mode and selected approved images. Preview review/export gates and historical GLB/.blend artifacts remain unchanged. Successful MPFB versions additionally expose `mpfb.json` with actual version/API/mesh/topology evidence.

## Compare identical references

1. Generate a humanoid using Existing Blender modeling and review/approve the enabled checkpoints and preview.
2. In the model panel, save **MPFB-assisted humanoid** as the modeling mode, then use **Retry from input**. Keep the description, selected concept/view set and supplementary reference approvals unchanged. Do not regenerate views between runs.
3. Every new humanoid version saves `front.png`, `side.png` (left side) and `three-quarter.png`, plus the existing preview, GLB and scene. The subject convention is +Z upright, front -Y, left +X. Both modes use the same orthographic camera directions, subject-bounds framing rule, lighting rule and render resolution; this is not pixel-perfect registration when dimensions differ.
4. Expand **Front / side / three-quarter comparison**. The UI pairs the selected version with the latest completed opposite mode only when its reference fingerprint and modeling feedback match exactly. Different images/text are never presented as the same-source comparison. Historical modes, summaries and source links remain visible. Compare silhouette, anatomy, joints, face, clothing/materials and editability; distinguish measured mesh/artifact facts from subjective appearance judgments.

For a repeatable **live** experiment, start an MPFB-enabled dedicated bridge, then run:

```sh
node scripts/mpfb-validation.js
# Optional: use an existing PNG/JPEG/WebP upload instead of generating concepts/views.
GEN3D_MPFB_REFERENCE=/absolute/path/humanoid.png node scripts/mpfb-validation.js
```

This uses the installed Codex CLI and current ChatGPT allowance. It runs the production workflow in both modes against one saved source set; by default it uses native image generation, and inspection, modeling, rendering and export are real. The default uses a fictional clothed adult in A-pose. Override `GEN3D_MPFB_PROMPT`, `GEN3D_MPFB_OUTPUT` and `GEN3D_BLENDER_PORT` as needed. Optionally set `GEN3D_MPFB_REFERENCE_DIR` to a directory containing existing `concept.png`, `front.png`, `side.png`, `back.png` and `three-quarter.png`; this imports their exact bytes through the local provider instead of generating new images. Consistency inspection still runs. `GEN3D_MPFB_ON_FAILURE=continue` explicitly selects Warn and continue for the experiment; the default is `stop`. Reports identify the provider and policy so reused source images cannot be mistaken for new native generation.

Results and complete local project history are in `.gen3d/mpfb-validation` by default. It exits on failure or a usage limit and preserves progress. The harness deliberately disables human checkpoints for unattended testing; normal app defaults/review boundaries are unchanged.

## Licenses and redistribution

MPFB's [license declaration at v2.0.17](https://github.com/makehumancommunity/mpfb2/blob/v2.0.17/LICENSE.md) separates **GPL-3.0-or-later code** from **CC0 bundled assets**, including base mesh, targets and rigs. The [extension manifest](https://github.com/makehumancommunity/mpfb2/blob/v2.0.17/src/mpfb/blender_manifest.toml) declares the code license and Blender minimum. The system asset pack's official catalog lists per-asset licenses. Community assets may have different terms; do not infer a pack's license from MPFB's code or bundled data license.

gen3d integrates a user-installed local dependency and redistributes no MPFB source, extension ZIP, targets, textures or asset packs. Validation output derived from the bundled CC0 base mesh can be recorded as generated scene/model evidence. Check future versions' code/data licenses and any extra asset permissions before redistributing them.

Automated mocked policy tests and actual Blender/MPFB/Codex results are recorded separately in [issue #16 validation](validation-issue16.md).
