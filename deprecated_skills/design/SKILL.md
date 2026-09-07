---
name: design
description: Work with the user to design a system or change and keep its human-readable design document up to date.
disable-model-invocation: true
---

# Design

Create or refine one long-lived design document at `docs/<short-purpose>.md`. The document is the authoritative description of the intended system for people and implementation agents. It describes the destination, not implementation slices or progress.

Keep the document within the design scope. Record settled decisions and the context needed to understand them. Repository exploration is evidence for the design, not material to copy into it. Describe existing code or another subsystem only when the design changes it, integrates with it, depends on it, or deliberately follows its precedent. State only the relevant constraint or relationship. Leave production code unchanged.

## 1. Establish the design scope

Read repository instructions, inspect the working tree, and trace relevant source, tests, conventions, callers, and existing documents. Resolve facts through the environment or authoritative documentation instead of asking the user.

Identify the existing design document that owns the topic, or choose a concise kebab-case path for a new one. Do not change design files during this exploration. Start the interview with the first material decision question, labeled `Q1`.

This step is complete when the document target and its authority are clear, the relevant system has been inspected well enough to identify the material choices, and the first decision-loop round is open.

## 2. Ask questions and record decisions

Run a bounded decision loop until you and the user share an understanding of every material part of the design. Walk through one branch at a time and resolve dependent decisions in order. Resolve new factual questions through the environment or authoritative documentation. Design choices belong to the user.

A **decision round** has at most five decision-loop questions. Combine questions only when the user can answer them together, and keep dependent questions in later rounds. Every decision-loop question gets the next increasing `Q<n>` label, such as `Q1`, `Q2`, and so on. This includes questions that a review adds after reopening the loop. Do not label ordinary factual, progress, completion, or approval questions.

Present each question with your recommended answer, then wait. Open the next round only after the user has clearly resolved every question in the current one. They can answer a question or explicitly choose your recommendation. Do not interrupt an open round to ask whether the user has finished. If a response is partial or unclear, keep the same round open. Ask only for the needed clarification, using the existing labels. Do not repeat settled questions or ask for a separate confirmation that the round is complete. When every question is clear, record the decisions and continue to the next round.

A clear selection, acceptance, or correction confirms the corresponding choice. Brainstorming, questions, tentative reactions, and silence do not settle a choice. Do not put them in the design.

After each confirmed choice:

1. Create the document if needed. Update the affected section before opening the next round.
2. Write only the settled design, the rationale that helps explain it, and any existing-system constraint needed to understand it.
3. Carry the choice through related APIs, behavior, examples, invariants, and tests.
4. Question unclear terms and concrete edge cases.
5. Inspect the code when the answer depends on current behavior or feasibility.

Define terms in the design when you introduce them. Add a glossary when that will help. Keep unresolved branches in the conversation. The document contains only the settled contract.

Explore every applicable branch. Skip concerns that do not affect this design:

- system boundary, users, goals, and non-goals;
- affected behavior, integration points, and compatibility;
- domain concepts, vocabulary, identity, and ownership;
- public API outline, exact types, generics, signatures, and names;
- workflows, state transitions, lifecycle, and defaults;
- errors, callback failure, fallback, recovery, and migration;
- concurrency, threading, atomicity, and ordering;
- persistence, wire formats, schemas, and trust boundaries;
- security, privacy, and abuse cases;
- hot paths, performance, memory, and operational constraints;
- observability, testing strategy, test seams, and behavioral oracles.

This step is complete only when every applicable branch has a settled, documented answer or an explicit intentional boundary.

## 3. Keep one coherent contract

Write technical documentation for people, not a private agent prompt. Use orientation, system models, worked examples, diagrams, and explanatory prose. Use normative rules where precision matters.

Use code skeletons for public or important internal contracts. Define each complete API once. Behavioral sections should explain its semantics and refer back to that definition instead of repeating the interface. Keep implementation file lists, slice ordering, progress, and validation commands out of the design document.

When the user indicates that the discussion is ending, or every applicable branch appears settled, audit the whole document for:

- contradictions between prose, examples, diagrams, signatures, and decisions;
- duplicate API definitions or competing sources of truth;
- stale names, types, decisions, or placeholders;
- edge cases that would force an implementer to invent behavior;
- requirements with no feasible way to test them;
- claims contradicted by the inspected codebase or authoritative dependencies;
- project details outside the design scope.

If the audit finds a contradiction, conflict, or gap that could change the design, return to the decision loop. Open a new round with the newly found questions, then repeat the full audit and editorial pass. Once no design choice remains, edit the document while preserving every decision. Remove duplication and material outside the design scope, and improve its organization, consistency, concision, and readability. Audit it again after editing. Any new design-level issue returns to the question loop.

This step is complete only when the post-edit audit finds no material contradiction, conflict, missing decision, or out-of-scope material. The document should read as one self-contained contract that someone can implement and verify without rediscovering design choices.

## 4. Approve the design

Give a concise final summary, list the important decisions and intentional boundaries, and ask the user to confirm that the design is complete and accurate. If they revise it, record the confirmed revision. Send any new design choices through another decision-loop round, then repeat the full audit and editorial pass before asking for approval again.

After explicit confirmation, report the completed design path and stop.
