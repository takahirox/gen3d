# Issue #36 — task-relevant UI visibility

Validated on 2026-10-27 with Node 24.12.0 and real headless Chrome.
Browser execution uses injected providers and recorded images/GLBs. No live
Codex generation, Blender process, allowance reset, purchase or provider switch
was used. These captures demonstrate rendered UI and fixture-based interactions,
not newly generated models or live preservation validation.

## Bounded visibility audit

| Surface | Show directly | Remove | Contextual / on demand |
| --- | --- | --- | --- |
| Home / Projects | Primary Create project, compact project previews/names, project selection, existing ⋯ menu | Hero slogan; oversized single-card stretching | No projects yet only when empty; Delete retains its named destructive confirmation |
| Create project | Optional Project name with initial focus, Task, Input, applicable file, Describe, Create project | Name disclosure; technical Preset label | File input is visible and required only for Image; both Create and Edit keep ordinary fields visible |
| Studio sources/actions | Project name, Add image/model, reference profile, Four-view check, refinement, Edit parts, visible image removal; assigned model-source roles beside their thumbnails | Project details disclosure; hover-only image removal | Text/generated-view policy and enabled-refinement cycle controls retain their existing context rules; compact source ⋯ actions remain; result provenance stays in Result details |
| Model chooser | Search, Folder, upload, Use as reference, Edit this model | Filter disclosure; extra click for ordinary editing | Local-folder access/scanning and rare geometry reuse stay on demand with their consent wording; editable scope and protected-feature exceptions retain explicit human authorization |
| Workflow editor | Review checkboxes, applicable Four-view check, refinement and cycle limit, graph/node/preset controls | Repeated workflow instructions and saved-graph status paragraph; empty/off refinement history | Cost notice follows refinement, including an unsaved selection; saved comparisons, checkpoint provenance and Graph JSON remain on demand; dirty-graph invalidation warning remains |

Naming still trims an explicit name and otherwise uses the first 60 characters
of the trimmed description. The name stays optional during creation. Execution,
review gates, source rights and workflow/preservation contracts are unchanged.
Usage docs only change the visible creation labels and the direct Edit action.

## Actual checks

| Command | Result |
| --- | --- |
| `GEN3D_BROWSER_OUTPUT=.gen3d/issue36-before npm run test:browser` | 31 checks passed; zero uncaught exceptions; baseline UI with added screenshot captures only |
| `npm test` | 137 passed; 0 failed, cancelled or skipped |
| `npm run check` | Passed |
| `GEN3D_BROWSER_OUTPUT=.gen3d/issue36-after npm run test:browser` | 34 checks passed; zero uncaught exceptions |
| `git diff --check` and staged whitespace check | Passed |

The expanded browser regression checks the optional visible name and its
accessible textbox name, initial focus and native Tab order; all four Create/Edit
× Text/Image combinations; file requirements; explicit trimmed naming and blank
automatic naming through reload and Home selection; Escape and focus restoration;
populated/empty Home; visible studio name, source role and image removal; direct
chooser edit/reference/filter controls; review/cycle settings and contextual cost;
and desktop/narrow Light/Dark page and dialog overflow. Existing checks still
exercise named project deletion (including busy rejection, cancellation, keyboard
menus, another tab and the last-project empty state), source consent and MCP
denials, protected-base editing, Four-view policies and overrides, immutable review
gates, comparison, candidate selection/restore/retry/refine/accept, branching,
downloads and fixture-injected failures/usage stops without automatic retries.

Development runs of the new assertions caught create-dialog focus restoration
and an empty refinement section whose saved status was `off`; both were fixed.
The focus assertion also now waits for the native dialog close event before
checking restored focus. Final results above include those fixes. No checks were
removed or skipped to obtain the final result.

Browser reports: [before](validation/issue36/before-browser-report.json),
[after](validation/issue36/after-browser-report.json).
No live Codex/Blender or real screen-reader session was performed: the change is
limited to UI information hierarchy. Browser accessibility-tree/keyboard checks
and fixture-based preservation/review checks are not live generation evidence.
Optional human first-use feedback was not collected. No post-merge verification
is required by the Issue.

## Actual screenshots

Desktop captures are 1440×1050; narrow captures are 390×844. Before captures use
the upstream UI; after captures use the changed UI in the same fixture browser.

| Surface | Before | After |
| --- | --- | --- |
| Home, populated | [Before](validation/issue36/before/home-populated.png) | [After](validation/issue36/after/home-populated.png) |
| Home, empty | [Before](validation/issue36/before/home-empty.png) | [After](validation/issue36/after/home-empty.png) |
| Create, Text | [Before](validation/issue36/before/create-text.png) | [After](validation/issue36/after/create-text.png) |
| Create, Image | [Before](validation/issue36/before/create-image.png) | [After](validation/issue36/after/create-image.png) |
| Studio, before generation | [Before](validation/issue36/before/desktop-empty.png) | [After](validation/issue36/after/desktop-empty.png) |
| Studio, candidate | [Before](validation/issue36/before/desktop-studio.png) | [After](validation/issue36/after/desktop-studio.png) |
| Model chooser | [Before](validation/issue36/before/desktop-asset-selection.png) | [After](validation/issue36/after/desktop-asset-selection.png) |
| Workflow editor | [Before](validation/issue36/before/desktop-workflow.png) | [After](validation/issue36/after/desktop-workflow.png) |

Additional after captures:

- [Home with preview](validation/issue36/after/home-candidates.png),
  [narrow Light](validation/issue36/after/narrow-home-light.png),
  [narrow Dark](validation/issue36/after/narrow-home-dark.png),
  [empty Light](validation/issue36/after/home-empty-light.png),
  [empty narrow Light](validation/issue36/after/narrow-home-empty-light.png),
  [empty narrow Dark](validation/issue36/after/narrow-home-empty-dark.png).
- [Edit with Text](validation/issue36/after/create-humanoid-text.png),
  [Edit with Image](validation/issue36/after/create-humanoid-image.png),
  [create narrow Light](validation/issue36/after/narrow-create-light.png),
  [create narrow Dark](validation/issue36/after/narrow-create-dark.png).
- [Studio Light](validation/issue36/after/desktop-studio-light.png),
  [Studio Dark](validation/issue36/after/desktop-studio-dark.png),
  [studio narrow Light](validation/issue36/after/narrow-studio-light.png),
  [studio narrow Dark](validation/issue36/after/narrow-studio-dark.png),
  [visible model role](validation/issue36/after/studio-source-role.png).
- [Chooser narrow Light](validation/issue36/after/narrow-asset-selection-light.png),
  [chooser narrow Dark](validation/issue36/after/narrow-asset-selection-dark.png),
  [copy consent](validation/issue36/after/desktop-copy-consent.png),
  [protected edit scope](validation/issue36/after/desktop-base-consent.png).
- [Direct workflow settings](validation/issue36/after/workflow-settings.png),
  [workflow narrow](validation/issue36/after/narrow-workflow.png),
  [human review](validation/issue36/after/desktop-manual-review.png),
  [comparison](validation/issue36/after/desktop-comparison.png),
  [delete confirmation](validation/issue36/after/desktop-delete-dark.png).
