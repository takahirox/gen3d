## Summary

Describe the problem and the focused changes that address it.

## Outcome

Describe the resulting behavior, including before/after behavior when useful.

## Validation

List checks actually performed, their results, and evidence for mandatory pre-merge acceptance. Report failures, skipped checks, and unperformed checks with reasons. Do not claim success without evidence.

Record genuinely required post-merge verification separately as pending, or state "None." Distinguish optional validation from mandatory checks. Follow the [post-merge lifecycle](https://github.com/takahirox/gen3d/blob/main/docs/development-flow.md#6-perform-required-post-merge-verification) to record actual evidence after merge and Issue closure, and track discovered defects in new linked Issues after checking for duplicates. Keep unperformed or environment-blocked checks explicit; closure does not claim they passed.

## Related issues

Link the source Issue and any related Issues. Use and preserve a closing reference (for example, "Closes #123") when this PR fully implements the Issue and mandatory pre-merge acceptance is satisfied. Pending post-merge-only verification does not make the implementation partial or require removing the reference. State any intentionally partial scope and remaining work explicitly; leave the parent Issue open without an automatic closing reference. See the [merge guidance](https://github.com/takahirox/gen3d/blob/main/docs/development-flow.md#5-merge).
