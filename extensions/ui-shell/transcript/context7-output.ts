import {
  keyText,
  ToolExecutionComponent,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { renderToolParameter } from "./tool-parameter";

const CONTEXT7_TOOL_NAMES = new Set(["resolve-library-id", "query-docs"]);
const PREVIEW_LINES = 5;

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
};

type ResultRenderOptions = {
  expanded: boolean;
  isPartial: boolean;
};

type ResultRenderContext = {
  isError: boolean;
  lastComponent?: Component;
};

type ResultRenderer = (
  result: ToolResult,
  options: ResultRenderOptions,
  theme: Theme,
  context: ResultRenderContext,
) => Component;

type ToolInternals = {
  toolName: string;
};

export function isContext7Tool(toolName: string) {
  return CONTEXT7_TOOL_NAMES.has(toolName);
}

function context7Parameters(toolName: string, args: unknown) {
  if (!args || typeof args !== "object") return [];
  const values = args as Record<string, unknown>;
  const names = toolName === "resolve-library-id"
    ? ["libraryName", "query"]
    : toolName === "query-docs"
      ? ["libraryId", "query"]
      : [];

  return names.flatMap((name) => {
    const value = values[name];
    if (typeof value !== "string" || value.trim() === "") return [];
    return [value.replace(/\s+/gu, " ").trim()];
  });
}

export function renderContext7Call(toolName: string, args: unknown, theme: Theme): Component {
  const parameters = context7Parameters(toolName, args);
  let text = theme.fg("toolTitle", theme.bold(toolName));
  if (parameters.length > 0) {
    text += ` ${renderToolParameter(theme, parameters.join(", "))}`;
  }

  return {
    render: (width) => new Text(text, 0, 0).render(width),
    invalidate: () => {},
  };
}

type PatchedPrototype = {
  getResultRenderer(this: ToolExecutionComponent): ResultRenderer | undefined;
};

function getTextOutput(result: ToolResult) {
  return result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!)
    .join("\n");
}

class Context7ResultComponent implements Component {
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

export function installContext7OutputCollapse(pi: ExtensionAPI) {
  const prototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
  const originalGetResultRenderer = prototype.getResultRenderer;
  let patchInstalled = true;

  prototype.getResultRenderer = function getContext7ResultRenderer() {
    const originalRenderer = originalGetResultRenderer.call(this);
    const self = this as unknown as ToolInternals;
    if (!CONTEXT7_TOOL_NAMES.has(self.toolName)) return originalRenderer;

    return (result, options, theme, context) => {
      const component = context.lastComponent instanceof Context7ResultComponent
        ? context.lastComponent
        : new Context7ResultComponent(theme);
      component.setResult(getTextOutput(result), options, theme, context.isError);
      return component;
    };
  };

  pi.on("session_shutdown", () => {
    if (patchInstalled) {
      prototype.getResultRenderer = originalGetResultRenderer;
      patchInstalled = false;
    }
  });
}
