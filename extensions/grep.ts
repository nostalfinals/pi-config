import {
  type ExtensionAPI,
  type Theme,
  DEFAULT_MAX_BYTES,
  formatSize,
  type GrepToolDetails,
  truncateHead,
  truncateLine,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Type } from "typebox";

const GREP_MAX_LINE_LENGTH = 500;
const DEFAULT_LIMIT = 100;

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  glob: Type.Optional(
    Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" }),
  ),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
  context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
  includeIgnored: Type.Optional(
    Type.Boolean({
      description:
        "Include files excluded by ignore rules such as .gitignore (default: false). Use when the target may be generated or intentionally untracked.",
    }),
  ),
});

type GrepParams = {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
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

function formatGrepCall(args: GrepParams | undefined, theme: Theme) {
  const pattern = str(args?.pattern);
  const rawPath = str(args?.path);
  const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
  const glob = str(args?.glob);
  const limit = args?.limit;
  const invalidArg = theme.fg("error", "[invalid arg]");
  let text =
    theme.fg("toolTitle", theme.bold("grep")) +
    " " +
    (pattern === null ? invalidArg : theme.fg("accent", `/${pattern || ""}/`)) +
    theme.fg("accent", ` in ${path === null ? invalidArg : path}`);
  if (glob) text += theme.fg("accent", ` (${glob})`);
  if (limit !== undefined) text += theme.fg("accent", ` limit ${limit}`);
  return text;
}

function renderGrepCall(args: GrepParams | undefined, theme: Theme, context: { lastComponent?: Component }) {
  const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  text.setText(formatGrepCall(args, theme));
  return text;
}

export default function grepIncludeIgnoredExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "grep",
    label: "grep",
    description: "Search file contents for a pattern.",
    parameters: grepSchema,
    renderCall: renderGrepCall,

    async execute(_toolCallId, params: GrepParams, signal, _onUpdate, ctx) {
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
          const {
            pattern,
            path: searchDir,
            glob,
            ignoreCase,
            literal,
            context,
            limit,
            includeIgnored,
          } = params;

          try {
            const searchPath = path.resolve(ctx.cwd, searchDir || ".");
            let isDirectory: boolean;
            try {
              isDirectory = (await stat(searchPath)).isDirectory();
            } catch {
              settle(() => reject(new Error(`Path not found: ${searchPath}`)));
              return;
            }

            const contextValue = context && context > 0 ? context : 0;
            const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

            const formatPath = (filePath: string) => {
              if (isDirectory) {
                const relative = path.relative(searchPath, filePath);
                if (relative && !relative.startsWith("..")) {
                  return relative.replace(/\\/g, "/");
                }
              }
              return path.basename(filePath);
            };

            const fileCache = new Map<string, string[]>();
            const getFileLines = async (filePath: string) => {
              let lines = fileCache.get(filePath);
              if (!lines) {
                try {
                  const content = await readFile(filePath, "utf-8");
                  lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
                } catch {
                  lines = [];
                }
                fileCache.set(filePath, lines);
              }
              return lines;
            };

            const args = ["--json", "--line-number", "--color=never", "--hidden"];
            if (ignoreCase) args.push("--ignore-case");
            if (literal) args.push("--fixed-strings");
            if (glob) args.push("--glob", glob);
            if (includeIgnored) args.push("--no-ignore");
            args.push("--", pattern, searchPath);

            const child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
            const rl = createInterface({ input: child.stdout });
            let stderr = "";
            let matchCount = 0;
            let matchLimitReached = false;
            let linesTruncated = false;
            let aborted = false;
            let killedDueToLimit = false;
            const outputLines: string[] = [];

            const cleanup = () => {
              rl.close();
              signal?.removeEventListener("abort", onAbort);
            };
            const stopChild = (dueToLimit = false) => {
              if (!child.killed) {
                killedDueToLimit = dueToLimit;
                child.kill();
              }
            };
            const onAbort = () => {
              aborted = true;
              stopChild();
            };
            signal?.addEventListener("abort", onAbort, { once: true });

            child.stderr?.on("data", (chunk) => {
              stderr += chunk.toString();
            });

            const formatBlock = async (filePath: string, lineNumber: number) => {
              const relativePath = formatPath(filePath);
              const lines = await getFileLines(filePath);
              if (!lines.length) return [`${relativePath}:${lineNumber}: (unable to read file)`];
              const block: string[] = [];
              const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
              const end = contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;
              for (let current = start; current <= end; current++) {
                const lineText = lines[current - 1] ?? "";
                const sanitized = lineText.replace(/\r/g, "");
                const isMatchLine = current === lineNumber;
                const { text: truncatedText, wasTruncated } = truncateLine(sanitized, GREP_MAX_LINE_LENGTH);
                if (wasTruncated) linesTruncated = true;
                if (isMatchLine) block.push(`${relativePath}:${current}: ${truncatedText}`);
                else block.push(`${relativePath}-${current}- ${truncatedText}`);
              }
              return block;
            };

            const matches: Array<{ filePath: string; lineNumber: number; lineText?: string }> = [];
            rl.on("line", (line) => {
              if (!line.trim() || matchCount >= effectiveLimit) return;
              let event: any;
              try {
                event = JSON.parse(line);
              } catch {
                return;
              }
              if (event.type === "match") {
                matchCount++;
                const filePath = event.data?.path?.text;
                const lineNumber = event.data?.line_number;
                const lineText = event.data?.lines?.text;
                if (filePath && typeof lineNumber === "number") matches.push({ filePath, lineNumber, lineText });
                if (matchCount >= effectiveLimit) {
                  matchLimitReached = true;
                  stopChild(true);
                }
              }
            });

            child.on("error", (error) => {
              cleanup();
              const hint =
                (error as NodeJS.ErrnoException).code === "ENOENT"
                  ? " (ripgrep not found on PATH; install it, e.g. `cargo install ripgrep` or `apt install ripgrep`)"
                  : "";
              settle(() => reject(new Error(`Failed to run ripgrep: ${error.message}${hint}`)));
            });

            child.on("close", async (code) => {
              cleanup();
              if (aborted) {
                settle(() => reject(new Error("Operation aborted")));
                return;
              }
              if (!killedDueToLimit && code !== 0 && code !== 1) {
                const errorMsg = stderr.trim() || `ripgrep exited with code ${code}`;
                settle(() => reject(new Error(errorMsg)));
                return;
              }
              if (matchCount === 0) {
                settle(() => resolve({ content: [{ type: "text", text: "No matches found" }], details: undefined }));
                return;
              }

              for (const match of matches) {
                if (contextValue === 0 && match.lineText !== undefined) {
                  const relativePath = formatPath(match.filePath);
                  const sanitized = match.lineText
                    .replace(/\r\n/g, "\n")
                    .replace(/\r/g, "")
                    .replace(/\n$/, "");
                  const { text: truncatedText, wasTruncated } = truncateLine(sanitized, GREP_MAX_LINE_LENGTH);
                  if (wasTruncated) linesTruncated = true;
                  outputLines.push(`${relativePath}:${match.lineNumber}: ${truncatedText}`);
                } else {
                  const block = await formatBlock(match.filePath, match.lineNumber);
                  outputLines.push(...block);
                }
              }

              const rawOutput = outputLines.join("\n");
              const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
              let output = truncation.content;
              const details: GrepToolDetails = {};

              const notices: string[] = [];
              if (matchLimitReached) {
                notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`);
                details.matchLimitReached = effectiveLimit;
              }
              if (truncation.truncated) {
                notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
                details.truncation = truncation;
              }
              if (linesTruncated) {
                notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
                details.linesTruncated = true;
              }
              if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

              settle(() =>
                resolve({
                  content: [{ type: "text", text: output }],
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
