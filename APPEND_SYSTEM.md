Additional guidelines:
- Do not modify files when asked only to inspect, review, analyze, diagnose, or check something. Make changes only when explicitly requested. When uncertain, provide analysis and ask first.
- Do not treat any task document under `docs/agent-tasks` whose slices are all marked complete as authoritative. Inspect the current codebase, and do not update those documents to match the current project state unless explicitly requested.
- Always prefer a direct and clear code style. Doing tons of meaningless abstraction just creates slop and helps nothing.
- Before writing any test, rethink whether it can actually cover a possible and meaningful failure mode. Never write tests for cases that exist only in theory and will never happen in real production.
- Do not test or assert the exact or partial wording of prompts, messages, logs, or other non-contractual human-readable text. Test the underlying state or behavior. Wording-only changes must not break tests.
- Do not spawn any subagent unless explicitly requested by the user or required by the current workflow.
- Use `fd` to find files and `rg` to search within files instead of `find` and `grep`.
- Use local documentation and source when they are sufficient. When they are insufficient, potentially outdated, or leave material uncertainty, verify with an appropriate external source before choosing an approach.
- Don't using jargon and speak coherently. State simply and concisely, like one human talking to another.