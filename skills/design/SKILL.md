---
name: design
description: Collaboratively design a system or change while maintaining its human-readable design document.
disable-model-invocation: true
---

# Design

Create or refine one long-lived design document at `docs/<short-purpose>-design.md`. The document is the authoritative description of the intended system for both humans and implementation agents. It describes the destination, not implementation slices or progress. Do not modify production code.

## 1. Establish the design surface

Read repository instructions, inspect the working tree, and trace relevant source, tests, conventions, callers, and existing documents. Resolve externally knowable facts through the environment or authoritative documentation rather than asking the user.

Select an existing design document when one clearly owns the topic; otherwise choose a concise kebab-case name and create it immediately. Write the known context, current behavior, goals, and boundaries at the start of the discussion rather than waiting for a final synthesis.

This step is complete when the design document exists, its topic and authority are clear, and the relevant current system has been inspected deeply enough to identify the material decision branches.

## 2. Grill and capture

Interview the user relentlessly until a shared understanding covers every material aspect. Walk the decision tree one branch at a time, resolving dependent decisions in order. Ask exactly one question, include a recommended answer, and wait for the user's decision before continuing. Resolve newly encountered factual questions through the environment or authoritative documentation; design decisions belong to the user. Maintain the design document throughout the discussion, do not execute the proposed system before explicit approval.

After every user answer:

1. update the affected design section before asking the next question;
2. propagate the decision through related API, behavior, examples, invariants, and tests;
3. challenge ambiguous terminology and concrete edge cases;
4. inspect the code when the answer depends on current behavior or feasibility.

Model terminology inside the design itself. Define precise local terms where they are introduced or in a document glossary when useful.

Only settled decisions are normative. A temporary `Open questions` section may preserve unresolved branches during a long session, but it must identify them as unresolved and contain no material blocker when the user considers the design complete.

Explore every applicable branch; omit concerns that do not materially affect this design:

- system boundary, users, goals, and non-goals;
- current behavior, integration points, and compatibility;
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

After each substantial decision and before approval, audit the whole document for:

- contradictions between prose, examples, diagrams, and signatures;
- duplicate API definitions or competing sources of truth;
- stale names, types, decisions, and unresolved placeholders;
- unspecified edge cases that would force an implementer to invent behavior;
- requirements with no feasible test oracle;
- claims contradicted by the inspected codebase or authoritative dependencies.

This step is complete when the document reads as one self-contained contract and every material requirement can be implemented and verified without rediscovering design decisions.

## 4. Approve the design

Present a concise final summary, the important decisions, intentional exclusions, and any remaining non-blocking uncertainty. Ask the user to confirm that the design is complete and accurate. If they revise it, update the document, repeat the consistency audit, and request approval again.

After explicit confirmation, remove or resolve every material open question. Report the completed design path and stop.
