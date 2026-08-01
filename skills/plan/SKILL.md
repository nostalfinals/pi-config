---
name: plan
description: Inspect the codebase, align with the user's requirements, and produce comprehensive `PLAN.md` and `SPEC.md` files for a later implementation session. Use this when the user explicitly requests a "Plan → Implement → Review" workflow.
disable-model-invocation: true
---

Produce two non-duplicative artifacts in `docs/agent-tasks/<short-purpose>/` at the project root, creating the directory when needed:

- `SPEC.md`: **The Destination.** A stable contract for behavior, design, boundaries, constraints, and acceptance.
- `PLAN.md`: **The way.** A adaptable sequence of independently verifiable slices implementing that contract.

Use a concise kebab-case `<short-purpose>` that describes the plan, for example `docs/agent-tasks/implement-grayscale-toggle/{SPEC,PLAN}.md`.

## 1. Establish context

Before designing:

1. Read repository instructions and inspect the working tree. Preserve user changes.
2. Inspect the relevant structure, build system, source, tests, nearby implementations, and conventions.
3. Trace current behavior and integration points in code.
4. Record only findings relevant to the request.

## 2. Align design decisions

Read and use the `grill-me` skill to align design decisions with the user.

## 3. Confirm the grill-me alignment

Before creating or modifying either planning file, restate every point aligned through `grill-me` (or already made explicit in the conversation) as a concise declarative conclusion.

Output the complete restatement as a normal assistant message and ask the user to confirm that it is complete and accurate, then stop. Do not put the restatement in `ask_user_question`. If the user corrects or adds a point, revise the full restatement and obtain confirmation again the same way.

## 4. Define slices

A slice is a small, vertical, independently verifiable increment of behavior that passes through every layer needed to deliver one narrow user-visible or domain-observable outcome.

A slice should normally include the complete path for that behavior, such as:

```
entry point → application/use case → domain logic → persistence or external integration → observable result
```

1. Start from a narrow user-visible action or domain outcome, not from a technical layer.
2. Trace the smallest end-to-end path required to make that outcome work.
3. Implement only the abstractions and infrastructure needed by that path.
4. Keep unrelated behavior out of the slice, even when it belongs to the same feature area.
5. Order slices by meaningful feedback and dependencies, so each slice leaves the codebase coherent and verifiable.

A slice may be an enabling slice only when it is required before any meaningful behavior can be implemented. Do not create slices whose only purpose is to complete an entire technical layer.

## 5. Obtain slice approval

Only after explicit confirmation of the alignment restatement, propose the ordered implementation slices with its title in the conversation.

Present the slice proposal and obtain approval in the same manner as section 3. If revisions are requested, update the proposal and obtain approval again.

Do not create or modify `SPEC.md` or `PLAN.md` until both the alignment restatement and slice proposal have explicit approval.

## 6. Write `docs/agent-tasks/<short-purpose>/SPEC.md`

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

- Describe the concrete problem, current behavior, affected users or callers, intended outcome, and explicit non-goals.
- Define the complete intended behavior and user or caller experience, including normal workflows, inputs and outputs, state changes, lifecycle, concurrency, compatibility, and externally visible side effects. Cover empty, missing, invalid, and failure cases where they materially affect the design.
- Resolve decisions the implementation must not improvise, including module boundaries, dependency direction, ownership, public and integration interfaces, persistence, lifecycle, concurrency, error handling, logging, and reuse.
- Provide concrete signatures, schemas, protocols, data formats, state transitions, or pseudocode wherever needed to eliminate material ambiguity.
- Record applicable constraints covering dependencies, APIs, performance, compatibility, security, data integrity, layout, and implementation simplicity. List expected added, modified, or removed files and their responsibilities only when reasonably knowable; do not invent or over-fragment the file map.
- Define realistic edge cases and make every goal verifiable through explicit acceptance criteria. Specify the appropriate verification boundary using focused tests, integration or end-to-end checks, type checking, linting, builds, or manual QA.

## 7. Write `docs/agent-tasks/<short-purpose>/PLAN.md`

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

## 8. Audit and stop

Before finishing, ensure:

- every goal is covered and no slice adds behavior outside `SPEC.md`;
- architecture is sufficiently fixed, dependencies are accurate, and source responsibilities are coherent;
- tests accompany their behavior and criteria test behavior/boundaries rather than implementation details;
- `SPEC.md` describes only the destination and `PLAN.md` only the route, without unnecessary duplication.

After writing both approved files in their task directory, summarize what was written and any faithful presentational adjustment made while turning the approvals into documents. Then stop. Do not implement or modify production code in this invocation.
