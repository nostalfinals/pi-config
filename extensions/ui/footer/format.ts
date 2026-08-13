import { homedir } from "node:os";
import { basename } from "node:path";

export function formatTokens(tokens: number) {
  const normalizedTokens = Math.max(0, tokens);
  if (normalizedTokens < 1_000_000) {
    return `${(normalizedTokens / 1_000).toFixed(1)}k`;
  }
  return `${(normalizedTokens / 1_000_000).toFixed(1)}m`;
}

export function formatWorkspace(cwd: string) {
  if (cwd === homedir()) return "~";
  return basename(cwd) || cwd;
}
