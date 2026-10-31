# Development Flow

This document adapts the [GitWeave development flow](https://github.com/takahirox/gitweave/blob/main/docs/development-flow.md) for gen3d, with emphasis on AI-assisted development.

## 1. Start with an Issue

Use the Issue template to describe the problem, expected outcome, relevant context, reproduction steps where applicable, and concrete acceptance criteria.

The source Issue defines the scope. Clarify unclear requirements before implementing dependent work instead of inventing requirements. Prefer the smallest change that fully satisfies the Issue.

Default to completion criteria an AI agent can execute and verify. Require human confirmation, physical-device testing, subjective evaluation, or external approval only when necessary for the actual Issue. Explain why necessary human work is required and what result is expected. List optional additional validation separately from mandatory criteria.

Mandatory pre-merge acceptance must be achievable and verifiable before merge. Record genuinely required post-merge checks separately; do not add them routinely. Checks possible only after merge are not pre-merge approval conditions. This preserves all implementation requirements and applicable pre-merge tests.

For example, when merge triggers deployment, validate the changed code/configuration and applicable builds and tests before merge using available tooling. Required publication or published-site checks belong after merge and remain pending until performed.

## 2. Implement and Create a Pull Request

Implement the Issue and propose the change through a Pull Request associated with it. Avoid speculative abstractions, unrelated refactoring, and frameworks not needed to satisfy the Issue.

For UI/UX changes, consult the canonical [UI/UX guidelines](ui-ux-guidelines.md) before implementation. Use them to choose the information hierarchy, control visibility, labels and interaction steps. When those choices are material, briefly explain in the Issue or PR why they fit the principles, including whether elements should be visible, removed, contextual or advanced. Fit this rationale into the existing Issue/PR template sections.

Validate the rendered primary user path using the [UI/UX review check](review-guidelines.md#check-the-rendered-uiux), with screenshots or browser evidence when available; report unavailable evidence and its limits. Simplifying interactions must preserve required human authorization, configured review gates, safety stops and accessibility.

Validation must fit the changed files and available tooling. Apply the [test and CI performance principles](#test-and-ci-performance-principles) when choosing checks. Application checks are `npm test` and `npm run check`. For Codex/Blender integration changes, run relevant live checks when those prerequisites are available and record actual results; synthetic test artifacts do not demonstrate real generation. See [local setup](local-setup.md) and [recorded validation](validation.md). Do not invent build commands or add dependencies or CI merely to document a process. For documentation changes, inspect Markdown and template syntax, resolve local links and anchors, and check whitespace with `git diff --check` (stage new files first and use `git diff --cached --check`).

Use the PR template to explain:

- the problem and focused changes
- the resulting behavior, with before/after examples when useful
- validation actually performed, results, and evidence for mandatory pre-merge acceptance
- failures, skipped checks, and unperformed checks with reasons
- genuinely required post-merge verification still pending, separately from completed validation
- the source Issue and any related Issues

Do not claim success without evidence. Only claim to close an Issue when the implementation fully addresses it. An intentionally partial PR must state its remaining scope and leave the Issue open. Pending post-merge checks do not make an otherwise complete implementation partial, but verification is not complete until those checks are performed.

## 3. Review Before Merge

Every PR should be reviewed against the source Issue using the [review guidelines](review-guidelines.md). Check completeness, correctness, unnecessary scope, and appropriate validation. Require mandatory pre-merge acceptance to pass and record required post-merge checks as pending.

## 4. Revise Until Review Passes

Fix agent-fixable findings, update the PR and validation results, and review the updated PR again. If necessary human input is missing, record the specific question, why the input is necessary, and the expected result. Wait for that input instead of repeatedly requesting code fixes.

## 5. Merge

Approve and merge when the implementation is a complete, appropriately scoped response to the Issue and mandatory pre-merge checks are sufficient and pass. Optional validation and pending post-merge-only checks are not pre-merge blockers.

## 6. Perform Required Post-Merge Verification

If the Issue requires post-merge verification, perform the recorded checks after merge. Keep them pending until performed, then record actual results, including failures and required follow-up. Do not claim they passed based on pre-merge evidence. If none are required, no post-merge verification step is needed.

The normal flow is:

```text
Issue → Implementation → PR → Review → Revision as needed → Merge
                                                          ↓
                                     Post-merge verification (if required)
```

## Test and CI performance principles

**Detect the required failures at the lightest appropriate layer, without redundant execution.** Preserve required behavior, regression confidence and meaningful integration coverage when moving or consolidating checks.

gen3d has local checks in [package.json](../package.json), but no checked-in CI workflows or build/deployment commands. These principles apply to current validation and future CI additions; they do not introduce CI or a new merge gate.

1. **Prefer the lightest meaningful layer.** Use Node unit/component tests for calculations, branches, graph/state rules and broad data combinations. Reserve real Chrome, Blender rendering/import/export and live Codex checks for boundaries that need them. Injected scheduler/browser fixtures exercise behavior but do not prove real generation. Add assertions that catch a concrete defect, rather than mirror implementation details.

2. **Choose combinations deliberately.** Select representative text/image inputs, GLB/Blender bases, rigs, materials, review/consistency states and UI themes/layouts that exercise distinct paths. Expand combinations exhaustively where interactions require it, rather than multiplying every dimension automatically. Retain required regressions and integration assertions when redistributing coverage.

3. **Match validation to the change.** Use focused checks for fast feedback and the applicable full regression checks before merge. Choose checks as follows, following [local setup](local-setup.md#failures-and-checks) for prerequisites and evidence limits:

   | Change | Applicable validation |
   | --- | --- |
   | Documentation only | Markdown/template structure, local links/anchors and whitespace checks described above. |
   | UI | `npm test`, `npm run check`, and the affected rendered user path, including `npm run test:browser` where applicable; follow the [UI/UX review check](review-guidelines.md#check-the-rendered-uiux). |
   | Core/runtime or integration | `npm test` and `npm run check`; relevant Blender checks such as `npm run test:workflow-blender` for preservation/import/export, and live checks for changed Codex/Blender integration when prerequisites are available. |
   | Future CI/build configuration | Validate changed configuration and affected commands before merge; keep feedback, full regression and publication responsibilities/triggers explicit. No build command exists today. |

   Live `npm run validate:workflow-live` is opt-in and consumes subscription allowance. Report unavailable prerequisites and unperformed checks; mandatory pre-merge criteria still need evidence. Keep optional validation separate. Only genuinely post-merge-only publication/deployed-site checks belong after merge, recorded separately as pending when required.

4. **Reuse work and avoid duplicate execution.** Reuse valid fixtures, conversions, downloads and any future builds with keys covering inputs, tooling and versions, while isolating mutable state. `npm run test:workflow-artifacts` can revalidate saved scene/GLB evidence without new Codex generation; it does not validate changed generation behavior. For future CI, avoid equivalent push/PR runs for the same revision and cancel superseded runs when safe, preserving necessary deployment ordering. Measure resource use before adding parallel workers; Blender has one current scene and modeling is serialized.

5. **Review additional confidence and cost together.** Identify the additional defect each new/expanded check detects, whether existing coverage already detects it, and its execution/maintenance cost. Watch repeated Chrome/Blender startup and rendering, large model fixtures, live generation allowance and Cartesian-product growth. Consolidate redundant work while retaining meaningful assertions and required coverage.

6. **Maintain an execution-time budget.** A normal-CI baseline/target is not yet established. Historical generation timings in validation reports are not a CI baseline. During actual test/CI performance work, measure representative checks, establish an appropriate baseline/target, monitor growth and investigate overruns. Track elapsed feedback time, total runner/computation time and queue time separately. Revisit structure and duplication as cost grows while retaining required confidence; this documentation adds no benchmark, hardware purchase or approval requirement.

Review question: **Does this change provide sufficient confidence with the lightest appropriate validation, without redundant execution?**
