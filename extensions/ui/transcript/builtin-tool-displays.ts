import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import {
  cleanToolLines,
  countEditDiff,
  countGrepMatches,
  countSearchRows,
  countTextLines,
  ordinaryTrim,
  plural,
  stripAnsi,
  stripTrailingNotice,
} from "./tool-layout";
import { renderToolParameter } from "./tool-parameter";
import {
  type BodyComposeContext,
  type ToolDisplayDescriptor,
  type ToolInternals,
  type ToolResult,
} from "./tool-display";

/**
 * Display descriptors for the seven built-in tools that the chrome used to
 * special-case by name. The logic here is byte-for-byte the behavior of the
 * original hardcoded branches in tool-indicator.ts.
 */

function isSkillReadPath(args: unknown) {
  if (!args || typeof args !== "object") return false;
  const readArgs = args as { path?: unknown; file_path?: unknown };
  const path = readArgs.file_path ?? readArgs.path;
  return typeof path === "string" && /(?:^|[\\/])SKILL\.md$/u.test(path);
}

function textOutput(result: ToolResult | undefined) {
  return result?.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!)
    .join("\n") ?? "";
}

/** Shared guard for the compact summaries: settled, non-partial, non-error, text-only. */
function withSettledResult(
  self: ToolInternals,
  compute: (output: string, details: Record<string, any> | undefined) => string | undefined,
) {
  const result = self.result;
  if (!result || self.isPartial || result.isError) return undefined;
  if (result.content.some((block) => block.type === "image")) return undefined;
  return compute(textOutput(result), result.details as Record<string, any> | undefined);
}

function grepSummary(self: ToolInternals) {
  return withSettledResult(self, (output, details) => {
    if (/^No matches found\s*$/u.test(output)) return "no matches";
    const count = countGrepMatches(output, Number(self.args?.context) || undefined);
    if (details?.matchLimitReached) return `${details.matchLimitReached}+ matches`;
    if (details?.truncation?.truncated) return `${count}+ matches`;
    return plural(count, "match", "matches");
  });
}

function findSummary(self: ToolInternals) {
  return withSettledResult(self, (output, details) => {
    if (/^No files found matching pattern\s*$/u.test(output)) return "no files";
    const count = countSearchRows(output);
    if (details?.resultLimitReached) return `${details.resultLimitReached}+ files`;
    if (details?.truncation?.truncated) return `${count}+ files`;
    return plural(count, "file");
  });
}

function lsSummary(self: ToolInternals) {
  return withSettledResult(self, (output, details) => {
    if (/^\(empty directory\)\s*$/u.test(output)) return "empty";
    const count = countSearchRows(output);
    if (details?.entryLimitReached) return `${details.entryLimitReached}+ entries`;
    if (details?.truncation?.truncated) return `${count}+ entries`;
    return plural(count, "entry", "entries");
  });
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

function removeOneLeadingColumn(line: string) {
  return /^\s/u.test(stripAnsi(line))
    ? sliceByColumn(line, 1, visibleWidth(line), true)
    : line;
}

function stripEditBox(component: Component | undefined, theme: Theme, width: number) {
  if (!component) return [];
  let lines = cleanToolLines(component.render(width + 2), theme);
  if (lines.length >= 2) lines = lines.slice(1, -1);
  return lines.map((line) => {
    const lineWidth = visibleWidth(line);
    return lineWidth > 1 ? sliceByColumn(line, 1, Math.max(1, lineWidth - 1), true) : "";
  });
}

function bashComposeBody(ctx: BodyComposeContext) {
  const body = renderBashCommand(ctx.self.args, ctx.theme, ctx.width);
  const bashResultLines = removeBashTiming(ctx.resultLines);
  if (bashResultLines.length > 0) body.push("", ...bashResultLines);
  return body;
}

function writeComposeBody(ctx: BodyComposeContext) {
  const body: string[] = [];
  const blank = ctx.callLines.indexOf("");
  if (blank >= 0) body.push(...ordinaryTrim(ctx.callLines.slice(blank + 1)));
  if (ctx.resultLines.length > 0) body.push(...ctx.resultLines);
  return body;
}

/** Register display descriptors for the built-in tools. Safe to call repeatedly. */
const BUILTIN_DISPLAYS = new Map<string, ToolDisplayDescriptor>();

function installBuiltinToolDisplays() {
  const compact: ToolDisplayDescriptor = {
    cacheable: true,
    suppressResultWhenCollapsed: true,
    suppressCallBody: true,
    unwrappedCallHeader: true,
  };
  BUILTIN_DISPLAYS.set("read", {
    ...compact,
    forceCallCollapsed: true,
    isSkillRead: isSkillReadPath,
  });
  BUILTIN_DISPLAYS.set("grep", { ...compact, summary: grepSummary });
  BUILTIN_DISPLAYS.set("find", { ...compact, summary: findSummary });
  BUILTIN_DISPLAYS.set("ls", { ...compact, summary: lsSummary });
  BUILTIN_DISPLAYS.set("bash", {
    detailed: true,
    cacheable: true,
    forceHeaderTitle: "bash",
    summary: bashSummary,
    composeBody: bashComposeBody,
  });
  BUILTIN_DISPLAYS.set("write", {
    detailed: true,
    cacheable: true,
    summary: (self) => writeSummary(self.args),
    composeBody: writeComposeBody,
  });
  BUILTIN_DISPLAYS.set("edit", {
    detailed: true,
    cacheable: true,
    handleSelfShell: true,
    renderCallLines: stripEditBox,
    transformResultLines: (lines) => lines.map(removeOneLeadingColumn),
    summary: editSummary,
  });
}

installBuiltinToolDisplays();

/**
 * The built-in display descriptors. This table lives inside the chrome's own
 * module graph (pi loads extensions with moduleCache disabled, so module-level
 * state is only shared within one import graph).
 */
export function getBuiltinToolDisplays(): ReadonlyMap<string, ToolDisplayDescriptor> {
  return BUILTIN_DISPLAYS;
}
