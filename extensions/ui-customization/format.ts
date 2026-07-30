import { homedir } from "node:os";
import { relative } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function formatTokens(tokens: number) {
  const normalizedTokens = Math.max(0, tokens);
  if (normalizedTokens < 1_000_000) {
    return `${(normalizedTokens / 1_000).toFixed(1)}k`;
  }
  return `${(normalizedTokens / 1_000_000).toFixed(1)}m`;
}

export function formatDirectory(cwd: string) {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

export function columns(left: string, right: string, width: number) {
  if (!right) return truncateToWidth(left, width);

  const naturalGap = width - visibleWidth(left) - visibleWidth(right);
  if (naturalGap >= 1) return `${left}${" ".repeat(naturalGap)}${right}`;

  const leftWidth = Math.max(1, Math.floor(width * 0.45));
  const rightWidth = Math.max(1, width - leftWidth - 1);
  const fittedLeft = truncateToWidth(left, leftWidth);
  const fittedRight = truncateToWidth(right, rightWidth);
  const gap = Math.max(
    1,
    width - visibleWidth(fittedLeft) - visibleWidth(fittedRight),
  );
  return truncateToWidth(`${fittedLeft}${" ".repeat(gap)}${fittedRight}`, width);
}
