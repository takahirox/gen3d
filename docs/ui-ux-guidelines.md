# UI/UX Guidelines

**Simple and intuitive; let the layout speak.** This is the canonical standard for gen3d UI implementation and review. Apply this checklist to the rendered user path.

## Principles

- [ ] **Make layouts self-explanatory.** Use position, grouping, hierarchy, whitespace, scale, previews and spatial relationships to reveal the basic flow. Fix confusing layouts instead of adding explanatory paragraphs or secondary labels; basic use must not require a prose tutorial.
- [ ] **Make the next action obvious.** Users must see where to provide input/sources, which action is primary, what is happening and where results appear. Use familiar controls and concise action labels.
- [ ] **Show what matters.** Keep everyday inputs and frequently used controls visible where relevant, including Project name in Create project and Four-view check beside model preparation. Do not bury ordinary actions in `<details>`, multiple menus or an advanced editor to make a screen sparse.
- [ ] **Remove what does not matter.** Delete decorative slogans, redundant headings, repeated secondary labels, needless status prose and instructions for self-evident controls. Removing unnecessary information is different from hiding necessary information; collapsing either indiscriminately is not simplification.
- [ ] **Reveal by relevance.** Apply the decision rule below to each element. Avoid nested disclosures and unnecessary navigation.
- [ ] **Prefer direct actions.** Let users choose/import a model, select its purpose, describe the change, run, inspect, refine and export. Remove redundant select/save/authorize steps and repeated review checkpoints. Preserve genuine consent and configured human review; do not bypass existing gates or dismiss pending decisions.
- [ ] **Use human-readable product language.** Prefer Use as reference, Edit this model and Generate over `permission`, `authorize`, `reuse-edit` or workflow internals. Remove unnecessary complexity instead of explaining it.
- [ ] **Preserve safety and accessibility.** Keep concise text for genuine consent, destructive actions, errors, cost/usage implications and unsupported preservation cases. Retain accessible control names, visible focus, keyboard operation, assistive-technology semantics, readable statuses and signals beyond color. Preserve source/copy/edit authorization, protected-feature checks and error/usage stops; see [workflow contracts](workflows.md) and [refinement stops](refinement.md#stops-and-review).
- [ ] **Stay consistent across views.** Home / Projects, Create project, Model studio, the asset picker and Workflow editor must share understandable hierarchy and recognizable controls. Check responsive behavior and consistent layout in Light and Dark themes.
- [ ] **Require a user-facing reason for complexity.** Add forms, helper copy, switches, badges, confirmations, nested menus or UI abstractions only for an actual use case.

## Decide visibility for each element

| Decision | Use when | gen3d example |
| --- | --- | --- |
| **Visible — show directly** | Needed for the everyday task in the current context. | Project name in Create project; Four-view check beside preparation for text-generated views. |
| **Remove** | Adds no useful action, information or necessary safeguard. | Decorative Home slogan; repeated ready-state captions. Delete rather than collapse. |
| **Contextual — reveal when relevant** | Useful only for a selected input, state or action. | Hide the text-only Four-view check for image-only input; show a concise cost notice when enabling refinement. |
| **Advanced — make available on demand** | Serves a specialized task outside the ordinary flow. | Graph internals and Graph JSON in Workflow editor. Keep everyday studio controls in the studio. |

Choose based on the user's task and frequency of use, not a blanket preference for fewer visible elements. Necessary consent, warnings and accessible names must remain available at the point of decision.

## Concrete counterexamples and preferred approaches

These examples document historical problems addressed in earlier gen3d iterations.

| Avoid | Prefer |
| --- | --- |
| Home: “Make a model. Keep every possibility.” above the useful content. | Remove the slogan; give Create project and project previews/names clear hierarchy. See [Issue #36 evidence](validation-issue36.md#bounded-visibility-audit). |
| Create project: Project name collapsed in a disclosure. | Show the optional field with the ordinary creation inputs. See [Issue #36 evidence](validation-issue36.md#bounded-visibility-audit). |
| Model studio: Four-view check hidden with advanced workflow settings. | Show it beside relevant preparation controls for generated views; omit it for image-only input. See [Issue #34 evidence](validation-issue34.md#behavior-and-layout-audit). |
| Asset picker / studio: select, save, authorize and review repeatedly, using implementation jargon. | Use direct Use as reference / Edit this model actions and visual part selection; keep explicit copying/edit-scope consent and configured review gates. See [Issue #32 evidence](validation-issue32.md) and [Issue #28 evidence](validation-issue28.md). |

Use the [development flow](development-flow.md#2-implement-and-create-a-pull-request) before implementation and the [UI/UX review check](review-guidelines.md#check-the-rendered-uiux) before approval.
