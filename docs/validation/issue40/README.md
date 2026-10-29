# Issue #40 validation

Validated locally with Blender 5.1.2 and Node 26.12.1. All edits are deterministic Hair-only mesh edits through real Blender; no Codex generation, external asset or provider allowance was used. No actual Mixamo-exported sample was supplied or tested. The fixtures reproduce the reported error and representative hip/root conventions, rather than claiming to identify every cause of that error in an unavailable file.

## Reproduction and diagnosis

[rest.glb](rest.glb), [posed.glb](posed.glb) and [scaled.glb](scaled.glb) are minimal, versioned, independently glTF-authored inputs. Their deterministic generator and assertions live in [scripts/mixamo-bind-check.py](../../../scripts/mixamo-bind-check.py). Each has a `Character` ancestor, a transformed `Rig`, `mixamorig:Hips` → `mixamorig:Spine`, and two named skinned triangles with mixed 0.3/0.7 weights. The skinned meshes have deliberately nonidentity node/parent transforms. The posed variant translates/rotates the hip and rotates its child; the scaled variant additionally uses a uniform 0.01 armature scale. Tests compare regenerated source hashes against the versioned fixtures.

Both rest and posed fixtures reproduce this failure against `9ea358f941f267f7ea4c8e83a440ad46dedcf885`:

```text
Unverifiable GLB bind/rest after import: mixamorig:Hips; encoded transforms cannot be retained by the supported Blender bind-frame representation
```

[rest-baseline.json](rest-baseline.json) and [posed-baseline.json](posed-baseline.json) record the source node matrices, skin inverse binds, skeleton reference/ancestry, mesh transforms, imported object transforms, bone rest/pose/basis matrices, bind positions, weights and evaluated positions. With C the glTF-to-Blender axis conversion, A the glTF world matrix of `Rig`, and I a source inverse bind, the expected world rest is C I⁻¹. The baseline instead produces C A I⁻¹: it applies the armature world frame twice. Measured hip rest matrix error is **0.517963469** and child error **0.598365843**, while posed-joint errors remain below **0.00000015**. The predicted duplicated-frame matrices match the actual imported rest matrices within **0.00000015**.

This matches the local Blender importer implementation: `pick_bind_pose()` in `io_scene_gltf2/blender/imp/vnode.py` assumes inverse binds are skeleton-relative, seeds the skeleton's inverse bind with identity and decomposes joint-relative binds into translation/rotation. `skin_into_bind_pose()` in `imp/mesh.py` retargets mesh coordinates to that guessed rest. The old verifier correctly refuses to establish these changed rest semantics as a baseline, even where skin retargeting makes appearance plausible. This is an importer frame mismatch in these valid fixtures, not proof of broken source data.

Reproduce both baseline failures and run the focused real Blender checks:

```sh
mkdir -p .gen3d
git show 9ea358f941f267f7ea4c8e83a440ad46dedcf885:blender/preservation.py > .gen3d/issue40-baseline.py
blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python scripts/mixamo-bind-check.py -- --baseline .gen3d/issue40-baseline.py
```

## Import and export strategy

A disposable GLB supplies the existing armature parent as the skeleton reference and expresses the skin in that frame: I′ = I A, v′ = A⁻¹v. Therefore J I′ v′ = J I v for every original posed joint J. Morph position deltas use only the linear part, normals use the inverse transpose, and tangents use the direction transform. Accessors and meshes are cloned per skin so shared source data is not overwritten. Source files, source joint transforms, hierarchy and weights remain untouched. A skeleton reference to the hip, armature or a higher common ancestor, or an omitted reference, has equivalent supported semantics.

Blender imports native rest bones and a static pose in the correct world frame. The original source GLB, not the disposable copy, supplies the expected world rest matrices, posed-joint matrices, hierarchy, per-position weights and independently evaluated skinned triangles for verification. Export uses the existing current-pose/inverse-bind path. No pose reset, pose-as-rest operation, hierarchy reconstruction or deformed-mesh baking is performed. The saved `.blend` natively retains the verified equivalent rig; this fix requires no hidden metadata to reconstruct its bind semantics. Reports retain `static-joints-and-inverse-binds-v1` and add `bindImportStrategy: armature-frame-skin-coordinates-v1`.

Skinned mesh node transforms do not participate in glTF skin evaluation. Blender parents the native meshes to the armature and stores equivalent bind coordinates there; the ignored source mesh-node transform is not presented as a retained Blender authoring transform. Source joint ancestry, joint worlds, inverse-bind semantics, world-space bind geometry and actual skin deformation are verified. The existing saved-scene parenting protections still apply to edits.

[rest-import.json](rest-import.json), [posed-import.json](posed-import.json) and [scaled-import.json](scaled-import.json) record the corrected native imports, including measured rest/pose errors. [posed-edited.glb](posed-edited.glb) is an inspectable deliverable after the Hair-only edit. The tests reopen each saved candidate `.blend`, compare protected scene features, independently reopen its exported GLB and then export/import again. [report.json](report.json) records seven passing variants: rest, posed, uniform 0.01 scale, an active protected Body morph, omitted skeleton, armature skeleton and higher ancestor skeleton.

