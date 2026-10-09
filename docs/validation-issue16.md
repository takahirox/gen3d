# Issue #16 validation: optional MPFB humanoids

## Automated checks (mocked modeling)

- `npm test`: **102 tests passed**. New coverage includes mode validation/persistence/migration, object exclusion, unchanged concepts/reviews/policies on mode changes, identical image linkage/fingerprints, both directions of saved-scene revision, missing/incompatible preflight failures before scene clearing/modeling, explicit scratch recovery, mandatory creation/topology/render evidence, shared HTTP/MCP settings, and the real stdio MCP adapter over a mocked TCP bridge.
- `npm run check`: JavaScript syntax checks passed, including the new adapter and validation scripts.
- `npm run test:browser`: the stage/review/consistency/history/browser regression passed. Added checks cover mode selection, missing-MPFB feedback, immutable baseline history, same-source comparison, image profiles and object exclusion. [Browser report](validation/issue16/mocked-browser-report.json) has no JavaScript exceptions. Modeling is deliberately mocked using recorded prop artifacts; this is **not** evidence that MPFB generated those fixture meshes.
- Focused MPFB/comparison checks also passed after the final comparison-feedback adjustment.

## Real local environment and API

Validation used Node 24.12.0, subscription-authenticated Codex CLI 0.161.0, Blender 5.1.2, and MPFB 2.0.17 from official tag `v2.0.17` (commit `80919fa4682335c41847f761a4d79dcad4124732`). MPFB was installed into a temporary extension repository/profile, not bundled in gen3d. No optional asset packs or remote MakeHuman service were used.

[Runtime evidence](validation/issue16/runtime-checks.json) records an actual `create_mpfb_human` call through gen3d's stdio MCP server → existing local TCP bridge → installed `HumanService.create_human`. The base had **19,158 vertices / 18,486 polygons**, with **13,380 evaluated vertices** after helper masking. Verification passed on the original dense mesh and rejected a hidden body and a replaced mesh. An unsupported advertised `VERSION` was temporarily simulated on the actual installed add-on, rejected, and restored; this does not claim a separate unsupported MPFB release was installed.

A [real image job without MPFB](validation/issue16/missing-mpfb.json), using a separate factory-startup Blender, failed with setup instructions before scene clearing or Codex `exec`. Login status and read-only availability checks were the only process/bridge operations. Automated tests separately establish deliberate recovery by selecting scratch and preservation of the failed MPFB version.

The first validation setup command encountered Blender's behavior of ignoring a nonexistent override directory and affected the ordinary user's extension-repository settings. The experimental repository was removed and Blender's standard repositories were restored, while other preferences were retained. There was no prior preference backup, so earlier custom repository settings could not be verified. Subsequent installation and modeling used pre-created isolated directories.

## Identical-source live comparison

The real text workflow generated a fictional clothed adult concept plus front, left-side, back and three-quarter views through native Codex image generation. All five images are in [references](validation/issue16/references/concept.png), with exact byte hashes in [reference-hashes.json](validation/issue16/reference-hashes.json).

The initial consistency inspector detected arm-pose discrepancies and **Stop correctly blocked modeling**; see [original Stop report](validation/issue16/original-stop-report.json). The comparison explicitly selected **On + Warn and continue**, importing those same saved image bytes through the validation script's local-reference provider, and ran a new real Codex inspection. It retained the failed inspection and warnings; no existing reference-set policy or image bytes were altered. Both modeling modes receive the base and all four views plus the same original text and modeling instructions. These are real source images reused from native generation, not freshly generated replacement views or synthetic unit-test fixtures.

Both production modeling jobs completed successfully. [Measured report](validation/issue16/report.json) records equal `imageInputs` and `referenceFingerprint`, elapsed time, actual artifacts and file hashes. The [standalone side-by-side comparison](validation/issue16/comparison.html) and [actual Web UI comparison](validation/issue16/ui-comparison.png) show front, left-side and three-quarter results. The [MCP state excerpt](validation/issue16/mcp-shared-state.json) confirms both historical modes, source linkage, exports and the saved inconsistency warning are visible through the shared API.

