import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export type TranscriptToolKind = "compact" | "detailed";

const ANSI_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\))/gu;

export function stripAnsi(text: string) {
  return text.replace(ANSI_SEQUENCE, "");
}

export function ordinaryTrim(lines: string[]) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end);
}

export function trimRenderedLine(line: string) {
  const plain = stripAnsi(line);
  const trimmed = plain.replace(/\s+$/u, "");
  return trimmed.length === plain.length
    ? line
    : sliceByColumn(line, 0, visibleWidth(trimmed), true);
}

export function removeCardBackgrounds(lines: string[], theme: Theme) {
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

export function cleanToolLines(lines: string[], theme: Theme) {
  return removeCardBackgrounds(lines, theme).map(trimRenderedLine);
}

export function transcriptGap(
  previous: "tool" | "other" | undefined,
  previousKind: TranscriptToolKind | undefined,
  current: "tool" | "other",
  currentKind: TranscriptToolKind | undefined,
) {
  if (previous === undefined) return 0;
  if (
    previous === "tool" &&
    current === "tool" &&
    previousKind === "compact" &&
    currentKind === "compact"
  ) {
    return 0;
  }
  return 1;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function countTextLines(text: string) {
  if (text === "") return 0;
  return text.split("\n").length;
}

export function stripTrailingNotice(text: string) {
  const noticeStart = text.lastIndexOf("\n\n[");
  return noticeStart < 0 ? text : text.slice(0, noticeStart);
}

export function countSearchRows(text: string) {
  const body = stripTrailingNotice(text).trim();
  return body ? body.split("\n").filter(Boolean).length : 0;
}

export function countGrepMatches(text: string, context: number | undefined) {
  const body = stripTrailingNotice(text).trim();
  if (!body) return 0;
  const lines = body.split("\n");
  if (!context) return lines.filter(Boolean).length;
  return lines.filter((line) => /:\d+: /u.test(line)).length;
}

export function countEditDiff(diff: string | undefined) {
  let added = 0;
  let removed = 0;
  for (const line of diff?.split("\n") ?? []) {
    if (/^\+\s*\d+\s/u.test(line)) added += 1;
    else if (/^-\s*\d+\s/u.test(line)) removed += 1;
  }
  return { added, removed };
}
