---
name: keep-it-simple
description: Keep coding changes simple, direct, and proportionate to the current requirement. Use when implementing, fixing, refactoring, reviewing, or designing code, especially when there is a risk of over-engineering, unnecessary abstraction, excessive scaffolding, speculative extensibility, dependency growth, or oversized test suites. Also use when the user asks for a minimal solution, a small diff, fewer abstractions, less boilerplate, or the simplest maintainable implementation.
disable-model-invocation: true
---

# Keep It Simple

Implement the smallest clear solution that fully satisfies the current requirement.

Simplicity means reducing unnecessary concepts, files, dependencies, and maintenance burden. It does not mean writing cryptic code, skipping investigation, or weakening correctness.

## Understand Before Simplifying

Before changing code:

1. Read the relevant implementation and surrounding context.
2. Trace the actual execution or data flow affected by the request.
3. Search for existing helpers, types, conventions, and implementations.
4. Identify the root cause and the narrowest correct change point.
5. Distinguish current requirements from hypothetical future needs.

Do not choose a small-looking patch before understanding where the behavior belongs.

## Prefer Existing Capabilities

Consider solutions in this order:

1. Do nothing if the requested behavior already exists or no change is needed.
2. Reuse an existing project helper, type, component, or pattern.
3. Use a language or standard-library feature.
4. Use a native platform, framework, database, browser, or operating-system feature.
5. Use an already-installed dependency when it clearly fits.
6. Write the minimum clear custom implementation.

Do not add a dependency for behavior that can be implemented clearly with a small amount of ordinary code.

## Avoid Speculative Structure

Do not introduce structure solely because it might become useful later.

Avoid unless the current requirement justifies them:

- interfaces with one implementation;
- factories for one construction path;
- wrappers that only rename another API;
- configuration for values that do not currently vary;
- generic frameworks for one concrete use case;
- extension points without a current consumer;
- new layers that only forward calls;
- parallel models or DTOs with no meaningful boundary;
- utility files containing one narrowly used function;
- scaffolding for hypothetical future features.

Prefer keeping closely related logic together until real duplication or variation appears.

## Keep the Diff Proportionate

Prefer:

- modifying an existing file over creating several new files;
- fixing a shared root cause over patching individual symptoms;
- deleting obsolete code over preserving compatibility nobody needs;
- direct control flow over unnecessary indirection;
- established project conventions over introducing a new pattern;
- boring, readable code over clever compression.

Minimize the diff only after identifying the correct change location.

Do not combine unrelated cleanup or refactoring with the requested change.

## Preserve Necessary Engineering

Never remove or weaken:

- input validation at trust boundaries;
- authorization or security controls;
- error handling needed to prevent corruption or data loss;
- transaction and concurrency guarantees;
- accessibility requirements;
- compatibility explicitly required by the task;
- behavior explicitly requested by the user.

Do not use “simplicity” as an excuse to ignore real edge cases.

Handle edge cases that are realistic for the current boundary. Do not build machinery for purely hypothetical scenarios.

## Abstraction Rule

Create or retain an abstraction when at least one of these is true:

- multiple real implementations already exist;
- the abstraction represents a meaningful domain boundary;
- it isolates an unstable external system;
- it removes substantial verified duplication;
- the surrounding codebase already relies on that abstraction pattern;
- the user explicitly requests it.

Otherwise, prefer a concrete implementation.

## Testing and Verification

Verify the change with the smallest relevant method.

Prefer, in order:

1. run an existing focused test;
2. run an existing type-check, build, lint, or validation command;
3. perform a small direct reproduction or manual check;
4. add a focused regression test when it provides clear lasting value.

Do not introduce a new testing framework, fixtures, mocks, or broad test suite unless required.

Do not write tests that merely assert source text, implementation details, or trivial language behavior.

Add tests when the changed behavior is non-trivial, regression-prone, or already covered by the project's testing conventions. Do not add tests mechanically.

## Communication

Lead with the implemented result or recommendation.

Briefly mention important simplifications or omitted speculative work when that information helps the user evaluate the result.

Do not force explanations to be shorter than the task requires. Provide detailed reasoning when requested.

Do not argue against an explicit requirement after the user has confirmed it. Implement it using the simplest maintainable approach that preserves the requested behavior.
