---
name: implement
description: Implement one unfinished slice from an explicitly selected implementation task, validate and independently review it, and record its result.
---

# Implement

Implement exactly one unfinished, unblocked slice from an explicitly selected `docs/agent-tasks/<short-purpose>.md`. The task must identify one authoritative design document. The user must identify the task and may identify a slice; otherwise select the next actionable slice whose dependencies are complete.

The workflow is AFK after task selection. Resolve minor details from the authoritative design, task, current code, and repository conventions without asking the user. Stop only when the slice is complete or a material blocker requires a user decision, additional authority, or an unavailable required dependency. Never continue to or prepare the next slice.

## Sources of truth

- The authoritative design document owns intended behavior, public API, contracts, constraints, invariants, and non-goals.
- The implementation task owns slice scope, order, dependencies, validation, and progress.
- Repository instructions remain binding unless the design explicitly supersedes them.
- Current source is implementation reality, not authority to silently contradict the design.

## 1. Load and verify the slice

Before editing:

1. Read repository instructions, the task, and its referenced design document completely.
2. Inspect the working tree and preserve unrelated changes.
3. Select the named slice, or the next unfinished and unblocked slice.
4. Trace relevant source, callers, tests, and current behavior.
5. Confirm the slice's design references, dependencies, scope, validation, and external requirements still match the codebase.

If no slice is actionable, report why and stop.

Stop without changing the authoritative design or expanding scope when:

- the design is materially ambiguous, incomplete, internally contradictory, or conflicts with the task;
- an approved boundary, API, or design decision must change;
- the slice must materially expand or split into separate outcomes;
- current code invalidates a material planning assumption;
- implementation exposes an unmade migration, compatibility, security, destructive-data, performance, or unavailable-dependency decision.

State the exact design gap or required decision so the work can return to `/design`; do not invent the missing contract in the task.

This step is complete when one slice is actionable and its complete behavioral and execution boundary is known.

## 2. Implement the selected outcome

Follow the design, slice boundary, and repository conventions. Implement only what is needed for the selected observable outcome; avoid later-slice work, unrelated refactoring, and intentionally incomplete horizontal layers.

When behavior can be meaningfully verified automatically, use Test-Driven Development and follow the `tdd` skill. Do not force TDD or add low-value tests for unsuitable code.

Report unrelated defects without fixing them. If one blocks the slice, fix only what is strictly necessary when it remains inside the approved boundary; otherwise record the blocker.

This step is complete when the selected outcome and every slice-owned design obligation are implemented with no later-slice or unrelated changes.

## 3. Validate

Run the task's specified slice validation and the smallest relevant focused checks. Fix failures caused by or within this slice and rerun affected checks. Record unrelated or pre-existing failures accurately.

If a planned check cannot run in the environment, run the strongest feasible substitute and record the skipped check and uncertainty. Never claim an unrun check passed.

This step is complete when every agent-executable required check passes and every unavailable check has an explicit substitute or limitation.

## 4. Review and repair

Invoke and follow `ask-for-review` under its workflow-review policy for the selected slice's complete current change set. Give it:

- the slice outcome and design references;
- the authoritative design sections and invariants;
- the task's scope, exclusions, dependencies, and validation;
- the pre-slice Git baseline.

Reconcile every finding against cited code, design, and task. For each confirmed in-scope correctness finding:

1. repair it within the selected slice;
2. run the smallest relevant validation;
3. continue the same reviewer session with the finding disposition, repair delta, and result.

Use the same reviewer session for every verification round and clarification. Report unrelated or out-of-scope defects without fixing them. Apply the material stop conditions when a finding requires changed design, boundaries, scope, or authority.

The review passes when a round has no unresolved admissible findings. If Round 3 closes with findings, fix every confirmed in-scope issue that remains resolvable, rerun validation, and record any final repair not independently reverified and its uncertainty.

This step is complete when review has closed and every finding has a disposition with no unresolved in-scope issue that can be fixed under the authoritative design.

## 5. Record the result

Update only the selected slice and directly affected progress in the implementation task. Do not update the design document to record implementation progress.

For a completed slice:

- mark its progress checkbox and status complete;
- append concise completed-work, validation, and review results;
- record deviations from implementation notes and why they preserve the design, or state `Deviations: None`.

For a material blocker:

- leave its checkbox unchecked and mark the slice blocked;
- record completed and partial work, the exact blocker, and the design decision, authority, or dependency required.

Do not rewrite the original task to hide a deviation.

This step is complete when the task accurately records the slice's implementation, evidence, review, and disposition.

## 6. Final inspection and stop

Inspect the complete diff. Remove accidental changes and confirm that implementation, tests, review, design, and task agree; no later-slice or unrelated work may remain.

Report the selected slice, changes, validation, review findings and dispositions, deviations, blockers or environment limits, unrelated discoveries, and task update. Then stop and wait for an explicit request for another slice.
