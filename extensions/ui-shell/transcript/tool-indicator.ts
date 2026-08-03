import {
  ToolExecutionComponent,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { isContext7Tool, renderContext7Call } from "./context7-output";
import { renderToolParameter } from "./tool-parameter";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;
const ANSI_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)?)/g;
const SGR_SEQUENCE = /\x1b\[([0-9;:]*)m/g;

function stripAnsi(text: string) {
  return text.replace(ANSI_SEQUENCE, "");
}

function firstVisibleContentIndex(text: string) {
  for (let index = 0; index < text.length;) {
    if (text[index] === "\x1b") {
      ANSI_SEQUENCE.lastIndex = index;
      const match = ANSI_SEQUENCE.exec(text);
      if (match?.index === index) {
        index += match[0].length;
        continue;
      }
    }

    const character = String.fromCodePoint(text.codePointAt(index)!);
    if (!/\s/u.test(character)) return index;
    index += character.length;
  }
  return -1;
}

function activeSgrAt(text: string, index: number) {
  const sequences = [...text.slice(0, index).matchAll(SGR_SEQUENCE)];
  let lastReset = -1;
  sequences.forEach((sequence, sequenceIndex) => {
    if (sequence[1] === "" || sequence[1] === "0") lastReset = sequenceIndex;
  });
  return sequences.slice(lastReset + 1).map((sequence) => sequence[0]).join("");
}

function isSkillRead(toolName: string, args: unknown) {
  if (toolName !== "read" || !args || typeof args !== "object") return false;
  const readArgs = args as { path?: unknown; file_path?: unknown };
  const path = readArgs.file_path ?? readArgs.path;
  return typeof path === "string" && /(?:^|[\\/])SKILL\.md$/u.test(path);
}

function withToolCallTheme(theme: Theme, skillRead: boolean): Theme {
  return new Proxy(theme, {
    get(target, property, receiver) {
      if (property === "fg") {
        return (role: Parameters<Theme["fg"]>[0], text: string) => {
          if (skillRead) {
            if (role === "customMessageLabel") {
              return `${target.fg("toolTitle", target.bold("skill"))} `;
            }
            if (role === "customMessageText" || role === "accent") {
              return renderToolParameter(target, text);
            }
            if (role === "dim") return target.fg("muted", text);
          }
          return role === "accent"
            ? renderToolParameter(target, text)
            : target.fg(role, text);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type ToolInternals = {
  toolName: string;
  isPartial: boolean;
  result?: { isError: boolean };
  ui: { requestRender(force?: boolean): void };
};

type ToolCallRenderer = (
  args: unknown,
  theme: Theme,
  ...rest: unknown[]
) => unknown;

type PatchedPrototype = {
  render(this: ToolExecutionComponent, width: number): string[];
  getCallRenderer(this: ToolExecutionComponent): ToolCallRenderer | undefined;
  updateResult(
    this: ToolExecutionComponent,
    result: { isError: boolean },
    isPartial?: boolean,
  ): void;
};

export function installToolIndicators(pi: ExtensionAPI) {
  const prototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
  const originalRender = prototype.render;
  const originalGetCallRenderer = prototype.getCallRenderer;
  const originalUpdateResult = prototype.updateResult;
  const pendingComponents = new Set<ToolExecutionComponent>();
  let activeTheme: Theme | undefined;
  let activeUi: ToolInternals["ui"] | undefined;
  let animationTimer: ReturnType<typeof setInterval> | undefined;
  let animationFrame = 0;
  let patchInstalled = true;

  const stopAnimation = () => {
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = undefined;
  };

  const startAnimation = () => {
    if (animationTimer || !activeTheme || !activeUi) return;
    animationTimer = setInterval(() => {
      if (pendingComponents.size === 0) {
        stopAnimation();
        return;
      }
      animationFrame = (animationFrame + 1) % SPINNER_FRAMES.length;
      activeUi?.requestRender();
    }, SPINNER_INTERVAL_MS);
  };

  const updatePendingState = (component: ToolExecutionComponent) => {
    const self = component as unknown as ToolInternals;
    if (!self.result || self.isPartial) {
      pendingComponents.add(component);
      activeUi = self.ui;
      startAnimation();
      return;
    }

    pendingComponents.delete(component);
    if (pendingComponents.size === 0) stopAnimation();
  };

  prototype.getCallRenderer = function getCallRendererWithStyledBash() {
    const originalRenderer = originalGetCallRenderer.call(this);
    const self = this as unknown as ToolInternals;

    if (isContext7Tool(self.toolName)) {
      return (args: unknown, theme: Theme) => renderContext7Call(self.toolName, args, theme);
    }

    if (self.toolName !== "bash") {
      if (!originalRenderer) return undefined;
      return (args: unknown, theme: Theme, ...rest: unknown[]) =>
        originalRenderer(
          args,
          withToolCallTheme(theme, isSkillRead(self.toolName, args)),
          ...rest,
        );
    }

    return (args: unknown, theme: Theme) => {
      const bashArgs = args as { command?: unknown; timeout?: number } | undefined;
      const rawCommand = bashArgs?.command;
      const command = typeof rawCommand === "string"
        ? rawCommand
          ? renderToolParameter(theme, rawCommand)
          : theme.fg("toolOutput", "...")
        : rawCommand == null
          ? theme.fg("toolOutput", "...")
          : theme.fg("error", "[invalid arg]");
      const timeout = bashArgs?.timeout;
      const timeoutSuffix = timeout
        ? theme.fg("muted", ` (timeout ${timeout}s)`)
        : "";

      return new Text(
        `${theme.fg("toolTitle", theme.bold("bash"))} ${command}${timeoutSuffix}`,
        0,
        0,
      );
    };
  };

  prototype.updateResult = function updateResultWithIndicator(
    result: { isError: boolean },
    isPartial?: boolean,
  ) {
    originalUpdateResult.call(this, result, isPartial);
    // updateResult is the reliable completion path even when this component is
    // off-screen and never renders again. Remove it immediately so a stale
    // component cannot keep the animation timer alive.
    updatePendingState(this);
  };

  prototype.render = function renderWithIndicator(width: number) {
    const lines = originalRender.call(this, width);
    const self = this as unknown as ToolInternals;
    const pending = !self.result || self.isPartial;

    updatePendingState(this);

    if (!activeTheme || lines.length === 0) return lines;

    const indicator = pending
      ? activeTheme.fg(
          "accent",
          SPINNER_FRAMES[animationFrame % SPINNER_FRAMES.length]!,
        )
      : self.result?.isError
        ? activeTheme.fg("error", "×")
        : activeTheme.fg("success", "✓");
    const titleLine = lines.findIndex((line) => stripAnsi(line).trim().length > 0);
    if (titleLine < 0) return lines;

    let line = lines[titleLine]!;

    // Some self-rendering tools (notably edit) retain the concrete theme's
    // accent ANSI sequence inside their cached call component. Normalize that
    // sequence after rendering as a fallback to the renderer theme proxy.
    const accentAnsi = activeTheme.getFgAnsi("accent");
    const parameterAnsi = renderToolParameter(activeTheme, "").replace(
      /\x1b\[39m$/u,
      "",
    );
    line = line.split(accentAnsi).join(parameterAnsi);

    let contentIndex = firstVisibleContentIndex(line);
    if (contentIndex < 0) return lines;

    // Bash renders its call title as "$ command" instead of using its tool
    // name. Normalize only that title marker; execution and result rendering
    // remain untouched.
    if (self.toolName === "bash" && line.slice(contentIndex, contentIndex + 2) === "$ ") {
      line = `${line.slice(0, contentIndex)}bash ${line.slice(contentIndex + 2)}`;
      contentIndex = firstVisibleContentIndex(line);
    }

    const restoredStyle = activeSgrAt(line, contentIndex);
    lines[titleLine] = truncateToWidth(
      `${line.slice(0, contentIndex)}${indicator}${restoredStyle} ${line.slice(contentIndex)}`,
      width,
      "",
    );
    return lines;
  };

  pi.on("session_start", (_event, ctx) => {
    stopAnimation();
    pendingComponents.clear();
    activeUi = undefined;
    activeTheme = ctx.mode === "tui" ? ctx.ui.theme : undefined;
    animationFrame = 0;
  });

  pi.on("session_shutdown", () => {
    stopAnimation();
    activeTheme = undefined;
    activeUi = undefined;
    animationFrame = 0;
    pendingComponents.clear();
    if (patchInstalled) {
      prototype.render = originalRender;
      prototype.getCallRenderer = originalGetCallRenderer;
      prototype.updateResult = originalUpdateResult;
      patchInstalled = false;
    }
  });
}
