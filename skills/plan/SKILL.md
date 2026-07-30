---
name: plan
description: Inspect an existing codebase, resolve consequential implementation decisions, and create or revise SPEC.md and PLAN.md before coding. Use for features, refactors, or multi-file changes that need an approved design and small verifiable vertical slices.
disable-model-invocation: true
---

# Plan

Produce two non-duplicative artifacts in `docs/agent-tasks/<short-purpose>/` at the project root, creating the directory when needed:

- `SPEC.md`: the stable contract for behavior, design, boundaries, constraints, and acceptance.
- `PLAN.md`: an adaptable sequence of independently verifiable vertical slices implementing that contract.

Use a concise kebab-case `<short-purpose>` that describes the plan, for example `docs/agent-tasks/implement-grayscale-toggle/{SPEC,PLAN}.md`.

Do not modify production code.

## 1. Establish context

Before designing:

1. Read repository instructions and inspect the working tree; preserve user changes.
2. Inspect the relevant structure, build system, source, tests, nearby implementations, and conventions.
3. Trace current behavior and integration points in code.
4. Record only findings relevant to the request.

## 2. Resolve consequential uncertainty

Read and use `grill-me` if unresolved decisions could materially change behavior.

## 3. Confirm the grill-me alignment

Before creating or modifying either planning file, restate every point aligned through `grill-me` (or already made explicit in the conversation) as a concise declarative conclusion.

Output the complete restatement as a normal assistant message and ask the user to confirm that it is complete and accurate, then stop. Do not put the restatement in `ask_user_question`; ordinary conversation makes the summary easier to review. If the user corrects or adds a point, revise the full restatement and obtain confirmation again the same way.

## 4. Obtain slice approval

Only after explicit confirmation of the alignment restatement, propose the ordered implementation slices with its title in the conversation.

Present the slice proposal and obtain approval in the same manner as section 3. If revisions are requested, update the proposal and obtain approval again.

Do not create or modify `SPEC.md` or `PLAN.md` until both the alignment restatement and slice proposal have explicit approval.

## 5. Write `docs/agent-tasks/<short-purpose>/SPEC.md`

After alignment confirmation and slice approval, translate the confirmed alignment into the intended end state. Use applicable sections below and omit irrelevant ones:

```markdown
# Specification: <change>

## Status
Approved for implementation.

## Problem
## Goals
## Non-goals
## Required behavior
## Technical design
## Target source structure
## Interfaces and data model
## Constraints
## Edge cases and error handling
## Acceptance criteria
## Verification strategy
```

The specification must:

- explain the concrete problem, relevant current behavior, affected users/callers, goals, and intentional exclusions;
- define observable success, empty/missing/invalid input, failure, lifecycle, compatibility, and concurrency behavior where relevant;
- fix decisions implementation must not improvise: module boundaries, dependency direction, ownership, integration/public boundaries, lifecycle/concurrency, persistence, errors, logging, and reuse;
- give concrete signatures, schemas, protocols, formats, state transitions, or pseudocode only where needed to remove material ambiguity;
- list expected added/modified/removed files and each responsibility only when reasonably knowable; do not invent or fragment a file map;
- record hard dependency, API, performance, compatibility, security, integrity, layout, and simplicity constraints;
- define realistic edge cases, error ownership/propagation/logging, caller-visible effects, and partial-state behavior;
- make every goal observable and testable through at least one acceptance criterion;
- match verification boundaries to behavior using applicable focused tests, integration/E2E checks, type checks, lint, builds, or manual QA.

## 6. Write `docs/agent-tasks/<short-purpose>/PLAN.md`

Derive it from the confirmed alignment and approved slice proposal using this structure:

```markdown
# Implementation Plan: <change>

## References
- Specification: `SPEC.md`

## Progress
- [ ] Slice 1 — <outcome>

## Current codebase state
<only implementation facts that affect execution>

## Slices
### Slice 1 — <outcome>
**Status:** Pending

**Outcome**
<what becomes observably true>

**Scope**
- <smallest coherent implementation, source areas, tests/fixtures, integration points>

**Out of scope**
- <tempting adjacent work specific to this slice>

**Implementation notes**
- <decisions needed to follow SPEC.md, repository patterns, and dependency boundaries>

**Validation**
- `<exact command/check>` — <behavior proved>

**Dependencies**
- None.

## Final verification
<only checks that genuinely require all slices>
```

Each slice must:

- fit one focused implementation session and have one clear, meaningful outcome;
- connect all layers needed for that narrow behavior rather than defer integration through horizontal model/service/UI/test phases;
- include its own relevant tests and executable validation;
- leave the repository coherent, provide feedback before later slices, and declare dependencies;
- remain inside `SPEC.md`, established simplicity constraints, and its stated scope.

## 7. Audit and stop

Before finishing, ensure:

- every goal is covered and no slice adds behavior outside `SPEC.md`;
- architecture is sufficiently fixed, dependencies are accurate, and source responsibilities are coherent;
- tests accompany their behavior and criteria test behavior/boundaries rather than implementation details;
- `SPEC.md` describes only the destination and `PLAN.md` only the route, without unnecessary duplication.

After writing both approved files in their task directory, summarize what was written and any faithful presentational adjustment made while turning the approvals into documents. Then stop. Do not implement or modify production code in this invocation.
