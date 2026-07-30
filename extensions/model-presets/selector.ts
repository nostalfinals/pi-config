import { DynamicBorder, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text } from "@earendil-works/pi-tui";
import type { ModelPreset } from "./config";

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
