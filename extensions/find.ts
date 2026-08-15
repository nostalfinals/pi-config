import {
  type ExtensionAPI,
  type FindToolDetails,
  type Theme,
  DEFAULT_MAX_BYTES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { spawn, spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Type } from "typebox";

const DEFAULT_LIMIT = 1000;

const findSchema = Type.Object({
  pattern: Type.String({
    description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
  }),
  path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
  includeIgnored: Type.Optional(
    Type.Boolean({
      description:
        "Include files excluded by ignore rules such as .gitignore (default: false). Use when the target may be generated or intentionally untracked.",
    }),
  ),
});

type FindParams = {
  pattern: string;
  path?: string;
  limit?: number;
  includeIgnored?: boolean;
};

function str(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return null;
}

function shortenPath(value: string) {
  const home = homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

/** Relativize a find result against the search root and normalize it to posix separators. */
function relativizeFindResultPath(resultPath: string, searchPath: string): string {
  const hadTrailingSeparator =
    resultPath.endsWith(path.sep) || (path.sep === "\\" && resultPath.endsWith("/"));
  const relativePath = path.isAbsolute(resultPath) ? path.relative(searchPath, resultPath) : resultPath;
  const posixPath = relativePath.split(path.sep).join("/");
  return hadTrailingSeparator && !posixPath.endsWith("/") ? `${posixPath}/` : posixPath;
}

/**
 * Resolve the fd binary: system PATH first (fd, fdfind), then the agent bin
 * directory where pi downloads it (agentDir/bin, default ~/.pi/agent/bin).
 */
function resolveFdPath(cwd: string): string | null {
  const candidates = [
    "fd",
    "fdfind",
    path.join(cwd, "bin", "fd"),
    path.join(homedir(), ".pi", "agent", "bin", "fd"),
  ];
  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
      if (!result.error) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Walk up from searchPath to detect whether we're inside a git repo. */
async function insideGitRepo(searchPath: string): Promise<boolean> {
  for (let current = searchPath; ; ) {
    try {
      await stat(path.join(current, ".git"));
      return true;
    } catch {
      // not this level, keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function formatFindCall(args: FindParams | undefined, theme: Theme) {
  const pattern = str(args?.pattern);
  const rawPath = str(args?.path);
  const searchPath = rawPath !== null ? shortenPath(rawPath || ".") : null;
  const limit = args?.limit;
  const includeIgnored = args?.includeIgnored;
  const invalidArg = theme.fg("error", "[invalid arg]");
  let text =
    theme.fg("toolTitle", theme.bold("find")) +
    " " +
    (pattern === null ? invalidArg : theme.fg("accent", pattern || "")) +
    theme.fg("accent", ` in ${searchPath === null ? invalidArg : searchPath}`);
  if (includeIgnored) text += theme.fg("accent", " (no-ignore)");
  if (limit !== undefined) text += theme.fg("accent", ` limit ${limit}`);
  return text;
}

function renderFindCall(args: FindParams | undefined, theme: Theme, context: { lastComponent?: Component }) {
  const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  text.setText(formatFindCall(args, theme));
  return text;
}

export default function findIncludeIgnoredExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "find",
    label: "find",
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore unless includeIgnored is set. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    promptSnippet: "Find files by glob pattern (respects .gitignore)",
    parameters: findSchema,
    renderCall: renderFindCall,

    async execute(_toolCallId, params: FindParams, signal, _onUpdate, ctx) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }
        let settled = false;
        const settle = (fn: () => void) => {
          if (!settled) {
            settled = true;
            fn();
          }
        };

        (async () => {
          const { pattern, path: searchDir, limit, includeIgnored } = params;

          try {
            const searchPath = path.resolve(ctx.cwd, searchDir || ".");
            try {
              await stat(searchPath);
            } catch {
              settle(() => reject(new Error(`Path not found: ${searchPath}`)));
              return;
            }

            const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
            const fdPath = resolveFdPath(ctx.cwd);
            if (!fdPath) {
              settle(() =>
                reject(
                  new Error(
                    "fd is not available. Install it, e.g. `cargo install fd-find` or `apt install fd-find`",
                  ),
                ),
              );
              return;
            }

            const args = ["--glob", "--color=never", "--hidden"];
            if (includeIgnored) args.push("--no-ignore");
            // fd normally ignores .gitignore outside git repos, so keep --no-require-git
            // there. Inside repos, use fd's default git-aware behavior so parent
            // .gitignore rules stop at nested repo boundaries.
            const gitRepo = await insideGitRepo(searchPath);
            if (!gitRepo) args.push("--no-require-git");
            args.push("--max-results", String(effectiveLimit));

            // fd --glob matches against the basename unless --full-path is set; in
            // --full-path mode it matches against the absolute candidate path, so a
            // path-containing pattern like 'src/**/*.spec.ts' needs a leading '**/'
            // to match anything.
            let effectivePattern = pattern;
            if (pattern.includes("/")) {
              args.push("--full-path");
              if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") {
                effectivePattern = `**/${pattern}`;
              }
              // fd matches full paths using native separators on Windows.
              if (process.platform === "win32") effectivePattern = effectivePattern.replaceAll("/", "[/\\]");
            }
            args.push("--", effectivePattern, searchPath);

            const child = spawn(fdPath, args, { stdio: ["ignore", "pipe", "pipe"] });
            const rl = createInterface({ input: child.stdout });
            let stderr = "";
            const lines: string[] = [];
            let aborted = false;
            const outputLines: string[] = [];

            const cleanup = () => {
              rl.close();
              signal?.removeEventListener("abort", onAbort);
            };
            const stopChild = () => {
              if (!child.killed) child.kill();
            };
            const onAbort = () => {
              aborted = true;
              stopChild();
            };
            signal?.addEventListener("abort", onAbort, { once: true });

            child.stderr?.on("data", (chunk) => {
              stderr += chunk.toString();
            });

            rl.on("line", (line) => {
              lines.push(line);
            });

            child.on("error", (error) => {
              cleanup();
              settle(() => reject(new Error(`Failed to run fd: ${error.message}`)));
            });

            child.on("close", () => {
              cleanup();
              if (aborted) {
                settle(() => reject(new Error("Operation aborted")));
                return;
              }
              const output = lines.join("\n");
              if (output) {
                for (const rawLine of lines) {
                  const line = rawLine.replace(/\r$/, "").trim();
                  if (!line) continue;
                  outputLines.push(relativizeFindResultPath(line, searchPath));
                }
              }
              if (outputLines.length === 0) {
                settle(() =>
                  resolve({ content: [{ type: "text", text: "No files found matching pattern" }], details: undefined }),
                );
                return;
              }

              const resultLimitReached = outputLines.length >= effectiveLimit;
              const rawOutput = outputLines.join("\n");
              const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
              let resultOutput = truncation.content;
              const details: FindToolDetails = {};

              const notices: string[] = [];
              if (resultLimitReached) {
                notices.push(`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`);
                details.resultLimitReached = effectiveLimit;
              }
              if (truncation.truncated) {
                notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
                details.truncation = truncation;
              }
              if (notices.length > 0) resultOutput += `\n\n[${notices.join(". ")}]`;

              settle(() =>
                resolve({
                  content: [{ type: "text", text: resultOutput }],
                  details: Object.keys(details).length > 0 ? details : undefined,
                }),
              );
            });
          } catch (err) {
            settle(() => reject(err));
          }
        })();
      });
    },
  });
}
