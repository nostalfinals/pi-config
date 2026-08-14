export type TranscriptToolKind = "compact" | "detailed";

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
