# Review Guidelines

These guidelines adapt the [GitWeave review guidelines](https://github.com/takahirox/gitweave/blob/main/docs/review-guidelines.md) for gen3d. AI agents should follow them when reviewing a PR. Review whether the change works and whether it is the right response to its source Issue.

## Review Against the Issue

Read the source Issue, PR description, full diff, and reported validation. Treat the Issue's problem, expected outcome, and acceptance criteria as the reference for scope. Clarify unclear requirements instead of adding assumptions.

Verify that every requirement the PR claims to resolve is implemented. An intentionally partial PR must say so and leave the Issue open; do not approve it as closing the Issue.

## Check for Unnecessary Work

Check that every change has a reason connected to the Issue. Watch for unnecessary abstractions, speculative extensibility, unrelated refactoring, frameworks or subsystems that are not required, and policies or configuration with no demonstrated need. Prefer the smallest change that fully satisfies the Issue.

## Check the Result and Validation

Verify that:

- behavior matches the expected outcome and the implementation is correct
- changes fit the existing repository and update affected documentation
- validation is appropriate for the changed files and available tooling
- validation claims match checks actually performed and their results
- failures, skipped checks, and unperformed checks are accurately reported with reasons

Application checks are `npm test` and `npm run check`; live integration validation additionally requires authenticated Codex and a running Blender bridge. Review evidence of real generation separately from synthetic workflow fixtures, following [local setup](local-setup.md) and [recorded validation](validation.md). For documentation changes, check Markdown and template syntax, local links and anchors, and whitespace. Do not demand invented build commands, new dependencies, an application scaffold, or CI solely to validate documentation. Do not claim an unperformed check passed.

## Check Pre-Merge Acceptance and Post-Merge Verification

Follow the [development flow](development-flow.md#1-start-with-an-issue). Require mandatory pre-merge criteria to be achievable and verifiable before merge and verify their evidence. Default to checks an AI agent can execute. Require human-only work only when necessary for the actual Issue, with its reason and expected result stated. Optional additional validation is not a mandatory acceptance condition.

Checks possible only after merge must not be prerequisites for pre-merge approval. For example, when merge triggers deployment, applicable code/configuration checks, builds, and tests belong before merge; required publication and published-site checks belong after merge.

Ensure genuinely required post-merge checks are recorded separately and remain pending until performed. Do not add them routinely when unnecessary. Pre-merge evidence does not establish that post-merge checks passed. This distinction preserves implementation requirements and applicable pre-merge tests.

## Review, Revision, and Merge

A PR is ready to approve and merge when:

- it fully implements the requirements of the Issue it claims to resolve
- it introduces no unjustified scope or complexity
- the implementation is correct and all mandatory pre-merge acceptance criteria pass with sufficient evidence
- genuinely required post-merge verification is recorded separately as pending

For agent-fixable findings, request specific fixes with the affected file, the problem, and the expected correction or validation. Review the updated PR again after revision.

When necessary human input is missing, record the question, why it is necessary, and the expected result, and wait for that input. Do not repeatedly request code fixes for a question that needs human input.

Approve and merge once the readiness conditions are met. Pending post-merge-only checks and optional validation do not prevent approval. After merge, perform any required post-merge verification and record actual results, failures, and follow-up; keep unperformed checks pending.
