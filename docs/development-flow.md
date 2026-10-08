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

Validation must fit the changed files and available tooling. This repository currently has no application or build/test setup. Do not invent build commands or add an application scaffold, dependencies, or CI merely to document a process. For documentation changes, inspect Markdown and template syntax, resolve local links and anchors, and check whitespace with `git diff --check` (stage new files first and use `git diff --cached --check`). Use existing relevant build/test commands when the repository actually provides them.

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
