---
name: auto-implement
description: Implement an explicitly selected serial route of task slices through isolated worker sessions, commits, and verification checkpoints.
disable-model-invocation: true
---

# Auto Implement

Act as conductor for an explicitly selected route in `docs/agent-tasks/<short-purpose>.md`. The task must reference one authoritative design document. The user must identify the task and route. Prefer an ordered slice list; infer endpoints only when the task and Mermaid roadmap determine one unambiguous serial path.

Use inspection, validation commands, and the `worker` subagent. Repository modifications, task updates, repairs, and commits belong to the worker. Each slice is one checkpoint: one fresh worker session, one selected slice, committed completed work, and independent conductor verification. Keep the session attached to its slice until the checkpoint passes or reaches a material stop.

## 1. Resolve the route

1. Read repository instructions, the task, and its referenced design completely.
2. Inspect the working tree and recent commits, recording pre-existing changes to preserve.
3. Resolve the exact ordered route from the request, task dependencies, roadmap, and progress.
4. Confirm every transition is approved, every included slice becomes actionable as predecessors complete, and every slice has valid design references.
5. Confirm the `worker` definition is available.

Ask the user when multiple routes fit. If the route is empty, complete, structurally invalid, design-blocked, or depends on unfinished work outside the selected route, report the exact condition and stop.

This step is complete when every included slice, dependency edge, design obligation, and completion state is known.

## 2. Run one slice

Select the first unfinished route slice whose dependencies are complete. Create a fresh `worker` session and tell it to:

- invoke and follow `implement` for the explicitly named task and slice;
- treat the referenced design as behavioral authority and the task as execution authority;
- preserve pre-existing unrelated changes;
- stay within the slice and honor every `implement` stop condition;
- when complete, commit all slice-owned implementation, tests, and task updates;
- report completion state, validation, review findings and dispositions, deviations, blockers, and commit identifiers.

Wait for its result. Partial progress, elapsed effort, context limits, omitted required work, missing commits, and fixable verification failures remain part of the same slice: continue the saved worker session with the concrete gaps. Never replace that session while its slice remains active.

When `implement` reaches a material stop, proceed to step 4.

This step is complete only when the worker reports a completed committed slice or a specific material stop.

## 3. Verify the checkpoint

Independently inspect the design, task, repository, working tree, slice commits, validation evidence, and review result. Confirm exhaustively that:

- only the selected slice and directly affected progress were recorded;
- its outcome and every mapped design obligation are implemented;
- required agent-executable validation passed and unavailable checks are recorded accurately;
- independent review closed with every finding dispositioned and no unresolved fixable in-scope defect;
- implementation, tests, review, design, and task agree;
- no later-slice or unrelated work entered the result;
- every slice-owned change is committed and pre-existing unrelated changes remain outside its commits.

Run focused read-only checks when needed. If a correctable condition fails, continue the same worker session with concrete gaps, then repeat verification. The conductor does not repair files.

The checkpoint passes only when every condition is satisfied.

## 4. Continue or stop

After a checkpoint passes, retain its commit and discard its worker session. If another route slice remains, return to step 2 with a fresh worker session.

When every selected slice passes, report the route, per-slice commits, validation, review outcomes, deviations, environment limits, and unrelated discoveries, then stop.

When `implement` reaches a material stop, verify that the blocker and partial result are recorded accurately, forward the substantive report, and stop the entire route. Leave every later slice untouched.