| Result | Existing Blender modeling | MPFB-assisted initial model |
| --- | --- | --- |
| Exported meshes (verified GLB count) | 138 | 56 |
| Dense MPFB body (verified) | Not applicable | 19,158 vertices / 18,486 base polygons; 53,514 evaluated vertices after modifiers |
| Original body topology | No MPFB requirement | Original topology hash retained; body visible, helper masking retained |
| Outputs | [GLB](validation/issue16/scratch/model.glb), [.blend](validation/issue16/scratch/scene.blend), [summary](validation/issue16/scratch/summary.txt) | [GLB](validation/issue16/mpfb/model.glb), [.blend](validation/issue16/mpfb/scene.blend), [summary](validation/issue16/mpfb/summary.txt), [body evidence](validation/issue16/mpfb/mpfb.json) |
| Browser validation | [Passed](validation/issue16/scratch-browser/report.json) | [Passed](validation/issue16/mpfb-browser/report.json) |

Chrome loaded each actual GLB, downloaded byte-identical artifacts, and verified orbit, pan and zoom with no JavaScript exceptions. Initial attempts timed out when headless Chrome was started without software WebGL; restarting with `--use-angle=swiftshader --enable-unsafe-swiftshader`, as in the regression harness, resolved that environment issue.

The following are **subjective visual observations**, based on the committed renders, not measured anatomical accuracy or a claim that MPFB is uniformly better:

| Aspect | Existing Blender modeling | MPFB-assisted initial model |
| --- | --- | --- |
| Silhouette | Recognizable clothed adult in A-pose; straight simplified limbs and torso | More shaped torso, hips, thighs and calves; proportions differ from the reference |
| Anatomy / joints | Visibly separate shoulders, arms, wrists and trouser legs; useful broad shape, limited continuous anatomy | Continuous body and more shaped shoulders/limbs; initial wrists and fingers are severely distorted, with stray detail pieces nearby |
| Face | Readable eyes/nose/mouth assembled from distinct rounded parts | More continuous face surface and profile; approximate expression/identity and plain eyes |
| Clothing / materials | Simple, relatively clean segmented shirt/trousers/shoes; diffuse colors | Body-conforming color regions/clothing, but jagged neckline, sleeves and hem; simple skin/materials |
| Hair | Rounded clumps suggest short hair | Approximate cap and clumps; does not reconstruct realistic hair |
| Editability | Separate objects support component edits; saved scene reopens | Dense body, target/shape data and original topology retained; source-scene revision is tested separately |

This is evidence of a viable optional base-mesh path, and also evidence that free-form Codex adaptation can damage anatomy and garment boundaries even when topology is preserved. The experiment does **not** establish photorealistic likeness or production-ready hands/clothes. The generator accurately reports missing local garment/hair assets and these limitations.

## Real saved-scene revision

The production HTTP revision endpoint loaded an exact copy of the completed MPFB scene and sent the same five references to Codex with explicit feedback to repair hands and garment boundaries. The [revision report](validation/issue16/revision-report.json) verifies the source copy, retained original body topology, unchanged image fingerprint, and unchanged hashes of **all original artifacts**. The revision audit contains no new MPFB creation call; it edits the saved body.

The revised [front](validation/issue16/revision/front.png), [side](validation/issue16/revision/side.png) and [three-quarter](validation/issue16/revision/three-quarter.png) renders visibly remove the nearby stray pieces, reduce wrist/finger distortion and smooth the shirt openings. This is a subjective visual improvement, not a quantitative anatomy score. Minor cuffs, face/hair likeness and fabric detail remain approximate, as the [modeling summary](validation/issue16/revision/summary.txt) reports. The revised [GLB](validation/issue16/revision/model.glb) and [scene](validation/issue16/revision/scene.blend) are retained independently of the original two outputs. The revision GLB also passed [browser loading, download-hash and orbit/pan/zoom checks](validation/issue16/revision-browser/report.json) with no JavaScript exceptions. This run uses additional feedback and is **not** treated as a fresh equal-instruction baseline comparison by the UI.

## Scope and limitations

One fictional adult, one image set and one local Blender/MPFB/CLI combination form a feasibility study, not a statistical quality evaluation. The reference set itself has recorded pose contradictions. No exact identity likeness, photorealistic skin/hair, advanced garments, rigging or animation is claimed. Optional asset packs, alternative operating systems, other MPFB patch versions and interactive Blender installation UI were not tested. The supported range is capability/version checked; only the combination above has live evidence here.

No mandatory post-merge check is identified; environment-specific validation belongs before merge and is recorded here.
