import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function formatTokens(tokens: number) {
  const normalizedTokens = Math.max(0, tokens);
  if (normalizedTokens < 1_000_000) {
    return `${(normalizedTokens / 1_000).toFixed(1)}k`;
  }
  return `${(normalizedTokens / 1_000_000).toFixed(1)}m`;
}

export function formatWorkspace(cwd: string) {
  const relativeToHome = relative(resolve(homedir()), resolve(cwd));
  const isInsideHome = relativeToHome === "" ||
    (relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}
