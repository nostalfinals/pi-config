---
name: ask-for-review
description: Request an independent, convergent code review from the reviewer subagent. Use when the user wants code reviewed or another workflow reaches an explicit review gate.
---

# Ask for review

Manage one convergent review session with at most three reviewer rounds:

- Round 1 discovers a bounded set of concrete correctness findings.
- Rounds 2 and 3 verify fixes and inspect only their repair deltas for directly introduced defects.
- A clean round closes the session early; Round 3 always closes it.

This skill manages review and does not itself authorize source changes. When the invoking request or workflow already authorizes fixes, return control to that workflow after reconciliation; otherwise await an explicit fix request.

## 1. Start or resume

Resume the existing `reviewer` subagent session when the current conversation contains an active review for the same target. Retain its session ID, round number, initial target and baseline, finding IDs and dispositions, and the repairs attempted since its last response. Start a new reviewer session only when no matching active review exists.

Choose the initial target in this order:

1. the target explicitly named by the user;
2. changes completed in the current task;
3. current worktree changes relative to `HEAD`, including staged, unstaged, and untracked files;
4. current branch changes relative to its default-branch merge base.

Resolve repository facts directly. Ask the user only when multiple materially different targets remain plausible.

Completion criterion: the target is identifiable, the baseline is explicit or `AUTO`, and the review is classified as a new session or a continuation of a known session.

## 2. Build the round prompt

### Round 1 review brief

Send the reviewer a brief with this semantic content:

```markdown
# Review round 1 of 3

## Target
<working tree, commit, range, or files>

## Baseline
<HEAD, merge base, commit, or AUTO>

## Intent and acceptance criteria
<requirements extracted from the conversation, or UNKNOWN>

## Authorities
<explicitly authoritative spec/plan paths and sections; where silent, say what governs>

## Scope
<included and excluded behavior>

## Risk profile
<supported inputs, deployment context, trust boundaries, and assurance level>

## Unsupported concerns
<scenarios that this project does not need to handle>

## Validation
<relevant test, lint, and typecheck commands>

## Context
<key entry points, constraints, or known concerns>
```

Mark missing intent as `UNKNOWN` rather than inventing it. Designate a spec or plan as authoritative only when the conversation or current repository establishes that status. Do not treat completed planning documents as authoritative by default.

Completion criterion: the brief identifies the target and baseline, supplies or marks intent unknown, and gives the reviewer enough project context to apply a realistic correctness bar.

### Rounds 2 and 3 verification brief

Continue the exact prior reviewer session and send:

```markdown
# Verification round <2|3> of 3

This is focused verification in the existing session, not a fresh review.

## Finding dispositions
- F1: <fix attempted, accepted risk, disputed, deferred, or other disposition>

## Repair delta
- <file/function and the behavioral change made since the previous review>

## Validation performed
- <command and result>

Verify the submitted findings and the repair delta. Preserve finding IDs. A new
finding must be a concrete correctness defect causally introduced by this repair.
```

Derive the repair delta from edits made by the invoking agent and current repository state. When the user edited the code, obtain a concise account from them only if the changed regions cannot be identified locally. Describe behavioral changes and exact locations; the reviewer can read the files directly.

Completion criterion: every open finding has a disposition and every repair made since the prior round is represented in the repair delta.

## 3. Invoke reviewer

For Round 1, run the `reviewer` definition in a new subagent session. For later rounds, call `run` with the saved reviewer `sessionId`; do not open a replacement session. Use a short user-visible task naming the round and target, and put the complete brief in the prompt.

Completion criterion: the reviewer returns a clean result, a finding/status set, or a precise blocked result.

## 4. Reconcile and report

Check cited code before presenting findings as confirmed. Account for every reviewer item as confirmed, disputed, accepted risk, deferred, or needing clarification. Continue the same session for reviewer clarification; clarification does not consume another review round when no changed code is being verified.

After each response, report to the invoking user or workflow:

- completed round and maximum of three;
- current status of every finding ID;
- validation results and review limits;
- whether the session is awaiting fixes or closed.

Close the session immediately when a round has no unresolved admissible findings. After Round 3, close it regardless and report any unresolved findings without initiating Round 4.

Completion criterion: every finding and blocker has a disposition, and the user can tell whether the review passed, awaits fixes, or ended with unresolved items.
