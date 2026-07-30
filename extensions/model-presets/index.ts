import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerEditorInputInterceptor } from "../ui-shell/editor/input-interceptors";
import { CONFIG_PATH, loadConfig, type ModelPreset } from "./config";
import { displayModel, selectModelPreset } from "./selector";

function legacyAltShiftSequence(shortcut: string): string | undefined {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop();
  if (
    key?.length === 1 &&
    key >= "a" &&
    key <= "z" &&
    parts.length === 2 &&
    parts.includes("alt") &&
    parts.includes("shift")
  ) {
    return `\u001b${key.toUpperCase()}`;
  }
  return undefined;
}

export default function modelPresets(pi: ExtensionAPI): void {
  const config = loadConfig();
  let selectorOpen = false;
  let currentContext: ExtensionContext | undefined;

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

  const legacySequence = legacyAltShiftSequence(config.shortcut);
  const unregisterLegacyInterceptor = legacySequence
    ? registerEditorInputInterceptor("model-presets:legacy-shortcut", (data) => {
        const ctx = currentContext;
        if (data !== legacySequence || !ctx) return false;
        void showSelector(ctx).catch((error) => {
          ctx.ui.notify(
            `Model preset shortcut failed: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        });
        return true;
      })
    : undefined;

  pi.registerCommand("model-preset", {
    description: "Select a configured model and thinking-level preset",
    handler: async (_args, ctx) => showSelector(ctx),
  });

  pi.registerShortcut(config.shortcut, {
    description: "Open model preset selector",
    handler: showSelector,
  });

  pi.on("session_start", async (_event, ctx) => {
    currentContext = ctx;
    if (config.errors.length > 0) {
      ctx.ui.notify(`Invalid model-preset config (${CONFIG_PATH}):\n${config.errors.join("\n")}`, "error");
    }
  });

  pi.on("session_shutdown", () => {
    currentContext = undefined;
    unregisterLegacyInterceptor?.();
  });
}
