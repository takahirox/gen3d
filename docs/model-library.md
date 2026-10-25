# Local 3D model library

Primary input stays **Text OR Image**. Text still creates a concept and all four
modeling views, with consistency inspection; Image still uses its upload.
Optional 3D references supplement those images. They never replace them.

Open **Sources → Add 3D model** in the studio Sources panel, or **Asset library** in the navigation. Import a model once and select it for any number
of projects. Select zero, one or several models (up to 32); use filename search,
source filters and 40-entry pages. Blender creates small, solid material-color
previews on import/first selection. These previews show shape rather than a
photorealistic texture render. Browsing loads metadata and lazy 160px previews,
not every full 3D file.

**Managed imports** are copies stored in the shared library. **External folder**
entries point to files in a human-configured absolute local directory. Configure
that directory in the library dialog, then rescan after adding or moving files.
Its files are never copied into projects or modified. Scans include subfolders,
skip symlinks, and stop at 8 levels, 20,000 entries or 5,000 model files, with a
visible limit message. Missing files and inaccessible folders remain visible with
an error so project/history IDs are not silently replaced. Restore the source or
detach/reselect an available entry. Folder scans validate headers; full validation
and Blender inspection happen when selecting a model. Uninspected folder entries
have no thumbnail until first selection.

Choose **Use as reference** on a model to add appearance guidance immediately.
This single action stores and audits inspection-only consent for that model;
there is no second selection/save step. Uploading alone grants no rights.

**More… → Use parts of this model** opens a contextual copying confirmation and
optional instruction (hair, clothing, chair legs, etc.). Confirm only when you
have the right to copy and change that geometry. This never grants full-model
edit scope. **Edit this model** opens a read-only 3D preview: click parts, or focus
and select the numbered part controls with a keyboard. **Edit selected parts**
grants only that full-base scope and switches ordinary creation to **Improve**.
Exact source names and explicit protected-feature exceptions remain in collapsed
advanced controls. The preview is a display copy; editing and preservation checks
always use the complete original scene. If the preview cannot display a part,
a warning directs you to exact names; features are never silently unlocked.

MCP proposals remain pending until a human chooses the intended use in the
studio. Changing use never approves another pending source. Pending entries
block generation even with checkpoints disabled; rejected entries are excluded.
A source's **⋯** menu changes use or removes it from the project, preserving the
shared library asset. The server enforces human-only approval, file identity,
part scope and per-project consent. It does not change licensing rights.
MCP cannot approve sources or configure a new host folder.

Generation/retry snapshots approved selections, roles, permissions, source type,
file identity, SHA-256 and Blender inspection. Revisions and refinement retain
the source version's original model-reference snapshot, just as they retain its
input imagery. Changing current selections affects a new generation/retry; revise
an existing model with its original approved sources. Source content is checked
again before loading/export; replacing a source requires reinspection and a new
approval, rather than silently changing an in-progress job. The studio shows selected sources, instructions and permissions; Workflow editor
checkpoint details retain exact source identities and hashes.

## Generation visuals and editable starting geometry

Before Codex models, Blender renders **every selected asset** in eight material
views: both directions of X/Y/Z and two opposite elevated three-quarter views.
Camera-axis labels use source coordinates rather than assuming a shared GLB
front/up orientation. Framing fits projected subject bounds separately in every
view. Codex infers subject orientation from all views. These show Blender
materials/textures, beyond the small solid-color browsing thumbnail.

Each asset gets a labeled 1536 × 884 contact sheet with eight 384px views. Every
sheet is attached to modeling vision after the original input or concept/four
required views and supplementary approved images. The limit remains 32 models
(32 sheets, about 43 million sheet pixels), plus existing file/geometry limits.
Rendering runs serially with a 180-second timeout per asset and consumes no
Codex allowance. Failed, missing, invalid or changed renders stop with a named
asset error; an entirely blank/unobservable render set also fails explicitly.
Metadata is never substituted or an asset silently omitted. Large
selections cost local render time and additional Codex vision/context usage.
Small views cannot reveal all fine details; likeness/quality is not guaranteed.

