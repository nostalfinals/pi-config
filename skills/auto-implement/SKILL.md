---
name: auto-implement
description: Implement an explicitly selected serial route of task slices through isolated worker sessions, commits, and verification checkpoints.
disable-model-invocation: true
---

Act as the conductor for an explicitly selected route in `docs/agent-tasks/<short-purpose>/`. The user must identify the task and route. Prefer an ordered slice list; infer a route from endpoints only when `PLAN.md` and its Mermaid graph determine one unambiguous serial path.

Operate through inspection, validation commands, and the `worker` subagent. Repository modifications, `PLAN.md` updates, repairs, and commits belong to the worker.

Each slice is one checkpoint: one fresh worker session, one selected slice, committed completed work, and independent conductor verification. Keep that session attached to its slice until the checkpoint passes or reaches a material stop. The next slice always receives a fresh session.

## 1. Resolve the route

1. Read repository instructions and the task's `SPEC.md` and `PLAN.md` completely.
2. Inspect the working tree and recent commits, recording pre-existing changes that must be preserved.
3. Resolve the exact ordered route from the request, Mermaid graph, dependencies, and current progress.
4. Confirm every transition belongs to the approved graph and every included slice will become actionable as its route predecessors complete.
5. Confirm the `worker` Definition is available.

Ask the user to resolve the route when multiple paths fit. If the route is empty, already complete, structurally invalid, or requires unfinished work outside the selected route, report the exact condition and stop.

This step is complete when every included slice, dependency edge, and existing completion state is known.

## 2. Run one slice

Select the first unfinished slice on the route whose dependencies are complete. Create a fresh `worker` session and assign only that slice. Tell the worker to:

- invoke and follow the `implement` skill for the explicitly named task and slice;
- preserve pre-existing unrelated changes;
- stay within that slice and honor every `implement` stop condition;
- when complete, commit all slice-owned implementation, tests, and `PLAN.md` changes before reporting;
- report completion state, validation, review outcome and finding dispositions, deviations, blockers, and commit identifiers.

Wait for its result. Partial progress, elapsed effort, context limits, omitted required work, a missing commit, and fixable verification failures remain part of the same slice: continue the saved worker session with the concrete remaining work. Never replace that session while its slice remains active.

When the worker reports a material stop from `implement`, proceed directly to the stop rule in step 4.

This step is complete only when the worker reports a completed committed slice or a specific material stop.

## 3. Verify the checkpoint

Independently inspect the repository, `SPEC.md`, `PLAN.md`, working tree, slice commits, validation evidence, and review result. Confirm exhaustively that:

- only the selected slice and directly affected progress were recorded;
- its outcome and acceptance criteria are implemented;
- required agent-executable validation passed and unavailable checks are recorded accurately;
- independent review completed, no confirmed in-scope finding remains unaddressed, and any final repairs not independently reverified are recorded with their uncertainty;
- implementation, tests, review result, `SPEC.md`, and `PLAN.md` agree;
- no later-slice or unrelated work entered the result;
- every slice-owned change is committed and pre-existing unrelated changes remain outside its commits.

Run focused read-only checks when needed. If a correctable condition fails, continue the same worker session with the concrete gaps, then repeat verification. The conductor does not repair repository files.

The checkpoint passes only when every condition above is satisfied.

## 4. Continue or stop

After a checkpoint passes, retain its commit and discard its worker session. If another unfinished route slice remains, return to step 2 with a fresh worker session.

When every selected slice passes, report the route, per-slice commits, validation, review outcomes, deviations, environment limits, and unrelated discoveries, then stop.

When `implement` reaches a material stop, verify that the blocker and partial result were recorded accurately, forward the substantive report to the user, and stop the entire route. Leave every later slice untouched.
