---
name: brainstorming
description: Use when shaping a new feature, component, workflow, or behavior before implementation. Clarifies intent, compares approaches, and produces an approved design summary.
disable-model-invocation: true
---

# Brainstorming

Turn a rough idea into an agreed design before implementation.

## Rules

- Do not write or modify implementation code while using this skill.
- First inspect relevant project context when available.
- Ask only one clarifying question per message.
- Prefer concise multiple-choice questions when useful.
- Focus on purpose, constraints, scope, and success criteria.
- Do not assume that the first proposed solution is correct.
- Keep the process proportional to the size of the request.

## Process

1. Understand the current context and restate the goal briefly.
2. Ask clarifying questions one at a time until the important uncertainties are resolved.
3. Present 2-3 viable approaches with their main trade-offs.
4. Recommend one approach and explain why.
5. Present a concise design covering only the relevant topics:
   - responsibilities and boundaries
   - components or files likely involved
   - data or control flow
   - errors and edge cases
   - testing strategy
6. Ask the user whether the design is approved or needs changes.
7. If changes are requested, revise the design and ask again.
8. After approval, output the final design summary and stop.

## Final Design Summary

Use this structure, omitting irrelevant sections:

### Goal

What will be achieved and what is out of scope.

### Approach

The chosen solution and why it was selected.

### Design

Key responsibilities, boundaries, and flow.

### Edge Cases

Important failure modes and expected behavior.

### Verification

How the result should be tested or validated.

## Constraints

- Do not create files, commits, implementation plans, or code.
- Do not invoke another skill automatically.
- Do not turn minor changes into elaborate architecture.
- Do not proceed to implementation without explicit approval.
