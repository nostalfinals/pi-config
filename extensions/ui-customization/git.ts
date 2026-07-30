import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GitInfo } from "./types";
import { emptyGitInfo } from "./types";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 3_000;

async function command(command: string, args: string[], cwd: string) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout.trimEnd();
  } catch {
    return null;
  }
}

type RefreshGitOptions = {
  ctx: ExtensionContext;
  force?: boolean;
  generation: number;
  getGeneration: () => number;
  getGitInfo: () => GitInfo;
  setGitInfo: (gitInfo: GitInfo) => void;
  requestRender: () => void;
};

export async function refreshGit({
  ctx,
  force = false,
  generation,
  getGeneration,
  getGitInfo,
  setGitInfo,
  requestRender,
}: RefreshGitOptions) {
  const inside = await command(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    ctx.cwd,
  );
  if (generation !== getGeneration()) return;
  if (inside !== "true") {
    setGitInfo(emptyGitInfo());
    requestRender();
    return;
  }

  const [branchOutput, headOutput, statusOutput] = await Promise.all([
    command("git", ["branch", "--show-current"], ctx.cwd),
    command("git", ["rev-parse", "--short", "HEAD"], ctx.cwd),
    command(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      ctx.cwd,
    ),
  ]);
  if (generation !== getGeneration()) return;

  const branchName = branchOutput?.trim() ?? "";
  const branch = branchName || (headOutput ? `detached@${headOutput.trim()}` : "detached");
  const changedFiles = statusOutput
    ? statusOutput.split("\n").filter(Boolean).length
    : 0;
  const previousGitInfo = getGitInfo();
  const branchChanged = branch !== previousGitInfo.branch;
  setGitInfo({
    branch,
    changedFiles,
    pullRequest: branchChanged ? null : previousGitInfo.pullRequest,
  });
  requestRender();

  if (branchName && (force || branchChanged)) {
    const prOutput = await command(
      "gh",
      ["pr", "view", branchName, "--json", "number,url,state"],
      ctx.cwd,
    );
    if (generation !== getGeneration()) return;
    try {
      const value = prOutput ? JSON.parse(prOutput) : null;
      setGitInfo({
        ...getGitInfo(),
        pullRequest:
          value?.state === "OPEN" &&
          typeof value.number === "number" &&
          typeof value.url === "string"
            ? { number: value.number, url: value.url }
            : null,
      });
    } catch {
      setGitInfo({ ...getGitInfo(), pullRequest: null });
    }
    requestRender();
  }
}
