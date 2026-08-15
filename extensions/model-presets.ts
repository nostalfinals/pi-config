import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DynamicBorder, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, type KeyId } from "@earendil-works/pi-tui";

export const CONFIG_PATH = join(getAgentDir(), "model-preset.json");
export const DEFAULT_SHORTCUT: KeyId = "alt+shift+m";
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ModelPreset {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
}

export interface LoadedConfig {
  shortcut: KeyId;
  presets: ModelPreset[];
  errors: string[];
}

const BASE_KEYS = new Set([
  ..."abcdefghijklmnopqrstuvwxyz0123456789",
  "escape", "esc", "enter", "return", "tab", "space", "backspace", "delete", "insert", "clear",
  "home", "end", "pageUp", "pageDown", "up", "down", "left", "right",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
  "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "!", "@", "#", "$", "%", "^", "&",
  "*", "(", ")", "_", "+", "|", "~", "{", "}", ":", "<", ">", "?",
]);
const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

function isKeyId(value: unknown): value is KeyId {
  if (typeof value !== "string" || value.length === 0) return false;

  for (const key of BASE_KEYS) {
    if (value === key) return true;
    const suffix = `+${key}`;
    if (!value.endsWith(suffix)) continue;

    const modifiers = value.slice(0, -suffix.length).split("+");
    if (
      modifiers.length > 0 &&
      modifiers.every((modifier, index) => MODIFIERS.has(modifier) && modifiers.indexOf(modifier) === index)
    ) {
      return true;
    }
  }
  return false;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

export function loadConfig(): LoadedConfig {
  const fallback: LoadedConfig = { shortcut: DEFAULT_SHORTCUT, presets: [], errors: [] };
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    return { ...fallback, errors: [error instanceof Error ? error.message : String(error)] };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...fallback, errors: ["configuration root must be an object"] };
  }

  const value = parsed as Record<string, unknown>;
  const errors: string[] = [];
  let shortcut = DEFAULT_SHORTCUT;

  if (value.shortcut !== undefined) {
    if (isKeyId(value.shortcut)) shortcut = value.shortcut;
    else errors.push(`shortcut must be a valid key combination; using ${DEFAULT_SHORTCUT}`);
  }

  if (value.presets === undefined) return { shortcut, presets: [], errors };
  if (!Array.isArray(value.presets)) {
    return { shortcut, presets: [], errors: [...errors, "presets must be an array"] };
  }

  const presets: ModelPreset[] = [];
  const seen = new Set<string>();
  value.presets.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`presets[${index}] must be an object`);
      return;
    }

    const preset = entry as Record<string, unknown>;
    if (typeof preset.provider !== "string" || preset.provider.trim() === "") {
      errors.push(`presets[${index}].provider must be a non-empty string`);
      return;
    }
    if (typeof preset.model !== "string" || preset.model.trim() === "") {
      errors.push(`presets[${index}].model must be a non-empty string`);
      return;
    }
    if (!isThinkingLevel(preset.thinkingLevel)) {
      errors.push(`presets[${index}].thinkingLevel must be one of: ${THINKING_LEVELS.join(", ")}`);
      return;
    }

    const normalized: ModelPreset = {
      provider: preset.provider.trim(),
      model: preset.model.trim(),
      thinkingLevel: preset.thinkingLevel,
    };
    const key = `${normalized.provider}\u0000${normalized.model}\u0000${normalized.thinkingLevel}`;
    if (seen.has(key)) {
      errors.push(`presets[${index}] duplicates an earlier preset`);
      return;
    }
    seen.add(key);
    presets.push(normalized);
  });

  return { shortcut, presets, errors };
}

export function displayModel(preset: ModelPreset): string {
  return `${preset.provider}/${preset.model}`;
}

export async function selectModelPreset(
  ctx: ExtensionContext,
  presets: ModelPreset[],
  isActive: (preset: ModelPreset) => boolean,
): Promise<ModelPreset | undefined> {
  const selected = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
    const items = presets.map((preset, index) => {
      const presetText = `${displayModel(preset)} · ${preset.thinkingLevel}`;
      return {
        value: String(index),
        label: isActive(preset)
          ? `${presetText}  ${theme.fg("success", "active")}`
          : presetText,
      };
    });
    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Model Preset")), 1, 0));

    const list = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    const activeIndex = presets.findIndex(isActive);
    list.setSelectedIndex(activeIndex >= 0 ? activeIndex : 0);
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });

  if (selected === null || selected === undefined) return undefined;
  return presets[Number(selected)];
}

export default function modelPresets(pi: ExtensionAPI): void {
  const config = loadConfig();
  let selectorOpen = false;

  function isActive(preset: ModelPreset, ctx: ExtensionContext): boolean {
    return ctx.model?.provider === preset.provider
      && ctx.model.id === preset.model
      && pi.getThinkingLevel() === preset.thinkingLevel;
  }

  async function applyPreset(preset: ModelPreset, ctx: ExtensionContext): Promise<void> {
    const label = displayModel(preset);
    const model = ctx.modelRegistry.find(preset.provider, preset.model);
    if (!model) {
      ctx.ui.notify(`Model preset not found: ${label}`, "error");
      return;
    }

    if (!(await pi.setModel(model))) {
      ctx.ui.notify(`No API key available for model preset: ${label}`, "error");
      return;
    }

    pi.setThinkingLevel(preset.thinkingLevel);
    const actualLevel = pi.getThinkingLevel();
    if (actualLevel !== preset.thinkingLevel) {
      ctx.ui.notify(
        `Activated ${label}, but thinking was clamped from ${preset.thinkingLevel} to ${actualLevel}`,
        "warning",
      );
      return;
    }

    ctx.ui.notify(`Activated model preset: ${label} · thinking: ${actualLevel}`, "info");
  }

  async function showSelector(ctx: ExtensionContext): Promise<void> {
    if (selectorOpen) return;
    if (config.presets.length === 0) {
      ctx.ui.notify(`No model presets configured. Edit ${CONFIG_PATH}, then run /reload.`, "warning");
      return;
    }
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Model preset selection is available in TUI mode only", "warning");
      return;
    }

    selectorOpen = true;
    try {
      const preset = await selectModelPreset(ctx, config.presets, (candidate) => isActive(candidate, ctx));
      if (preset) await applyPreset(preset, ctx);
    } finally {
      selectorOpen = false;
    }
  }

  pi.registerCommand("model-preset", {
    description: "Select a configured model and thinking-level preset",
    handler: async (_args, ctx) => showSelector(ctx),
  });

  pi.registerShortcut(config.shortcut, {
    description: "Open model preset selector",
    handler: showSelector,
  });

  pi.on("session_start", async (_event, ctx) => {
    if (config.errors.length > 0) {
      ctx.ui.notify(`Invalid model-preset config (${CONFIG_PATH}):\n${config.errors.join("\n")}`, "error");
    }
  });
}
