---
name: plan
description: Inspect the codebase, align requirements and design decisions with the user, and produce `SPEC.md` and `PLAN.md` for a later "Plan → Implement → Review" workflow.
disable-model-invocation: true
---

Create two complementary artifacts under `docs/agent-tasks/<short-purpose>/`:

- `SPEC.md`: the intended behavior, settled design, boundaries, constraints, and acceptance criteria.
- `PLAN.md`: an adaptable sequence of independently verifiable slices that delivers the specification.

Use a concise kebab-case task name. Do not modify production code in this invocation.

## 1. Understand the change

Read repository instructions, inspect the working tree, and trace the relevant source, tests, conventions, current behavior, and integration points. Preserve existing changes and investigate only what is relevant to the request.

## 2. Align and approve

Read and use the `grill-me` skill to resolve material requirements and design decisions with the user. If the conversation already contains settled alignment on the material requirements and design decisions—whether reached through `grill-me`, `grilling`, or another process—reuse it and proceed directly to the approval proposal.

Then define small vertical slices around user-visible or domain-observable outcomes. Each slice must cover the smallest end-to-end path needed for its outcome and leave the codebase coherent and independently verifiable. Use an enabling slice only when no meaningful vertical outcome can be implemented first.

Present the following together for approval:

1. A concise, declarative summary of the aligned requirements and design decisions.
2. The proposed ordered slices, including their outcomes and dependencies.
3. A Mermaid execution roadmap only when the plan has meaningful parallel routes or non-obvious dependencies. Keep dependent slices on the same sequential route.

Ask the user to confirm that the proposal is complete and accurate, then stop. If they revise it, update the complete proposal and obtain approval again. Do not create or modify `SPEC.md` or `PLAN.md` before explicit approval.

## 3. Write `SPEC.md`

Translate the approved decisions into the intended end state, using only applicable sections:

```markdown
# Specification: <change>

## Status
Approved for implementation.

## Context
<problem, relevant current behavior, and affected users or callers>

## Goals and non-goals
<required outcomes and intentional exclusions>

## Required behavior
<observable workflows, rules, state changes, errors, and invariants>

## Design decisions
<settled technical decisions the implementer must not revisit>

## Constraints
<requirements that materially restrict valid implementations>

## Acceptance criteria
<independently verifiable completion conditions>
```

Specify only information that affects behavior, constrains implementation, or prevents a material ambiguity. Include interfaces, schemas, protocols, state transitions, lifecycle, error semantics, compatibility, concurrency, security, performance, or source structure only when relevant. Omit empty sections and statements that merely say a concern does not apply.

Describe the destination rather than the implementation sequence. Keep current source locations, task ordering, and validation commands in `PLAN.md` unless they are themselves durable architectural constraints.

## 4. Write `PLAN.md`

Derive the implementation plan from `SPEC.md` and the approved slices:

```markdown
# Implementation Plan: <change>

## References
- Specification: `SPEC.md`

## Progress
- [ ] Slice 1 — <outcome>

## Current codebase state
<only facts that materially affect execution>

## Execution roadmap
<Mermaid graph only when useful; otherwise omit>

## Slices

### Slice 1 — <outcome>
**Status:** Pending

**Outcome**
<what becomes observably true>

**Scope**
- <smallest coherent implementation, relevant source areas, tests, and integration points>

**Implementation notes**
- <decisions needed to follow the specification and repository conventions>

**Validation**
- `<agent-executable command or check>` — <what it proves and any limitation>

**Dependencies**
- None.

## Final verification
<checks that genuinely require all slices>
```

Every required validation step must be executable autonomously by the implementation agent. Do not require human interaction, manual application or server operation, external approval, or unavailable credentials or infrastructure. When direct verification is not agent-executable, use the strongest feasible automated or static substitute and state its limitation; do not create a slice that the implementation agent can never complete.

Keep `SPEC.md` and `PLAN.md` non-duplicative. Add slice-specific exclusions only when they prevent tempting adjacent work; do not repeat global non-goals in every slice.

After writing both files, summarize their contents and any presentational adjustments made without changing the approved substance. Then stop.
