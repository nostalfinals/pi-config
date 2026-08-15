import {
  ToolExecutionComponent,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  sliceByColumn,
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import {
  cleanToolLines,
  ordinaryTrim,
  stripAnsi,
  transcriptGap,
  trimRenderedLine,
  type TranscriptToolKind,
} from "./tool-layout";
import { renderToolParameter } from "./tool-parameter";
import {
  type BodyComposeContext,
  type ToolDisplayDescriptor,
  type ToolInternals,
  type ToolResult,
} from "./tool-display";
import { getBuiltinToolDisplays } from "./builtin-tool-displays";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function isInlineImageLine(line: string) {
  return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}

function firstVisibleLine(lines: string[]) {
  return lines.findIndex((line) => stripAnsi(line).trim().length > 0);
}

function withToolCallTheme(theme: Theme, skillRead: boolean, replaceParameters: boolean): Theme {
  if (!skillRead && !replaceParameters) return theme;
  return new Proxy(theme, {
    get(target, property, receiver) {
      if (property === "fg") {
        return (role: Parameters<Theme["fg"]>[0], text: string) => {
          if (skillRead && role === "customMessageLabel") {
            return `${target.fg("toolTitle", target.bold("skill"))} `;
          }
          if (replaceParameters && skillRead && role === "customMessageText") {
            return renderToolParameter(target, text);
          }
          if (replaceParameters && role === "accent") return renderToolParameter(target, text);
          if (skillRead && role === "dim") return target.fg("muted", text);
          return target.fg(role, text);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function withErrorOutputTheme(theme: Theme): Theme {
  return new Proxy(theme, {
    get(target, property, receiver) {
      if (property === "fg") {
        return (role: Parameters<Theme["fg"]>[0], text: string) =>
          target.fg(role === "toolOutput" ? "error" : role, text);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function removeVisibleExpandHint(line: string) {
  const plain = stripAnsi(line);
  const match = plain.match(/\s*\([^)]*to expand\)\s*$/u);
  if (!match || match.index === undefined) return line;
  return sliceByColumn(line, 0, visibleWidth(plain.slice(0, match.index)), true);
}

type PathElision = {
  prefixWidth: number;
  suffixStart: number;
};

function elidePathAtMiddle(path: string, maxWidth: number): PathElision | undefined {
  if (visibleWidth(path) <= maxWidth) return undefined;

  const segments = path.split("/");
  if (segments.length < 3) return undefined;

  // Replace whole middle path segments only. This keeps both displayed ends
  // navigable and avoids producing partial directory names such as ".../ent/".
  let removeStart = Math.max(1, Math.floor(segments.length / 2));
  let removeEnd = removeStart + 1;
  while (removeEnd < segments.length) {
    const prefix = segments.slice(0, removeStart).join("/");
    const suffix = segments.slice(removeEnd).join("/");
    const abbreviated = prefix ? `${prefix}/.../${suffix}` : `/.../${suffix}`;
    if (visibleWidth(abbreviated) <= maxWidth) {
      return {
        prefixWidth: visibleWidth(prefix),
        suffixStart: visibleWidth(path) - visibleWidth(suffix),
      };
    }

    const canExpandLeft = removeStart > 1;
    const canExpandRight = removeEnd < segments.length - 1;
    if (!canExpandLeft && !canExpandRight) break;
    if (canExpandLeft && (!canExpandRight || removeStart - 1 >= segments.length - removeEnd - 1)) {
      removeStart -= 1;
    } else {
      removeEnd += 1;
    }
  }
  return undefined;
}

function shortenMiddle(line: string, width: number, pathArgument: string | undefined) {
  if (width <= 0) return "";
  if (visibleWidth(line) <= width) return line;
  if (width <= 3) return truncateToWidth(line, width, "");

  // Renderers declare their actual filesystem-path argument. Inferring a path
  // from a slash in the rendered text misclassified values such as Context7
  // library IDs (/org/project) and queries containing URLs or regexes.
  const plain = stripAnsi(line);
  if (pathArgument) {
    const pathOffset = plain.indexOf(pathArgument);
    if (pathOffset >= 0) {
      const pathStart = visibleWidth(plain.slice(0, pathOffset));
      const trailingWidth = visibleWidth(plain.slice(pathOffset + pathArgument.length));
      const elision = elidePathAtMiddle(pathArgument, width - pathStart - trailingWidth);
      if (elision) {
        const total = visibleWidth(line);
        const prefixEnd = pathStart + elision.prefixWidth;
        const suffixStart = pathStart + elision.suffixStart;
        return `${sliceByColumn(line, 0, prefixEnd, true)}/.../${sliceByColumn(line, suffixStart, total - suffixStart, true)}`;
      }
    }
  }

  return truncateToWidth(line, width, "...");
}

function unwrappedText(component: Component | undefined) {
  const text = (component as { text?: unknown } | undefined)?.text;
  return typeof text === "string" && !text.includes("\n") ? text : undefined;
}

function composeHeader(
  rawHeader: string,
  summary: string | undefined,
  indicator: string,
  theme: Theme,
  width: number,
  pathArgument: string | undefined,
) {
  const prefix = `${indicator} `;
  // ANSI-aware column slicing can end before an OSC 8 hyperlink terminator.
  // Close it before appending metadata so summaries do not become clickable.
  const safeHeader = rawHeader.includes("\x1b]8;;")
    ? `${rawHeader}\x1b]8;;\x1b\\`
    : rawHeader;
  const styledSummary = summary ? theme.fg("muted", summary) : "";
  const summarySuffix = summary ? ` ${styledSummary}` : "";
  const middleBudget = width - visibleWidth(prefix) - visibleWidth(summarySuffix);
  if (middleBudget > 0) {
    const line = `${prefix}${shortenMiddle(removeVisibleExpandHint(safeHeader), middleBudget, pathArgument)}${summarySuffix}`;
    if (visibleWidth(line) <= width) return line;
  }
  return truncateToWidth(`${prefix}${safeHeader}${summarySuffix}`, width, "");
}

/** Default body composition: call body after the header, then result lines. */
function defaultComposeBody(ctx: BodyComposeContext): string[] {
  const body: string[] = [];
  const headerIndex = firstVisibleLine(ctx.callLines);
  if (!ctx.display.suppressCallBody) {
    body.push(...ordinaryTrim(ctx.callLines.slice(headerIndex + 1)));
  }
  if (ctx.resultLines.length > 0) {
    const resultLines = ctx.display.transformResultLines
      ? ctx.display.transformResultLines(ctx.resultLines)
      : ctx.resultLines;
    body.push(...resultLines);
  }
  return body;
}

function renderUserMessage(component: Container, width: number, theme: Theme) {
  const outputPad = Math.max(
    0,
    Number((component as Container & { outputPad?: number }).outputPad) || 0,
  );
  const rawLines = component.render(width);
  const hasZoneStart = rawLines.some((line) => line.includes(OSC133_ZONE_START));
  const hasZoneEnd = rawLines.some((line) => line.includes(OSC133_ZONE_END));
  const hasZoneFinal = rawLines.some((line) => line.includes(OSC133_ZONE_FINAL));
  const background = theme.getBgAnsi("userMessageBg");
  let lines = rawLines.map((line) => {
    let value = line
      .split(OSC133_ZONE_START).join("")
      .split(OSC133_ZONE_END).join("")
      .split(OSC133_ZONE_FINAL).join("");
    if (background) value = value.split(background).join("");
    return trimRenderedLine(value.split("\x1b[49m").join(""));
  });

  while (lines.length > 0 && stripAnsi(lines[0]!).trim() === "") lines.shift();
  while (lines.length > 0 && stripAnsi(lines[lines.length - 1]!).trim() === "") lines.pop();
  if (lines.length === 0) return [];

  lines = lines.map((line) => {
    const lineWidth = visibleWidth(line);
    const content = outputPad > 0
      ? sliceByColumn(line, Math.min(outputPad, lineWidth), lineWidth, true)
      : line;
    const row = truncateToWidth(` ${trimRenderedLine(content)}`, width, "");
    const padded = `${row}${" ".repeat(Math.max(0, width - visibleWidth(row)))}`;
    return theme.bg("userMessageBg", padded);
  });
  if (hasZoneStart) lines[0] = `${OSC133_ZONE_START}${lines[0]}`;
  const suffix = `${hasZoneEnd ? OSC133_ZONE_END : ""}${hasZoneFinal ? OSC133_ZONE_FINAL : ""}`;
  if (suffix) lines[lines.length - 1] = `${lines[lines.length - 1]}${suffix}`;
  return lines;
}

type ToolCallRenderer = (args: unknown, theme: Theme, ...rest: any[]) => Component;
type ToolResultRenderer = (
  result: Omit<ToolResult, "isError">,
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  context: any,
) => Component;

type PatchedPrototype = {
  render(this: ToolExecutionComponent, width: number): string[];
  invalidate(this: ToolExecutionComponent): void;
  getCallRenderer(this: ToolExecutionComponent): ToolCallRenderer | undefined;
  getResultRenderer(this: ToolExecutionComponent): ToolResultRenderer | undefined;
};

export function installToolIndicators(pi: ExtensionAPI) {
  // The built-in display table lives in this module graph (pi loads extensions
  // with moduleCache disabled, so module-level state is not shared across
  // extension files). Custom tools carry their descriptor on the definition.
  const builtinDisplays = getBuiltinToolDisplays();

  function resolveDisplay(self: ToolInternals): ToolDisplayDescriptor {
    const fromDefinition = self.toolDefinition?.display;
    return fromDefinition ?? builtinDisplays.get(self.toolName) ?? EMPTY_DISPLAY;
  }

  const prototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
  const containerPrototype = Container.prototype;
  const originalRender = prototype.render;
  const originalInvalidate = prototype.invalidate;
  const originalGetCallRenderer = prototype.getCallRenderer;
  const originalGetResultRenderer = prototype.getResultRenderer;
  const originalContainerRender = containerPrototype.render;
  const originalContainerInvalidate = containerPrototype.invalidate;
  const renderedKinds = new WeakMap<ToolExecutionComponent, TranscriptToolKind>();
  const transcriptContainers = new WeakSet<Container>();
  const userRenderCache = new WeakMap<Container, {
    width: number;
    outputPad: number;
    theme: Theme;
    lines: string[];
  }>();
  const settledRenderCache = new WeakMap<ToolExecutionComponent, {
    width: number;
    args: unknown;
    result: ToolResult;
    expanded: boolean;
    callComponent: Component | undefined;
    resultComponent: Component | undefined;
    theme: Theme;
    kind: TranscriptToolKind;
    lines: string[];
  }>();
  const EMPTY_DISPLAY: ToolDisplayDescriptor = {};
  let activeTheme: Theme | undefined;
  let patchInstalled = false;

  function getStyledCallRenderer(this: ToolExecutionComponent) {
    const originalRenderer = originalGetCallRenderer.call(this);
    const self = this as unknown as ToolInternals;
    if (!originalRenderer) return undefined;
    const display = resolveDisplay(self);
    return (args: unknown, theme: Theme, ...rest: any[]) => {
      // Keep Pi's skill/docs/resource read classification in both global
      // expansion states; only the result body should expand.
      const rendererRest = display.forceCallCollapsed && rest[0]
        ? [{ ...rest[0], expanded: false }, ...rest.slice(1)]
        : rest;
      return originalRenderer(
        args,
        withToolCallTheme(theme, display.isSkillRead?.(args) ?? false, true),
        ...rendererRest,
      );
    };
  }

  function getStyledResultRenderer(this: ToolExecutionComponent) {
    const originalRenderer = originalGetResultRenderer.call(this);
    const self = this as unknown as ToolInternals;
    if (!originalRenderer) return undefined;
    const display = resolveDisplay(self);
    return (result: Omit<ToolResult, "isError">, options: any, theme: Theme, context: any) => {
      if (display.suppressResultWhenCollapsed && !options.expanded && !context.isError) {
        return new Text("", 0, 0);
      }
      const parameterTheme = withToolCallTheme(
        theme,
        display.isSkillRead?.(context.args) ?? false,
        false,
      );
      return originalRenderer(
        result,
        options,
        context.isError ? withErrorOutputTheme(parameterTheme) : parameterTheme,
        context,
      );
    };
  }

  function renderWithIndicator(this: ToolExecutionComponent, width: number) {
    const self = this as unknown as ToolInternals;
    if (!activeTheme || width <= 0 || self.hideComponent) return originalRender.call(this, width);

    // A restored session never calls setArgsComplete() on historical tool rows.
    // Check the settled cache before doing any result scans or renderer work so
    // those rows remain O(1) on every keypress and streaming update.
    const cached = settledRenderCache.get(this);
    if (
      cached &&
      cached.width === width &&
      cached.args === self.args &&
      cached.result === self.result &&
      cached.expanded === self.expanded &&
      cached.callComponent === self.callRendererComponent &&
      cached.resultComponent === self.resultRendererComponent &&
      cached.theme === activeTheme
    ) {
      return cached.lines;
    }

    const display = resolveDisplay(self);

    // Explicit self-shell tools own their internals. Only the ones opting in
    // via handleSelfShell flow through the chrome (built-in: edit).
    if (self.getRenderShell() === "self" && !display.handleSelfShell) {
      const lines = originalRender.call(this, width);
      // ToolExecutionComponent itself injects this one outer line in self-shell
      // mode. Leave every line produced by the custom renderer untouched.
      if (lines[0] === "") lines.shift();
      renderedKinds.set(this, lines.length > 1 ? "detailed" : "compact");
      return lines;
    }

    // A final result makes known stable rows cacheable even when they came from
    // session restoration with argsComplete=false. Rows are only cached when the
    // tool's display descriptor opts in; arbitrary custom tools stay uncached
    // because their settled components may still animate.
    const cacheable = Boolean(
      self.result &&
      !self.isPartial &&
      !self.result.content.some((block) => block.type === "image") &&
      display.cacheable,
    );

    const innerWidth = Math.max(1, width - 1);
    const pending = !self.result || self.isPartial;
    // Tool argument streaming and Pi's own Working status already trigger UI
    // redraws. Derive the frame from the clock instead of adding another 80ms
    // full-transcript render loop.
    const spinnerFrame = Math.floor(Date.now() / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length;
    const indicator = pending
      ? activeTheme.fg("accent", SPINNER_FRAMES[spinnerFrame]!)
      : self.result?.isError
        ? activeTheme.fg("error", "×")
        : activeTheme.fg("success", "✓");

    const callLines = ordinaryTrim(
      display.renderCallLines
        ? display.renderCallLines(self.callRendererComponent, activeTheme, innerWidth)
        : cleanToolLines(
            self.callRendererComponent?.render(innerWidth) ??
              [activeTheme.fg("toolTitle", activeTheme.bold(self.toolName))],
            activeTheme,
          ),
    );

    // Never probe renderers at an artificial huge width here. Tool rows are
    // redrawn on every spinner frame; doing so made each historical row allocate
    // a 10,000-column background-filled line and could freeze the editor.
    const headerIndex = firstVisibleLine(callLines);
    let rawHeader = headerIndex >= 0
      ? callLines[headerIndex]!
      : activeTheme.fg("toolTitle", activeTheme.bold(self.toolName));
    // Compact tools hide their wrapped call body. Read the original Text content
    // so long path parameters can be abbreviated in the header instead.
    if (display.unwrappedCallHeader) {
      rawHeader = unwrappedText(self.callRendererComponent) ?? rawHeader;
    }
    if (display.forceHeaderTitle) {
      rawHeader = activeTheme.fg("toolTitle", activeTheme.bold(display.forceHeaderTitle));
    }

    const summary = display.summary?.(self, activeTheme);

    const header = composeHeader(
      rawHeader,
      summary,
      indicator,
      activeTheme,
      innerWidth,
      display.pathArgument?.(self.args),
    );
    let body: string[] = [];

    const resultLines = ordinaryTrim(cleanToolLines(
      self.resultRendererComponent?.render(innerWidth) ?? [],
      activeTheme,
    ));
    body = (display.composeBody ?? defaultComposeBody)({
      self,
      callLines,
      resultLines,
      theme: activeTheme,
      width: innerWidth,
      display,
    });

    for (let index = 0; index < self.imageComponents.length; index += 1) {
      const image = self.imageComponents[index];
      if (!image) continue;
      const spacer = self.imageSpacers[index];
      if (spacer) body.push(...spacer.render(innerWidth));
      body.push(...image.render(innerWidth));
    }

    body = ordinaryTrim(body);
    const kind: TranscriptToolKind = display.detailed || body.length > 0
      ? "detailed"
      : "compact";
    renderedKinds.set(this, kind);

    const rail = activeTheme.fg("muted", "│");
    const lines = [
      truncateToWidth(` ${header}`, width, ""),
      ...body.map((line) =>
        isInlineImageLine(line)
          ? line
          : truncateToWidth(` ${rail}${line === "" ? "" : ` ${line}`}`, width, ""),
      ),
    ];
    if (cacheable && self.result) {
      settledRenderCache.set(this, {
        width,
        args: self.args,
        result: self.result,
        expanded: self.expanded,
        callComponent: self.callRendererComponent,
        resultComponent: self.resultRendererComponent,
        theme: activeTheme,
        kind,
        lines,
      });
    }
    return lines;
  }

  function invalidateRenderCache(this: ToolExecutionComponent) {
    settledRenderCache.delete(this);
    originalInvalidate.call(this);
  }

  function renderTranscriptContainer(this: Container, width: number) {
    const children = this.children;
    const isSkillInvocation = (child: Component) =>
      child.constructor.name === "SkillInvocationMessageComponent";
    const isTranscriptTool = (child: Component) =>
      child instanceof ToolExecutionComponent || isSkillInvocation(child);
    if (
      !transcriptContainers.has(this) &&
      !children.some((child) =>
        isTranscriptTool(child) || child.constructor.name === "UserMessageComponent"
      )
    ) {
      return originalContainerRender.call(this, width);
    }
    transcriptContainers.add(this);

    const output: string[] = [];
    let previousType: "tool" | "other" | undefined;
    let previousKind: TranscriptToolKind | undefined;

    for (const child of children) {
      const componentName = child.constructor.name;
      let lines: string[];
      if (isTranscriptTool(child)) {
        lines = child.render(width);
      } else if (componentName !== "UserMessageComponent") {
        lines = ordinaryTrim(child.render(width));
      } else {
        const userComponent = child as Container & { outputPad?: number };
        const outputPad = Number(userComponent.outputPad) || 0;
        const cached = userRenderCache.get(userComponent);
        if (
          cached &&
          cached.width === width &&
          cached.outputPad === outputPad &&
          cached.theme === activeTheme
        ) {
          lines = cached.lines;
        } else {
          lines = renderUserMessage(userComponent, width, activeTheme!);
          userRenderCache.set(userComponent, {
            width,
            outputPad,
            theme: activeTheme!,
            lines,
          });
        }
      }

      if (lines.length === 0) continue;
      const type = isTranscriptTool(child) ? "tool" : "other";
      const kind = type === "tool"
        ? isSkillInvocation(child)
          ? (child as unknown as { expanded: boolean }).expanded ? "detailed" : "compact"
          : renderedKinds.get(child as ToolExecutionComponent) ?? "detailed"
        : undefined;
      const firstLine = lines[0] ?? "";
      const isUserMessage = componentName === "UserMessageComponent";
      // Both assistant and user messages carry OSC 133 markers. Only an
      // assistant message owns a leading external Spacer; the user row gets
      // its transcript gap explicitly below.
      const ownsLeadingGap = componentName === "AssistantMessageComponent" &&
        firstLine.includes(OSC133_ZONE_START);
      // Keep the first user message one row below the top of the transcript,
      // even when there is no rendered component before it.
      const gap = isUserMessage
        ? 1
        : ownsLeadingGap
          ? 0
          : transcriptGap(previousType, previousKind, type, kind);
      for (let index = 0; index < gap; index += 1) output.push("");
      output.push(...lines);
      previousType = type;
      previousKind = kind;
    }
    return output;
  }

  function invalidateTranscriptContainer(this: Container) {
    userRenderCache.delete(this);
    originalContainerInvalidate.call(this);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeTheme = ctx.ui.theme;
    prototype.render = renderWithIndicator;
    prototype.invalidate = invalidateRenderCache;
    prototype.getCallRenderer = getStyledCallRenderer;
    prototype.getResultRenderer = getStyledResultRenderer;
    containerPrototype.render = renderTranscriptContainer;
    containerPrototype.invalidate = invalidateTranscriptContainer;
    patchInstalled = true;
  });

  pi.on("session_shutdown", () => {
    activeTheme = undefined;
    if (patchInstalled) {
      prototype.render = originalRender;
      prototype.invalidate = originalInvalidate;
      prototype.getCallRenderer = originalGetCallRenderer;
      prototype.getResultRenderer = originalGetResultRenderer;
      containerPrototype.render = originalContainerRender;
      containerPrototype.invalidate = originalContainerInvalidate;
      patchInstalled = false;
    }
  });
}
