# Local 3D model library

Primary input stays **Text OR Image**. Text still creates a concept and all four
modeling views, with consistency inspection; Image still uses its upload.
Optional 3D references supplement those images. They never replace them.

Open **3D model library** in the sidebar, or **Browse & select models** under
Input → Optional 3D references. Import a model once and select it for any number
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

For each selection, optionally specify a role or instruction (face, proportions,
hair, clothing, pose, topology, overall style, etc.). Choose **Inspect only** or
**Allow duplication & editing**. Save selections, then explicitly approve each
selection in the project. Inspection-only permission does not authorize copying
meshes, materials or shape keys. New selections and changes to instructions,
permission or file content require human approval. Rejected entries are excluded;
pending entries block generation even if other checkpoints are disabled. MCP
clients can propose selections and reuse permission, but cannot approve them or
configure a new host folder. Detaching leaves the shared model available to other
projects. Approval is per project; it does not grant permission in another one.

Generation/retry snapshots approved selections, roles, permissions, source type,
file identity, SHA-256 and Blender inspection. Revisions and refinement retain
the source version's original model-reference snapshot, just as they retain its
input imagery. Changing current selections affects a new generation/retry; revise
an existing model with its original approved sources. Source content is checked
again before loading/export; replacing a source requires reinspection and a new
approval, rather than silently changing an in-progress job. History and the model
source panel show the exact sources, instructions, permissions and hashes.

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
permitted mesh/material copies in the deliverable scene. The prompt asks Codex to
explain how each role informed the result, while keeping required imagery as the
design authority, including stylized/anime proportions where requested.

Before render, GLB export and `.blend` save, the app removes all tagged reference
objects (even accidentally linked ones), their inspection scenes and unused
data. Approved independent copies retain `gen3d_reused_from` provenance, checked
against the job's reuse permission. Original library paths are only read. Job
`model-references.json` records the loaded-scene evidence and original snapshot;
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
opt-in real Codex + Blender trial using two selected models and the recorded
cabinet input; it uses ChatGPT allowance once and never retries or resets a limit.
See [Issue #21 evidence](validation-issue21.md) for actual results and limitations.
