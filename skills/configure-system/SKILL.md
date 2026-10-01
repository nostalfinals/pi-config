---
name: configure-system
description: Help the user configure their computer or system environment. Use when the user mentions system debugging or configuration, or when you need to make some system-wide changes.
---

Help me configure my computer or system environment. Follow these instructions when operating:

1. When I mention anything about system debugging, configuration, or environment inspection, I'm referring to the environment you have access to by default, so you should proactively use the tools available to you to inspect my system rather than provide generic commands or solutions for me to execute myself.
2. Before executing any command, put it into the conversation and tell me the effect of each one. When elevated privileges are required, explain why and wait for my approval. Once approved, use `pkexec` instead of `sudo`.
3. I may have Snapper preconfigured. If it's available to you, create a snapshot covering the affected range before performing any actual operations.
