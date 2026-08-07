---
name: implement
description: Implement one unfinished slice from an explicitly selected task according to its approved `SPEC.md` and `PLAN.md`, validate and independently review it, and record its result.
---

Implement exactly one unfinished, unblocked slice from `docs/agent-tasks/<short-purpose>/`. The user must explicitly identify the task; they may optionally identify a slice. If no slice is named, select the next actionable slice whose dependencies are complete.

The workflow is AFK after task selection. Resolve minor details from the task documents and established repository conventions without asking the user. Continue while actionable in-scope work remains. Stop only when the slice is complete or a specific material blocker makes further progress impossible without a user decision, additional authority, or an unavailable required dependency. Partial progress, elapsed effort, and unavailable optional or human-dependent checks are not blockers. Never continue to or prepare the next slice.

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
5. Confirm its dependencies, scope, validation, and external requirements.

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

If a planned check requires human involvement or cannot run in the available environment, continue implementation, run the strongest feasible substitute, and record the skipped check and resulting uncertainty. Never claim that the skipped check passed.

## 4. Review and repair

Invoke and follow the `ask-for-review` skill for the selected slice's complete current change set. Give it the slice outcome and acceptance criteria, authoritative `SPEC.md` and `PLAN.md` sections, scope boundaries, validation, and the pre-slice Git baseline.

Reconcile every finding against the cited code and approved task documents. For each confirmed in-scope correctness finding:

1. repair it within the selected slice;
2. run the smallest relevant validation;
3. continue the same reviewer session with the finding disposition, repair delta, and validation result.

Use the same reviewer session for every verification round and clarification. Give disputed findings concrete code or requirement evidence. Report unrelated or out-of-scope defects without fixing them. Apply the material stop conditions when a finding requires changed boundaries, a new design decision, expanded scope, or unavailable authority.

The review passes cleanly when a reviewer round has no unresolved admissible findings. If Round 3 closes with remaining findings, reconcile them without opening another review round. Fix every confirmed in-scope finding and rerun the relevant validation. Apply the material stop conditions only when a finding cannot be resolved within the approved slice. Record any final repairs that were not independently reverified and the resulting uncertainty.

## 5. Record the result

Update only the selected slice and directly affected progress in `PLAN.md`.

Treat the slice as complete when all required implementation work, all agent-executable validation, and independent review are complete. Then:

- mark its progress checkbox and status complete;
- append concise completed-work, validation, and review results, including the final round and finding dispositions;
- record any deviation from the original notes and why it did not change the approved behavior or boundaries, or state `Deviations: None`.

If genuinely blocked by one of the material stop conditions:

- leave its checkbox unchecked and set its status to `Blocked`;
- record completed and partial work, the exact blocker, and the decision, authority, or dependency required to continue.

Do not rewrite the original plan to hide a deviation.

## 6. Final inspection and stop

Inspect the complete diff. Remove accidental changes, confirm no later-slice or unrelated work slipped in, and verify that the implementation, focused tests, review result, `SPEC.md`, and `PLAN.md` agree.

Report the selected slice, changes, validation, review outcome and finding dispositions, deviations, blockers or environment limits, unrelated discoveries, and the `PLAN.md` update. Then stop and wait for an explicit request for another slice.
