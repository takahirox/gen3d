---
name: Issue
about: Report a problem or propose a change
title: ""
labels: ""
---

## Problem

Describe the problem.

## Expected outcome

Describe what should be true when the Issue is resolved.

Default to completion criteria an AI agent can execute and verify. Require human checks only when necessary; explain why and the expected result. Separate optional validation from mandatory criteria, and post-merge-only checks from pre-merge acceptance. See the [development guidance](https://github.com/takahirox/gen3d/blob/main/docs/development-flow.md#1-start-with-an-issue).

## Pre-merge acceptance

List concrete mandatory criteria that can be achieved and verified before merge, including applicable tests. Checks possible only after merge must not be prerequisites for pre-merge approval.

- [ ] Describe a verifiable completion criterion.

## Post-merge verification

Record genuinely required checks possible only after merge separately, or state "None." Do not add checks routinely. Report required checks as pending until performed; pre-merge validation does not prove they passed.

## Optional validation

List useful additional checks that are not mandatory, or state "None."

## Context

Add relevant context, examples, logs, or related Issues. Include reproduction steps and actual versus expected behavior where applicable.
