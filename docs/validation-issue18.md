# Issue #18 historical exporter validation

The generation/refinement experiment and its superseded state examples have been removed in Issue #20. Git history retains that provenance. This page retains isolated exporter evidence from 2026-10-10 for behavior that remains supported. It does not report validation of the current release; see [Issue #20 validation](validation-issue20.md) for current checks.

`scripts/refinement-export-check.js` ran with real Blender 5.1.2 and deterministic edits, using the production exporter. A material-only change and a camera-only change each changed the input render while all stage mesh hashes stayed identical. Scale **42** and target center **[1, 2, 3]** persisted through fresh renders and reopening/exporting the saved scene. All four reference views honored independent scale/center overrides. Invalid overrides failed explicitly.

See the [Blender report](validation/issue18/review-fixes/blender-report.json) and [initial](validation/issue18/review-fixes/initial.png), [material edit](validation/issue18/review-fixes/material.png), and [camera edit](validation/issue18/review-fixes/camera.png) renders.

A later real exporter check captured the production preparation code with injected authentication/image validation, then executed it and the exporter in Blender. A revision retained scale **42** and center **[1, 2, 3]**. Subsequent generation and retry cleared both direction properties and framing, then rendered a new cube at the bounds-based scale **2.6** and center **[0, 0, 0]**. See the [saved Blender report](validation/issue18/framing-reset/blender-report.json).

No Codex modeling/inspection turn or human visual review was performed for these deterministic exporter checks. They establish state isolation, framing and export behavior without claiming visual quality improvement.