Raw GLB comparisons independently decode both the original source and edited/re-exported outputs without importing them. Across all variants and both export generations, maximum measured errors are:

| Measurement | Maximum | Required bound |
| --- | ---: | ---: |
| Joint world matrix entry | 0.000000358 | 0.00002 |
| Inverse-bind matrix entry | 0.000015259 | 0.00002 |
| Inverse-bind-derived rest matrix entry | 0.000000362 | 0.00002 |
| Protected bind position | 0.000000362 | 0.00002 scene units |
| Protected evaluated surface position | 0.000000389 | 0.00002 scene units |
| Protected bind normal vector | 0.000014235 | 0.0002 |
| Skin weight | 0 | unchanged |

The larger raw inverse-bind entry error occurs at the 0.01 unit scale. Existing thresholds were not relaxed. Production checks also retain oriented topology, corner normals, hierarchy, weights, current morphs and all earlier protected scene features. Every source hash remains unchanged.

## Negative cases and limits

The 15 new negative cases reject saved-scene and export-only hip-pose, child-parent, weight and protected-surface changes; export-only inverse-bind drift, singular binds, independent rest scale and nonfinite binds; source zero weights and a skeleton outside the joint ancestry; and nonuniform armature export normal loss. Failed validation removes stale success evidence. An inverse-bind drift can describe a different valid source rig, but it is unauthorized when substituted for the candidate's protected bind data and is rejected accordingly.

Independent armature-local bind scale/shear cannot be represented by native Blender edit-bone rest matrices. Such input now reports `Unsupported Blender bind representation` with the joint and degree of freedom, instead of implying the source is invalid. Shared joints with conflicting inverse binds and singular armature frames also fail explicitly. This path does not provide metadata-assisted retention of those independent rest degrees of freedom. Singular/nonfinite source binds and invalid weights are distinguished as invalid source data.

Blender 5.1.2 also exports changed normals for a rotated, nonuniformly scaled armature. The nonuniform fixture imports, but its base export/reopen comparison blocks on protected geometry/evaluation. The guard is preserved; this combination is not advertised as supported. Roots without one common named armature parent and the existing animation, constraint, driver, material, morph-mask and extension limits remain unsupported. The #38 pose, bone-scale, expression, surface, inheritance and visibility regressions remain in the same real Blender suite.

## Production workflow and browser evidence

[workflow-report.json](workflow-report.json) records the full preservation suite plus the real Store/Runner/workflow path for rest, posed and 0.01-scale GLBs. Production library inspection, part-preview generation, preparation, export/render, saved-scene validation, reopened-GLB validation, persisted scope and export gating execute with real Blender. Every case has exactly one human authorization for Hair, rejects MCP authorization, preserves Body/rig and source bytes, and completes. Production picker surfaces are independently measured against evaluated source triangles. The existing constrained-base case still fails before the deterministic modeler runs and produces no base checkpoint.

[browser-report.json](browser-report.json) records **38 passing checks and zero browser exceptions**, including the existing #38 `.blend`/GLB cases and new rest/posed fixtures through **Edit this model → Edit selected parts → Improve**. [browser-rest.png](browser-rest.png) and [browser-posed.png](browser-posed.png) show the resulting exportable fixtures. These cases use the production part-preview callback, actual Blender preparation, deterministic mesh editing, production export/render and preservation. Surrounding provider callbacks, asset-inspection summaries and cabinet thumbnails/reference images are injected browser fixtures; no actual AI modeling or real asset thumbnail inspection is claimed for those callbacks. The separate Store workflow checks perform real asset inspection. No product UI panel, conversion switch or authorization exception was added.

## Actual command outcomes

- `npm test`: passed, **138 tests**, zero failures or skips.
- `npm run check`: passed.
- Focused baseline/roundtrip command above: passed; both baseline failures recorded.
- `npm run test:workflow-blender`: passed, real Blender, seven new positive variants, 15 new negative cases, three new production workflow cases and all existing regressions.
- `npm run test:library-blender`: passed, real Blender; [library-report.json](library-report.json).
- `GEN3D_BROWSER_POSED_FIXTURES=.gen3d/workflow-blender-check/posed GEN3D_BROWSER_MIXAMO_FIXTURES=.gen3d/workflow-blender-check/mixamo npm run test:browser`: passed, 38 checks, zero exceptions.

An exploratory nonuniform-armature roundtrip failed and is retained as an expected negative regression. During development, an extra early source-normal guard intercepted the existing winding-negative diagnostic and failed its assertion; that extra guard was removed and the original independent winding and normal regressions pass unchanged. An initial fixture edit applied vertex changes to Hair containing shape keys without changing its Basis; morph coverage was corrected to place the protected expression on Body. These development failures are not presented as passing runs.

Optional real Codex generation was not run; no provider allowance was used or reset. Optional testing of an actual Mixamo-exported model remains unperformed because no such authorized sample was supplied. No mandatory check was skipped for lack of Blender/browser prerequisites. No post-merge verification is required by #40.
