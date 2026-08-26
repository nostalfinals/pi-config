---
name: design
description: Collaboratively design a system or change while maintaining its human-readable design document.
disable-model-invocation: true
---

# Design

Create or refine one long-lived design document at `docs/<short-purpose>-design.md`. The document is the authoritative description of the intended system for both humans and implementation agents. It describes the destination, not implementation slices or progress.

Keep the document inside the **design surface**: settled decisions and the context needed to understand them. Repository exploration is evidence, not exposition. Describe existing code or another subsystem only when this design changes it, integrates with it, depends on it, or deliberately follows its precedent; state only the relevant constraint or relationship. Leave production code unchanged.

## 1. Establish the design surface

Read repository instructions, inspect the working tree, and trace relevant source, tests, conventions, callers, and existing documents. Resolve externally knowable facts through the environment or authoritative documentation rather than asking the user.

Identify the existing design document that clearly owns the topic, or choose a concise kebab-case path for a new one. Keep design files unchanged during this exploration. Begin the interview with the first material decision question.

This step is complete when the document target and authority are clear, the relevant current system has been inspected deeply enough to identify the material decision branches, and one decision question has been asked.

## 2. Grill and capture

Interview the user relentlessly until a shared understanding covers every material aspect. Walk the decision tree one branch at a time, resolving dependent decisions in order. Ask exactly one question, include a recommended answer, and wait for the user's decision before continuing. Resolve newly encountered factual questions through the environment or authoritative documentation; design decisions belong to the user.

A clear selection, acceptance, or correction from the user confirms a choice. Brainstorming, questions, tentative reactions, and silence leave the choice unsettled and the file unchanged.

After every confirmed choice:

1. create the planned document if needed, then update the affected design section before asking the next question;
2. write only the settled design, its design-relevant rationale, and any existing-system constraint necessary to understand it;
3. propagate the decision through related API, behavior, examples, invariants, and tests;
4. challenge ambiguous terminology and concrete edge cases;
5. inspect the code when the answer depends on current behavior or feasibility.

Model terminology inside the design itself. Define precise local terms where they are introduced or in a document glossary when useful. Keep unresolved branches in the conversation; the document contains the settled contract.

Explore every applicable branch; omit concerns that do not materially affect this design:

- system boundary, users, goals, and non-goals;
- affected existing behavior, integration points, and compatibility;
- domain concepts, vocabulary, identity, and ownership;
- public API skeleton, exact types, generics, signatures, and naming;
- workflows, state transitions, lifecycle, and default behavior;
- errors, callback failure, fallback, recovery, and migration;
- concurrency, threading, atomicity, and ordering;
- persistence, wire formats, schemas, and trust boundaries;
- security, privacy, and abuse cases;
- hot paths, performance, memory, and operational constraints;
- observability, testing strategy, test seams, and behavioral oracles.

This step is complete only when every applicable branch has a settled, documented answer or an explicit intentional boundary.

## 3. Keep one coherent contract

Write like technical documentation for people, not a private agent prompt. Prefer orientation, system models, worked examples, diagrams, and explanatory prose; use normative rules where precision matters.

Use code skeletons for public or load-bearing internal contracts. Centralize each complete API definition once; behavioral sections explain semantics and refer back to it rather than repeating interfaces. Keep implementation file lists, slice ordering, progress, and validation commands out of the design document.

When the user indicates the discussion is ending, or every applicable branch appears settled, audit the whole document for:

- contradictions between prose, examples, diagrams, signatures, and decisions;
- duplicate API definitions or competing sources of truth;
- stale names, types, decisions, or placeholders;
- unspecified edge cases that would force an implementer to invent behavior;
- requirements with no feasible test oracle;
- claims contradicted by the inspected codebase or authoritative dependencies;
- project exposition outside this design surface.

If the audit finds a contradiction, conflict, or gap whose resolution could change the design, ask one question with a recommended answer and wait. Capture only the user's confirmed resolution, then repeat the full audit. Once no decision-level issue remains, perform a final editorial pass: preserve every design decision exactly while removing duplication and out-of-surface exposition and improving organization, consistency, concision, and readability. Repeat the audit after editing; any decision-level issue returns to the question loop.

This step is complete only when the post-edit audit finds no material contradiction, conflict, missing decision, or out-of-surface exposition, and the document reads as one self-contained contract whose requirements can be implemented and verified without rediscovering design decisions.

## 4. Approve the design

Present a concise final summary, the important decisions, and intentional boundaries. Ask the user to confirm that the design is complete and accurate. If they revise it, capture the confirmed revision, repeat the full audit and final editorial pass, then request approval again.

After explicit confirmation, report the completed design path and stop.