History/source panels show exactly what Codex saw. Versioned
`reference-renders/<assetId>/*.png` and `model-references.json` retain the
asset/view/camera/image mapping, render hashes, approved source hashes and roles.
`vision-inputs.json` records the ordered modeling attachments. Revisions and
refinement retain and hash-check the original render set.

Codex must structurally inspect every asset with `inspect_reference_model`, then
call `choose_reference_usage` for each with a concrete suitability reason.
Reference-only assets stay visual-only. Suitable reuse-edit meshes/parts are
preferred starting geometry through `reuse_reference_mesh`, followed by
adaptation rather than rebuilding equivalent detailed parts with primitives.
Unrelated authorized models may remain visual-only with an explicit reason.
Different roles can guide different permitted pieces (face/body/hair/clothes).
Selecting an asset does not force its inclusion. Without suitable reusable
sources, scratch modeling remains available. Primary images/text and approved
generated views define the design; roles guide missing details/style/topology
without overriding requested stylized/anime proportions.

Decisions are audited and checked against surviving copied objects after export.
Evidence records `assetId`, source `objectName`, `targetObject`, reuse `method`,
role and SHA-256. Ordinary Blender mesh joins preserve every contributing
asset and source object, including multiple parts from one asset: the combined
target has one provenance entry per surviving origin. Point-domain
`gen3d_reused_origin_*` masks and the scene's `gen3d_reused_origins` registry
carry these origins through joins and into the saved `.blend`; preserve both
when editing. Validation checks the evaluated mesh, so removed pieces do not
count as surviving reuse. Reuse without permitted surviving geometry, or
visual-only decisions with copied geometry, fail validation.

Guidance favors shape keys, proportional editing, controlled transforms and
topology-preserving changes. Mirror, Subdivision Surface and Displacement are
optional tools, not required effects. Export checks evaluated finite/nonempty
geometry and shape-key integrity, and rejects source-object/rig dependencies
and shared source mesh/material data. Permitted copies have independent mesh,
material, nested material node-group and image data. Unsupported procedural
shaders are not automatically baked to glTF textures: the modeler must bake
detail or use exportable materials and inspect actual output. Smoothing primitives
or adding noise is not automatic detail reconstruction.

## Formats and limits

- **GLB 2.0**, containing meshes and embedded buffers/textures. Embedded base64
  data URIs and PNG/JPEG/WebP textures are supported by the Blender importer; external files/URLs are rejected.
- **Uncompressed `.blend`**, compatible with the installed Blender. Make linked
  libraries local and use **File → External Data → Pack Resources**. Save with
  compression disabled. Both legacy 12-byte and current 17-byte Blender headers
  are validated; the actual installed Blender must also load the file.
- Standalone glTF, FBX, compressed .blend files, linked libraries, unpacked textures,
  external caches, fluid and geometry-node modifiers are currently unsupported.
  They fail clearly rather than producing a partial imported asset. Export to a
  self-contained GLB, or bake a standalone packed mesh file first.
- Maximum 64 MiB/file, 2,000 objects and 2 million vertices/asset. A job accepts at
  most 32 references totaling 256 MiB, 8,000 objects and 8 million vertices.
  Blender inspection has a 60-second timeout and does not consume Codex allowance.
- Mesh reuse copies mesh data (including shape keys), material data and the world
  transform. It does not copy animation/rigs or objects needed by constraints and
  object-dependent modifiers. Such meshes must be prepared as standalone meshes
  before duplication; they can still be inspected where their packed file loads.

