---
name: implement
description: Implement one unfinished slice from an explicitly selected task according to its approved `SPEC.md` and `PLAN.md`, validate it, and record its result.
disable-model-invocation: true
---

Implement exactly one unfinished, unblocked slice from `docs/agent-tasks/<short-purpose>/`. The user must explicitly identify the task; they may optionally identify a slice. If no slice is named, select the next actionable slice whose dependencies are complete.

The workflow is AFK after task selection. Resolve minor details from the task documents and established repository conventions without asking the user. If a material decision is missing, contradicted, or invalidated, stop safely and report the blocker. Never continue to or prepare the next slice.

## Sources of truth

- `SPEC.md`: behavior, design decisions, constraints, non-goals, and acceptance criteria.
- `PLAN.md`: slice scope, order, dependencies, validation, and progress.
- Repository instructions and conventions remain binding unless explicitly superseded by the approved specification.

## 1. Load and verify the slice

Before editing:

1. Read repository instructions and the selected task's `SPEC.md` and `PLAN.md` completely.
2. Inspect the working tree and preserve unrelated changes.
3. Select the named slice, or the next unfinished and unblocked slice if none was named.
4. Inspect the relevant source and tests, trace current behavior, and confirm the slice still matches the codebase.
5. Confirm its dependencies, scope, validation, and external requirements are available and that it fits one focused implementation session.

If no slice is actionable, report why and stop.

Stop without changing the approved documents or expanding scope when:

- required behavior is materially ambiguous or `SPEC.md` and `PLAN.md` conflict;
- an approved boundary or design decision must change;
- the slice must materially expand or split into separate outcomes;
- the current code invalidates a material assumption;
- implementation exposes an unmade migration, compatibility, security, destructive-data, or unavailable-dependency decision.

## 2. Implement the selected outcome

Follow the specification, slice boundaries, and repository conventions. Implement only what is needed for the selected observable outcome; avoid later-slice work, unrelated refactoring, and intentionally incomplete horizontal layers.

When behavior can be meaningfully verified automatically, use Test-Driven Development and follow the `tdd` skill. Do not force TDD or add low-value tests for code that is not suitably testable.

Report unrelated defects without fixing them. If one blocks the slice, fix only what is strictly necessary when doing so stays within the approved boundaries; otherwise mark the slice blocked.

## 3. Validate

Run the slice's specified validation and the smallest relevant focused checks. Fix only failures caused by or within the scope of this slice, rerunning the affected checks afterward. Record unrelated or pre-existing failures accurately.

If an essential check cannot run, do not mark the slice complete. A nonessential unavailable check may be recorded only when the remaining evidence fully verifies the outcome.

## 4. Record the result

Update only the selected slice and directly affected progress in `PLAN.md`.

On success:

- mark its progress checkbox and status complete;
- append concise completed-work and validation results;
- record any deviation from the original notes and why it did not change the approved behavior or boundaries, or state `Deviations: None`.

If blocked or incomplete:

- leave its checkbox unchecked and set its status to `Blocked` or `In progress`;
- record partial work, the exact blocker or failure, and the required follow-up.

Do not rewrite the original plan to hide a deviation.

## 5. Review and stop

Inspect the complete diff. Remove accidental changes, confirm no later-slice or unrelated work slipped in, and verify that the implementation, focused tests, `SPEC.md`, and `PLAN.md` agree.

Report the selected slice, changes, validation, deviations, blockers or environment limits, unrelated discoveries, and the `PLAN.md` update. Then stop and wait for an explicit request for another slice.
