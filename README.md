# pi-config

A personal collection of Pi configurations and extensions.

> [!WARNING]
>
> This repository contains a number of UI monkey patches made specifically for my own preferences. They may break after Pi updates, and some depend on specific third-party extensions.
>
> It also includes several forks of third-party extensions that I maintain specifically for this setup.

## Skill credits

Some of the skills in the `skills/` directory are sourced from [mattpocock/skills](https://github.com/mattpocock/skills) and may have been modified by me.

These skills are licensed under the MIT License.

## Installation

Clone this repository into your `~/.pi/agent` directory, then start Pi.

You may need to configure the `openai-codex` and `deepseek` providers. If you do not use them, remove the corresponding models from `model-preset.json` and change the default model accordingly; otherwise, Pi may fail to load those models.