The current header specification comes from
[Blender's file-header definitions](https://github.com/blender/blender/blob/main/source/blender/blenloader_core/BLO_core_blend_header.hh).

## Blender and local file boundaries

Install Blender on the HTTP server's machine; set `GEN3D_BLENDER_BIN` when it is
not on PATH. Inspection launches an isolated background Blender process with
`--factory-startup --disable-autoexec`, appends/imports mesh data, disables loaded
drivers and refuses missing/external dependencies. No asset server, download,
paid API or new modeling mode is involved.

The modeling runner imports **every approved reference** through the existing
local Blender bridge into separate `gen3d_reference_<assetId>` scenes before
Codex starts. Codex must call `inspect_reference_model` for each asset; successful
per-asset inspections are checked in its MCP audit. It can inspect actual mesh,
material-node, topology and shape-key data through ordinary Blender Python.
`reuse_reference_mesh` refuses inspection-only assets and creates independent
permitted mesh/material copies in the deliverable scene after a recorded
suitability decision. The prompt asks Codex to
explain how each role informed the result, while keeping required imagery as the
design authority, including stylized/anime proportions where requested.

Before render, GLB export and `.blend` save, the app removes all tagged reference
objects (even accidentally linked ones), their inspection scenes and unused
data. Approved independent copies retain geometry provenance, checked against
the job's reuse permission for every contributing origin. Original library paths
are only read. Job `model-references.json` records the loaded-scene evidence and original snapshot;
MCP audits record inspections and successful reuse operations without raw code.

Use trusted local files and local modeling instructions. Blender's Python MCP
bridge is a local execution capability, not a security sandbox for malicious
Python or crafted native Blender files. The library validates extensions,
contents, sizes, canonical paths and symlinks; it exposes no arbitrary-file HTTP
route. Folder access is explicitly granted by the human; remote clients cannot
configure it through gen3d MCP. Server Host/Origin protections remain in effect.

## Storage and API

Default shared storage is `~/.gen3d/library/`, or
`$GEN3D_DATA_DIR/library/`. `library.json` owns metadata/folder configuration;
`<assetId>/model.glb` or `model.blend` holds a managed import, with inspection JSON
and small previews beside it. Folder entries store metadata/previews only.
Projects use schema 2, with `modelReferences` and per-version snapshots. Old
project schemas are unsupported; there is no migration. Use a fresh managed data
directory as described in [local setup](local-setup.md#start-fresh). Never delete
an external source folder when clearing the managed store.

HTTP: `GET /api/library?search=&sourceId=&offset=0&limit=40`,
`POST /api/library/imports` (`name`, raw base64 `data`),
`POST /api/library/sources` (`directory`, Web UI only),
`POST /api/library/sources/:id/scan`,
`POST /api/library/assets/:id/inspect`,
`GET /api/library/assets/:id`, `GET /api/library/assets/:id/preview`,
`POST /api/projects/:id/model-references` (`models: [{assetId, role, permission}]`),
and `POST /api/projects/:id/model-references/:assetId/review` (`decision`, Web UI
only). Folder and model IDs refer only to saved entries; API paths cannot select
arbitrary host files.

MCP uses the same HTTP owner: `list_model_library`, `get_library_model`,
`inspect_library_model`, `import_library_model`, `scan_model_folder`,
`select_model_references`, and the `gen3d://library` resource. Existing
`get_project`/project resources expose selection, approval and generation history.

Run `npm test`, `npm run check`, `npm run test:browser`, and
`npm run test:library-blender`. The last command requires local Blender and checks
real files, shape-key/material copying, permission refusal, source hashes and
export isolation without Codex allowance. `npm run validate:library-live` is an
opt-in real Codex + Blender trial using four distinct GLBs (body, doors, hardware,
feet), the recorded cabinet input and bounded refinement. It saves sources,
renders, decisions, audits and exports and never retries or resets a limit.
See [Issue #21 evidence](validation-issue21.md) for actual results and limitations.
See [Issue #24 evidence](validation-issue24.md) for four-GLB visual attachment,
reuse/adaptation, semantic modifier and role-aware refinement results.

## Complete editable bases

Choose **More… → Edit this model** in the source chooser, select parts in the visual picker, then **Edit selected parts** to grant full-base edit scope. Reference-only inspection and `reuse-edit` mesh permission do not grant this authorization. A base node copies the complete scene, including supported skeleton/weights/expressions, and checks the initial GLB roundtrip. Human-scoped editable objects and protected features are verified after editing. See [workflow preservation contracts and supported capabilities](workflows.md#complete-base-preservation). The mesh-only limitations above still apply to supplementary reference reuse.
