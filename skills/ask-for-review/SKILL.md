---
name: ask-for-review
description: Request an independent, convergent code review from the reviewer subagent. Use when the user wants code reviewed or another workflow reaches an explicit review gate.
---

# Ask for review

Manage one reviewer session whose first round discovers a bounded finding set and whose later rounds verify those findings and their repair deltas instead of restarting broad discovery.

This skill manages review and does not itself authorize source changes. When an invoking workflow already authorizes fixes, return control to it after reconciliation; otherwise await an explicit fix request.

## Review policy

Choose the policy from the invocation:

- **Manual review:** when the user invokes this skill directly, run exactly one round and return. The user decides whether and how many times to invoke it again. Keep the same-target reviewer session resumable with no round limit until the user explicitly requests a fresh review, ends it, or changes targets.
- **Workflow review:** when another workflow reaches an explicit review gate, use at most three rounds. A clean round closes the session early; Round 3 closes it regardless.

Both policies use the same convergence rule: Round 1 performs bounded discovery; every later round is focused verification of existing findings and the repair delta. A fresh broad review requires an explicit fresh-review request or a materially different target.

## 1. Start or resume

Resume the existing `reviewer` subagent session when the conversation contains a review for the same target. Retain its session ID, round number, initial target and baseline, finding IDs and dispositions, repairs since the last response, and review policy. Start a new reviewer session when no matching session exists, the target materially changes, or the user explicitly requests a fresh review.

Choose the target in this order:

1. the target explicitly named by the user;
2. changes completed in the current task;
3. current worktree changes relative to `HEAD`, including staged, unstaged, and untracked files;
4. current branch changes relative to its default-branch merge base.

Resolve repository facts directly. Ask the user only when multiple materially different targets remain plausible.

Completion criterion: the target is identifiable, the baseline is explicit or `AUTO`, the policy is known, and the review is classified as a new session or a continuation with a known next round.

## 2. Build the round prompt

### Round 1: discovery

Send this semantic content:

```markdown
# Review round 1

## Target
<working tree, commit, range, or files>

## Baseline
<HEAD, merge base, commit, or AUTO>

## Intent and acceptance criteria
<requirements extracted from the conversation, or UNKNOWN>

## Authorities
<documents, repository rules, or requirements established as authoritative for this target; NONE when no additional authority exists>

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

Mark missing intent as `UNKNOWN` rather than inventing it. Authorities identify target-specific correctness sources; the risk profile separately describes the environment and assurance bar.

When an invoking workflow supplies authoritative material, include it. In an `implement` session this means the task's authoritative design and active slice. For a standalone review, use only authority established by the user's request, current conversation, or repository instructions; a nearby design or task is not automatically authoritative. Write `NONE` when no additional authority is established. A fully completed implementation task is historical execution evidence rather than behavioral authority.

Completion criterion: the brief identifies target and baseline, supplies or marks intent unknown, and gives the reviewer enough context to apply a realistic correctness bar.

### Later rounds: focused verification

Continue the same reviewer session and send:

```markdown
# Verification round <N>

This is focused verification in the existing session, not a fresh review.

## Finding dispositions
- F1: <fix attempted, accepted risk, disputed, deferred, or other disposition>

## Repair delta
- <file/function and behavioral change since the previous round, or None>

## Validation performed
- <command and result>

Verify the submitted findings and repair delta. Preserve finding IDs. A new finding
must be a concrete correctness defect causally introduced by the repair.
```

Derive the repair delta from edits made by the invoking workflow and current repository state. Ask the user for a concise account only when their changed regions cannot be identified locally. Describe behavioral changes and exact locations.

Completion criterion: every open finding has a disposition and every repair since the prior round is represented; an unchanged manual rerun explicitly records `Repair delta: None`.

## 3. Invoke reviewer

For Round 1, start a new `reviewer` subagent session. For later rounds, continue the saved `sessionId`; never replace it merely to obtain broader discovery. Use a short user-visible task naming the round and target, and send the complete brief.

Completion criterion: the reviewer returns a clean result, finding/status set, or precise blocked result.

## 4. Reconcile and report

Check cited code before presenting findings as confirmed. Account for every reviewer item as confirmed, disputed, accepted risk, deferred, obsolete, or needing clarification. Continue the same session for clarification; clarification without changed code does not consume a review round.

After each response, report:

- the completed round and review policy;
- every finding ID and disposition;
- validation results and review limits;
- whether the session awaits fixes, is clean but resumable, or is closed.

Under manual policy, return after this one round and keep the session resumable, including after a clean result. Close it only when the user requests closure, starts a fresh review, or changes targets.

Under workflow policy, close immediately after a round with no unresolved admissible findings. Round 3 always closes; report unresolved findings without opening Round 4.

Completion criterion: every finding and blocker has a disposition, and the caller can tell the session state and what another invocation would do.
