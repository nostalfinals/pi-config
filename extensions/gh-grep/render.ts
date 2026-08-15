import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { describeFilters, type GrepAppParams } from "./lib";

const PREVIEW_LINES = 5;

type ResultRenderOptions = {
  expanded: boolean;
  isPartial: boolean;
};

export function renderGrepCall(args: GrepAppParams, theme: Theme): Component {
  const query = args.query.replace(/\s+/gu, " ").trim();
  const filters = describeFilters(args);
  const text =
    theme.fg("toolTitle", theme.bold("gh_grep")) +
    (query ? ` ${theme.fg("accent", query)}` : "") +
    (filters ? ` ${theme.fg("accent", filters)}` : "");

  return {
    render: (width) => new Text(text, 0, 0).render(width),
    invalidate: () => {},
  };
}

class GrepResultComponent implements Component {
  private text = "";
  private expanded = false;
  private isPartial = false;
  private isError = false;
  private theme: Theme;

  constructor(theme: Theme) {
    this.theme = theme;
  }

  setResult(
    text: string,
    options: ResultRenderOptions,
    theme: Theme,
    isError: boolean,
  ) {
    this.text = text;
    this.theme = theme;
    this.expanded = options.expanded;
    this.isPartial = options.isPartial;
    this.isError = isError;
  }

  render(width: number): string[] {
    const output = new Text(this.theme.fg("toolOutput", this.text), 0, 0).render(width);
    if (
      this.expanded ||
      this.isPartial ||
      this.isError ||
      output.length <= PREVIEW_LINES
    ) {
      return output.length > 0 ? ["", ...output] : output;
    }

    const hiddenLines = output.length - PREVIEW_LINES;
    const hint =
      this.theme.fg("muted", `... (${hiddenLines} more lines, `) +
      this.theme.fg("dim", keyText("app.tools.expand")) +
      this.theme.fg("muted", " to expand)");
    return [
      "",
      ...output.slice(0, PREVIEW_LINES),
      truncateToWidth(hint, width, "..."),
    ];
  }

  invalidate(): void {}
}

export function renderGrepResult(
  result: { content: Array<{ type: string; text?: string }> },
  options: ResultRenderOptions,
  theme: Theme,
  context: { isError: boolean; lastComponent?: Component },
): Component {
  const text = result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!)
    .join("\n");

  const component =
    context.lastComponent instanceof GrepResultComponent
      ? context.lastComponent
      : new GrepResultComponent(theme);
  component.setResult(text, options, theme, context.isError);
  return component;
}
