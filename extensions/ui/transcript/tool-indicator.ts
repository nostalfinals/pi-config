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
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import { isContext7Tool, renderContext7Call, renderContext7Result } from "./context7-output";
import {
  countEditDiff,
  countGrepMatches,
  countSearchRows,
  countTextLines,
  plural,
  stripTrailingNotice,
  transcriptGap,
  type TranscriptToolKind,
} from "./tool-layout";
import { renderToolParameter } from "./tool-parameter";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;
const COMPACT_TOOLS = new Set(["read", "grep", "find", "ls"]);
const DETAILED_TOOLS = new Set(["bash", "edit", "write"]);
const ANSI_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\))/gu;
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function stripAnsi(text: string) {
  return text.replace(ANSI_SEQUENCE, "");
}

function isInlineImageLine(line: string) {
  return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}

function firstVisibleLine(lines: string[]) {
  return lines.findIndex((line) => stripAnsi(line).trim().length > 0);
}

function textOutput(result: ToolResult | undefined) {
  return result?.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!)
    .join("\n") ?? "";
}

function isSkillRead(toolName: string, args: unknown) {
  if (toolName !== "read" || !args || typeof args !== "object") return false;
  const readArgs = args as { path?: unknown; file_path?: unknown };
  const path = readArgs.file_path ?? readArgs.path;
  return typeof path === "string" && /(?:^|[\\/])SKILL\.md$/u.test(path);
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

function shortenMiddle(line: string, width: number) {
  if (width <= 0) return "";
  if (visibleWidth(line) <= width) return line;
  if (width <= 3) return truncateToWidth(line, width, "");

  const plain = stripAnsi(line);
  const firstSpace = plain.indexOf(" ");
  const titleWidth = firstSpace < 0 ? 0 : firstSpace + 1;
  const parameter = firstSpace < 0 ? "" : plain.slice(titleWidth);
  const firstSlash = parameter.indexOf("/");
  if (firstSlash >= 0) {
    const pathOffset = parameter.lastIndexOf(" ", firstSlash) + 1;
    const beforePath = parameter.slice(0, pathOffset);
    const path = parameter.slice(pathOffset);
    const pathStart = titleWidth + visibleWidth(beforePath);
    const elision = elidePathAtMiddle(path, width - pathStart);
    if (elision) {
      const total = visibleWidth(line);
      const prefixEnd = pathStart + elision.prefixWidth;
      const suffixStart = pathStart + elision.suffixStart;
      return `${sliceByColumn(line, 0, prefixEnd, true)}/.../${sliceByColumn(line, suffixStart, total - suffixStart, true)}`;
    }
  }

  const marker = "…";
  const prefixWidth = Math.min(
    width - marker.length - 1,
    Math.max(1, titleWidth || Math.ceil(width / 2)),
  );
  const tailWidth = width - prefixWidth - marker.length;
  if (tailWidth <= 0) return truncateToWidth(line, width, marker);
  const total = visibleWidth(line);
  return `${sliceByColumn(line, 0, prefixWidth, true)}${marker}${sliceByColumn(line, total - tailWidth, tailWidth, true)}`;
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
    const line = `${prefix}${shortenMiddle(removeVisibleExpandHint(safeHeader), middleBudget)}${summarySuffix}`;
    if (visibleWidth(line) <= width) return line;
  }
  return truncateToWidth(`${prefix}${safeHeader}${summarySuffix}`, width, "");
}

function ordinaryTrim(lines: string[]) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end);
}

function trimRenderedLine(line: string) {
  const plain = stripAnsi(line);
  const trimmed = plain.replace(/\s+$/u, "");
  return trimmed.length === plain.length
    ? line
    : sliceByColumn(line, 0, visibleWidth(trimmed), true);
}

function removeOneLeadingColumn(line: string) {
  return /^\s/u.test(stripAnsi(line))
    ? sliceByColumn(line, 1, visibleWidth(line), true)
    : line;
}

