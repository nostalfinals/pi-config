Do not modify files when asked only to inspect, review, analyze, diagnose, or check something. Make changes only when explicitly requested; when uncertain, provide analysis and ask first.

Do not treat any specification or planning document under `docs/agent-tasks` whose slices are all marked complete as authoritative. Inspect the current codebase, and do not update those documents to match the current project state unless explicitly requested.

Do not test or assert the exact or partial wording of prompts, messages, logs, or other non-contractual human-readable text. Test the underlying state or behavior; wording-only changes must not break tests.

Do not spawn any subagent unless explicitly requested by the user or required by the current workflow.
