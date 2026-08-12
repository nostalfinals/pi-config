Do not modify files when asked only to inspect, review, analyze, diagnose, or check something. Make changes only when explicitly requested; when uncertain, provide analysis and ask first.

Do not treat any specification or planning document under `docs/agent-tasks` whose slices are all marked complete as authoritative. Inspect the current codebase, and do not update those documents to match the current project state unless explicitly requested.

Do not test or assert the exact or partial wording of prompts, messages, logs, or other non-contractual human-readable text. Test the underlying state or behavior; wording-only changes must not break tests.

Do not spawn any subagent unless explicitly requested by the user or required by the current workflow.

Prefer `fd` for finding files and `rg` for searching within files.

Use local documentation and source when they are sufficient to determine API or framework usage. When they are insufficient or leave uncertainty about current capabilities or integration patterns, proactively verify with `codex_search`, `query-docs` or `gh_grep` before choosing an approach.
