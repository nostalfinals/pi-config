# UI performance notes

## Current status

The long-session regression introduced by `c923d78` is fixed in the working tree. The user confirmed that the UI now feels effectively indistinguishable from native Pi. Do not optimize further unless a measurable regression returns.

The active fix is in `transcript/tool-indicator.ts`; inspect its diff rather than reconstructing the original diagnosis from scratch.

## What to preserve

Any future transcript work must retain:

- O(1) cache hits for restored, settled built-in tool rows, including rows restored with `argsComplete === false`.
- Cache invalidation across argument/result replacement, expansion, width and theme changes.
- Uncached arbitrary custom tools, because a settled custom component may still animate.
- Existing handling for self-shell tools, edit previews, inline images and OSC 133 shell-integration zones.
- The compact spacing and user-message appearance introduced by `c923d78`.

A benchmark against a real long session reduced restored transcript rendering from roughly 137 ms/frame to roughly 7 ms/frame; native rendering in the same harness was roughly 3 ms/frame. These are directional local measurements, not contractual timing thresholds.

## Deferred improvements

Only pursue these if profiling shows a need:

1. Replace the global `Container.prototype` transcript patch with a targeted transcript/user-message integration or an upstream Pi rendering hook.
2. Add a behavioral regression test that reconstructs many settled historical tools with `argsComplete === false` and verifies expensive renderers are reused. Prefer renderer-call counts over wall-clock assertions.
3. Reduce the remaining cache-hit bookkeeping, but only with explicit invalidation on every visual state mutation.
4. Give `Context7ResultComponent` its own width/text render cache if Context7-heavy sessions show up in profiles.
5. Consider an upstream incremental or virtualized transcript API if native Pi itself becomes slow for extremely large visible histories.

## Validation guidance

- Compare an extension-enabled run with `pi --no-extensions` before attributing a regression.
- Test both a newly created session and a resumed long session.
- Exercise typing, assistant streaming, tool streaming, expansion toggles, theme changes, errors, edit diffs and image output.
- Use `git diff --check` and load the TypeScript extension through Pi/Jiti after changes.
- Do not add wording-sensitive tests for labels, summaries or hints; test rendered state and cache behavior.
