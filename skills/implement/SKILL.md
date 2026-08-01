---
name: implement
description: Implement one development slices according to the requirements and design decisions previously agreed upon and documented in `PLAN.md` and `SPEC.md`.
disable-model-invocation: true
---

Implement exactly one unfinished, unblocked `PLAN.md` slice under the `SPEC.md` contract. The user must explicitly identify the `docs/agent-tasks/<short-purpose>/` task to work on. If they do not, stop and report that a specific task is required; do not infer one or search for unfinished work. After completion or blockage, update only its plan state and stop. Never continue, scaffold, or prepare the next slice.

The workflow is fully AFK after task selection: do not request user participation or confirmation. Infer minor unstated details from that task's `SPEC.md`, `PLAN.md`, and established repository conventions. If a serious information or decision gap exists, or the two files conflict, stop in place, preserve current workspace changes, and report the problem without asking a question or continuing implementation.

## Sources of truth

- `docs/agent-tasks/<short-purpose>/SPEC.md`: behavior, architecture, constraints, non-goals, acceptance criteria.
- `docs/agent-tasks/<short-purpose>/PLAN.md`: slice order, dependencies, scope, validation, progress.
- Repository instructions and conventions remain binding unless the approved specification changes them.

## 1. Load context and select one slice

Before editing:

1. Confirm the user explicitly named one `docs/agent-tasks/<short-purpose>/` task. If not, report the requirement and stop without searching for candidates.
2. Read repository instructions and that task's `SPEC.md` and `PLAN.md` completely.
3. Inspect the working tree and preserve unrelated user changes.
4. Identify complete, pending, in-progress, and blocked slices.
5. Select the user-named slice. If the user names no slice, select the next actionable slice: the first unfinished, unblocked slice whose dependencies are complete.
6. Inspect relevant source/tests and trace current behavior and integration points; do not rely on old summaries or assume the codebase still matches the plan.

If no actionable slice exists, report that and stop.

## 2. Confirm it is implementable

Confirm dependencies, outcome, scope, validation, fixtures/external requirements, and codebase assumptions; the slice must fit one focused session, agree with `SPEC.md`, and not require later-slice work.

Stop in place, preserve current workspace changes, and report the problem without asking the user or continuing if:

- required behavior has a serious ambiguity or `SPEC.md` conflicts with `PLAN.md`;
- an approved boundary or `SPEC.md` must change;
- scope must materially expand or split into independently verifiable outcomes;
- code invalidates a material design assumption;
- an unexpected migration, compatibility, security, destructive-data, or unavailable-dependency decision appears.

Resolve minor implementation details from `SPEC.md`, `PLAN.md`, and established local conventions without user involvement.

## 3. Use Test-Driven Development

When a behavior or feature can be meaningfully verified through automated tests, use Test-Driven Development and follow the `tdd` skill.

Some code may not be well suited to automated testing. In such cases, do not force a TDD workflow or continue writing low-value tests merely for the sake of test coverage.

## 4. Implement only the selected outcome

Follow `SPEC.md` boundaries, interfaces, errors, and repository conventions. Preserve user changes and avoid later-slice work, unrelated cleanup/refactoring, intentionally incomplete horizontal layers, and comments that merely restate code.

If an unrelated defect is found, report but do not fix it. If it blocks the slice, make only the smallest necessary fix and record it in `PLAN.md`.

## 5. Validate

Run the slice’s specified validation plus the smallest relevant focused tests.

On failure, identify whether this slice caused it, fix only in-scope failures, rerun relevant checks, and accurately record unrelated/pre-existing failures. Do not run or repair unrelated expensive suites.

If the environment prevents a check, run remaining useful checks and record exactly what was unavailable. Never call it successful. Do not complete the slice if the unavailable check is essential; a nonessential check may remain unavailable only when other evidence fully proves the outcome.

## 6. Update only this slice in `PLAN.md`

Update its progress entry, section, and directly affected overall progress.

If all required validation passes:

- change `[ ]` to `[x]` and status to `Complete`;
- append concise `Completed work`, `Validation results`, and `Deviations` records;
- use `Deviations: None` when applicable;
- otherwise state what changed from the notes, why, and why design/scope remain unchanged. Never rewrite the original plan to hide a deviation.

If blocked, incomplete, or essential validation fails:

- leave the checkbox unchecked and set `Blocked` or `In progress`;
- record partial work, the exact blocker/failure, environmental versus code cause, and required decision/follow-up.

## 7. Review and stop

Inspect the complete diff and:

- separate and preserve pre-existing changes; remove accidental changes;
- confirm no later-slice or unrelated work slipped in;
- confirm behavior-focused tests, required outcome/criteria, `SPEC.md`, and `PLAN.md` agree;

Report the selected slice, changes, validation results, deviations/simplifications, blockers/risks/environment limits/unrelated discoveries, and the `PLAN.md` update. Then stop and wait for an explicit request for another pass.