function lineCountWithoutNotice(output: string) {
  return countTextLines(stripTrailingNotice(output).replace(/\n+$/u, ""));
}

function compactSummary(self: ToolInternals) {
  const result = self.result;
  if (!result || self.isPartial || result.isError) return undefined;
  if (result.content.some((block) => block.type === "image")) return undefined;
  const output = textOutput(result);
  const details = result.details as Record<string, any> | undefined;

  if (self.toolName === "read") {
    const range = output.match(/\[Showing lines (\d+)-(\d+) of (\d+)/u);
    const shown = details?.truncation?.outputLines ?? (range
      ? Number(range[2]) - Number(range[1]) + 1
      : lineCountWithoutNotice(output));
    const total = range ? Number(range[3]) : undefined;
    if (total !== undefined) return `${shown} of ${total} ${total === 1 ? "line" : "lines"}`;
    return plural(shown, "line");
  }
  if (self.toolName === "grep") {
    if (/^No matches found\s*$/u.test(output)) return "no matches";
    const count = countGrepMatches(output, Number(self.args?.context) || undefined);
    if (details?.matchLimitReached) return `${details.matchLimitReached}+ matches`;
    if (details?.truncation?.truncated) return `${count}+ matches`;
    return plural(count, "match", "matches");
  }
  if (self.toolName === "find") {
    if (/^No files found matching pattern\s*$/u.test(output)) return "no files";
    const count = countSearchRows(output);
    if (details?.resultLimitReached) return `${details.resultLimitReached}+ files`;
    if (details?.truncation?.truncated) return `${count}+ files`;
    return plural(count, "file");
  }
  if (self.toolName === "ls") {
    if (/^\(empty directory\)\s*$/u.test(output)) return "empty";
    const count = countSearchRows(output);
    if (details?.entryLimitReached) return `${details.entryLimitReached}+ entries`;
    if (details?.truncation?.truncated) return `${count}+ entries`;
    return plural(count, "entry", "entries");
  }
  return undefined;
}

function writeSummary(args: any) {
  if (typeof args?.content !== "string") return undefined;
  return plural(countTextLines(args.content), "line");
}

function editSummary(self: ToolInternals, theme: Theme) {
  const edits = Array.isArray(self.args?.edits)
    ? self.args.edits
    : typeof self.args?.oldText === "string" && typeof self.args?.newText === "string"
      ? [{ oldText: self.args.oldText, newText: self.args.newText }]
      : [];
  const blockText = plural(edits.length, "block");
  const resultDiff = !self.result?.isError ? self.result?.details?.diff : undefined;
  const preview = self.rendererState?.callComponent?.preview;
  const previewDiff = preview && !("error" in preview) ? preview.diff : undefined;
  const diff = typeof resultDiff === "string" ? resultDiff : previewDiff;
  if (typeof diff !== "string") return blockText;
  const { added, removed } = countEditDiff(diff);
  return `${blockText} ${theme.fg("toolDiffAdded", `+${added}`)} ${theme.fg("toolDiffRemoved", `−${removed}`)}`;
}

function bashSummary(self: ToolInternals) {
  const startedAt = self.rendererState?.startedAt as number | undefined;
  if (startedAt === undefined) return undefined;
  const end = (self.rendererState?.endedAt as number | undefined) ?? Date.now();
  const duration = `${((end - startedAt) / 1000).toFixed(1)}s`;
  const timeout = typeof self.args?.timeout === "number" && self.args.timeout > 0
    ? ` · timeout ${self.args.timeout}s`
    : "";
  return `${!self.result || self.isPartial ? "elapsed" : "took"} ${duration}${timeout}`;
}

function removeBashTiming(lines: string[]) {
  const result = [...lines];
  while (result.length > 0) {
    const plain = stripAnsi(result[result.length - 1]!).trim();
    if (/^(Elapsed|Took) \d+(?:\.\d+)?s$/u.test(plain) || plain === "") result.pop();
    else break;
  }
  return ordinaryTrim(result);
}

function renderBashCommand(args: any, theme: Theme, width: number) {
  const command = typeof args?.command === "string"
    ? args.command || "..."
    : args?.command == null
      ? "..."
      : "[invalid arg]";
  const styled = typeof args?.command === "string"
    ? renderToolParameter(theme, command)
    : theme.fg("error", command);
  return wrapTextWithAnsi(styled, Math.max(1, width - 2));
}

function removeCardBackgrounds(lines: string[], theme: Theme) {
  const roles: Array<Parameters<Theme["getBgAnsi"]>[0]> = [
    "toolPendingBg",
    "toolSuccessBg",
    "toolErrorBg",
  ];
  const backgrounds = roles.map((role) => theme.getBgAnsi(role));
  return lines.map((line) => backgrounds.reduce(
    (value, background) => value.split(background).join("\x1b[49m"),
    line,
  ));
}

function cleanToolLines(lines: string[], theme: Theme) {
  return removeCardBackgrounds(lines, theme).map(trimRenderedLine);
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

function stripEditBox(component: Component | undefined, width: number, theme: Theme) {
  if (!component) return [];
  let lines = cleanToolLines(component.render(width + 2), theme);
  if (lines.length >= 2) lines = lines.slice(1, -1);
  return lines.map((line) => {
    const lineWidth = visibleWidth(line);
    return lineWidth > 1 ? sliceByColumn(line, 1, Math.max(1, lineWidth - 1), true) : "";
  });
}

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details?: any;
  isError: boolean;
};

type ToolInternals = {
  toolName: string;
  args: any;
  expanded: boolean;
  isPartial: boolean;
  result?: ToolResult;
  rendererState: any;
  executionStarted: boolean;
  callRendererComponent?: Component;
  resultRendererComponent?: Component;
  imageComponents: Component[];
  imageSpacers: Component[];
  hideComponent: boolean;
  ui: { requestRender(force?: boolean): void };
  getRenderShell(): "default" | "self";
};

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
  let activeTheme: Theme | undefined;
  let patchInstalled = false;

  function getStyledCallRenderer(this: ToolExecutionComponent) {
    const originalRenderer = originalGetCallRenderer.call(this);
    const self = this as unknown as ToolInternals;
    if (isContext7Tool(self.toolName)) {
      return (args: unknown, theme: Theme) => renderContext7Call(self.toolName, args, theme);
    }
    if (!originalRenderer) return undefined;
    return (args: unknown, theme: Theme, ...rest: any[]) => {
      // Keep Pi's skill/docs/resource read classification in both global
      // expansion states; only the result body should expand.
      const rendererRest = self.toolName === "read" && rest[0]
        ? [{ ...rest[0], expanded: false }, ...rest.slice(1)]
        : rest;
      return originalRenderer(
        args,
        withToolCallTheme(theme, isSkillRead(self.toolName, args), true),
        ...rendererRest,
      );
    };
  }

  function getStyledResultRenderer(this: ToolExecutionComponent) {
    const originalRenderer = originalGetResultRenderer.call(this);
    const self = this as unknown as ToolInternals;
    if (isContext7Tool(self.toolName)) return renderContext7Result;
    if (!originalRenderer) return undefined;
    return (result: Omit<ToolResult, "isError">, options: any, theme: Theme, context: any) => {
      if (COMPACT_TOOLS.has(self.toolName) && !options.expanded && !context.isError) {
        return new Text("", 0, 0);
      }
      const parameterTheme = withToolCallTheme(
        theme,
        isSkillRead(self.toolName, context.args),
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

    // Explicit self-shell tools own their internals. Edit is the one agreed built-in exception.
    if (self.getRenderShell() === "self" && self.toolName !== "edit") {
      const lines = originalRender.call(this, width);
      // ToolExecutionComponent itself injects this one outer line in self-shell
      // mode. Leave every line produced by the custom renderer untouched.
      if (lines[0] === "") lines.shift();
      renderedKinds.set(this, lines.length > 1 ? "detailed" : "compact");
      return lines;
    }

    // A final result makes known stable rows cacheable even when they came from
    // session restoration with argsComplete=false. Keep arbitrary custom tools
    // uncached because their settled components may still animate.
    const cacheable = Boolean(
      self.result &&
      !self.isPartial &&
      !self.result.content.some((block) => block.type === "image") &&
      (COMPACT_TOOLS.has(self.toolName) ||
        DETAILED_TOOLS.has(self.toolName) ||
        isContext7Tool(self.toolName)),
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

    let callLines: string[];
    if (self.toolName === "edit") {
      callLines = stripEditBox(self.callRendererComponent, innerWidth, activeTheme);
    } else {
      callLines = cleanToolLines(self.callRendererComponent?.render(innerWidth) ?? [
        activeTheme.fg("toolTitle", activeTheme.bold(self.toolName)),
      ], activeTheme);
    }
    callLines = ordinaryTrim(callLines);

    // Never probe renderers at an artificial huge width here. Tool rows are
    // redrawn on every spinner frame; doing so made each historical row allocate
    // a 10,000-column background-filled line and could freeze the editor.
    const headerIndex = firstVisibleLine(callLines);
    let rawHeader = headerIndex >= 0
      ? callLines[headerIndex]!
      : activeTheme.fg("toolTitle", activeTheme.bold(self.toolName));
    // Compact tools hide their wrapped call body. Read the original Text content
    // so long path parameters can be abbreviated in the header instead.
    if (COMPACT_TOOLS.has(self.toolName)) {
      rawHeader = unwrappedText(self.callRendererComponent) ?? rawHeader;
    }
    if (self.toolName === "bash") {
      rawHeader = activeTheme.fg("toolTitle", activeTheme.bold("bash"));
    }

    let summary: string | undefined;
    if (COMPACT_TOOLS.has(self.toolName)) summary = compactSummary(self);
    else if (self.toolName === "bash") summary = bashSummary(self);
    else if (self.toolName === "write") summary = writeSummary(self.args);
    else if (self.toolName === "edit") summary = editSummary(self, activeTheme);

    const header = composeHeader(rawHeader, summary, indicator, activeTheme, innerWidth);
    let body: string[] = [];

    const resultLines = ordinaryTrim(cleanToolLines(
      self.resultRendererComponent?.render(innerWidth) ?? [],
      activeTheme,
    ));
    if (self.toolName === "bash") {
      body = renderBashCommand(self.args, activeTheme, innerWidth);
      const bashResultLines = removeBashTiming(resultLines);
      if (bashResultLines.length > 0) body.push("", ...bashResultLines);
    } else if (self.toolName === "write") {
      const blank = callLines.indexOf("");
      if (blank >= 0) body.push(...ordinaryTrim(callLines.slice(blank + 1)));
      if (resultLines.length > 0) body.push(...resultLines);
    } else if (self.toolName === "edit") {
      const headerIndex = firstVisibleLine(callLines);
      body.push(...ordinaryTrim(callLines.slice(headerIndex + 1)));
      if (resultLines.length > 0) body.push(...resultLines.map(removeOneLeadingColumn));
    } else {
      const headerIndex = firstVisibleLine(callLines);
      if (!COMPACT_TOOLS.has(self.toolName)) {
        body.push(...ordinaryTrim(callLines.slice(headerIndex + 1)));
      }
      if (resultLines.length > 0) body.push(...resultLines);
    }

    for (let index = 0; index < self.imageComponents.length; index += 1) {
      const image = self.imageComponents[index];
      if (!image) continue;
      const spacer = self.imageSpacers[index];
      if (spacer) body.push(...spacer.render(innerWidth));
      body.push(...image.render(innerWidth));
    }

    body = ordinaryTrim(body);
    const kind: TranscriptToolKind = DETAILED_TOOLS.has(self.toolName) || body.length > 0
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
      const gap = isUserMessage && previousType !== undefined
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
