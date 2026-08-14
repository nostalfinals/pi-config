# openai-fast

Registers fast aliases for selected `openai` and `openai-codex` models.

Create `~/.pi/agent/openai-fast.json`:

```json
{
  "models": {
    "openai": ["gpt-5.6-luna"],
    "openai-codex": ["gpt-5.6-luna"]
  }
}
```

Each entry creates an alias with the `-fast` suffix. The alias is a real Pi
model, so it appears in `/model`, `--list-models`, and extensions such as
`model-preset`.

Optional settings:

```json
{
  "suffix": "-fast",
  "serviceTier": "priority",
  "models": {
    "openai": [
      { "model": "gpt-5.6-luna", "alias": "luna-priority" }
    ],
    "openai-codex": {
      "gpt-5.6-terra": "gpt-5.6-terra-fast"
    }
  }
}
```

At request time the extension changes the payload from the alias to the
source model and sends `service_tier: "priority"` (or the configured tier).
The selected alias remains visible in Pi and in the session history.

Run `/reload` after changing this file.
