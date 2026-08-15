import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { keyText } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { BodyComposeContext } from "./ui/transcript/tool-display";

const ghGrepToolSchema = Type.Object({
  pattern: Type.String({
    description: "Code pattern to search for. Use text that would appear in repository files rather than natural-language keywords or questions."
  }),
  useRegexp: Type.Optional(
    Type.Boolean({
      description:
        "Treat the pattern as a regular expression. Use (?s) when `.` should also match newlines.",
      default: false,
    }),
  ),
  matchCase: Type.Optional(
    Type.Boolean({ description: "Match letter case exactly.", default: false }),
  ),
  matchWholeWords: Type.Optional(
    Type.Boolean({ description: "Match whole words only.", default: false }),
  ),
  language: Type.Optional(
    Type.Array(
      Type.String({
        description:
          "Restrict results to these programming languages, such as TypeScript, Kotlin, or Python.",
      }),
    ),
  ),
  repo: Type.Optional(
    Type.String({
      description: "Restrict results to a repository or owner prefix, such as facebook/react or vercel/."
    }),
  ),
  path: Type.Optional(
    Type.String({
      description: "Restrict results to matching file paths or path fragments, such as src/components/ or /route.ts."
    }),
  ),
});

type GhGrepToolInput = Static<typeof ghGrepToolSchema>;

interface GrepAppParams {
  pattern: string;
  useRegexp?: boolean;
  matchCase?: boolean;
  matchWholeWords?: boolean;
  language?: string[];
  repo?: string;
  path?: string;
}

export interface GrepAppHit {
  repo: string;
  path: string;
  url: string;
  license: string;
  snippetCount: number;
}

export interface GrepAppResult {
  text: string;
  hits: GrepAppHit[];
  total: number;
}

const MAX_RESULTS = 10;

const ENDPOINT = "https://mcp.grep.app/";

let nextRequestId = 1;

interface McpTextContent {
  type: string;
  text: string;
}

interface McpJsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: { content?: McpTextContent[]; isError?: boolean };
  error?: { code: number; message: string };
}

function parseSse(raw: string): McpJsonRpcResponse[] {
  const messages: McpJsonRpcResponse[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      messages.push(JSON.parse(data) as McpJsonRpcResponse);
    } catch {}
  }
  return messages;
}

const BLOCK_FIELD_RE = /^(Repository|Path|URL|License): (.+)$/gm;

function parseBlock(text: string): GrepAppHit | undefined {
  const fields = new Map<string, string>();
  for (const m of text.matchAll(BLOCK_FIELD_RE)) {
    fields.set(m[1], m[2]);
  }
  const repo = fields.get("Repository");
  const path = fields.get("Path");
  if (!repo && !path) return undefined;
  let snippetCount = 0;
  for (const _m of text.matchAll(/--- Snippet \d+ \(Line \d+\) ---/g)) snippetCount++;

  return {
    repo: repo ?? "",
    path: path ?? "",
    url: fields.get("URL") ?? "",
    license: fields.get("License") ?? "",
    snippetCount,
  };
}

export function describeFilters(params: GrepAppParams): string {
  const parts: string[] = [];
  if (params.language?.length) parts.push(`language: ${params.language.join(", ")}`);
  if (params.repo) parts.push(`repo: ${params.repo}`);
  if (params.path) parts.push(`path: ${params.path}`);
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}

export async function searchGrepApp(
  params: GrepAppParams,
  signal?: AbortSignal,
): Promise<GrepAppResult> {
  const args: Record<string, unknown> = { query: params.pattern };
  if (params.useRegexp) args.useRegexp = true;
  if (params.matchCase) args.matchCase = true;
  if (params.matchWholeWords) args.matchWholeWords = true;
  if (params.language && params.language.length > 0) args.language = params.language;
  if (params.repo) args.repo = params.repo;
  if (params.path) args.path = params.path;

  const payload = {
    jsonrpc: "2.0",
    id: nextRequestId++,
    method: "tools/call",
    params: { name: "searchGitHub", arguments: args },
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }

    if (!response.ok) {
      lastError = new Error(`grep.app request failed (HTTP ${response.status})`);
      continue;
    }

    const raw = await response.text();
    const messages = parseSse(raw);

    const content = messages
      .filter((m) => m.result?.content)
      .flatMap((m) => m.result!.content!)
      .filter((c) => c.type === "text" && c.text.trim().length > 0)
      .map((c) => c.text);

    if (content.length > 0) {
      const noResults =
        content.length === 1 &&
        /^no results found/i.test(content[0].trim());

      const blocks = noResults ? content : content.slice(0, MAX_RESULTS);
      const total = content.length;

      let text: string;
      if (noResults) {
        text = `grep.app: no results for "${params.pattern}" ${describeFilters(params)}.`;
      } else {
        const header = `grep.app: ${total} result${total === 1 ? "" : "s"} for "${params.pattern}" ${describeFilters(params)}`;
        text = [header, "", ...blocks].join("\n");
        if (blocks.length < total) {
          text += `\n\n(${total - blocks.length} more results omitted; narrow the query or add filters)`;
        }
      }

      const hits = blocks
        .map(parseBlock)
        .filter((h): h is GrepAppHit => h !== undefined);

      return { text, hits, total };
    }

    const errorMessage = messages
      .map((m) => m.error?.message)
      .filter((m): m is string => Boolean(m))
      .join("; ");
    lastError = new Error(errorMessage || "Unexpected response from grep.app");
  }

  throw lastError ?? new Error("grep.app request failed");
}

export default function ghGrepExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "gh_grep",
    label: "grep.app",
    description: "Search public GitHub code for real-world usage patterns.",
    parameters: ghGrepToolSchema,
    display: {
      cacheable: true,
      suppressResultWhenCollapsed: true,
      unwrappedCallHeader: true,
      composeBody: renderGrepBody,
    },
    renderCall: (args, theme) => renderGrepCall(args, theme),
    renderResult: (result, options, theme, context) =>
      renderGrepResult(result, options, theme, context),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const result = await searchGrepApp(params, signal ?? undefined);
      return {
        content: [{ type: "text", text: result.text }],
        details: {
          total: result.total,
          hits: result.hits,
          pattern: params.pattern,
          filters: {
            language: params.language,
            repo: params.repo,
            path: params.path,
            useRegexp: params.useRegexp,
            matchCase: params.matchCase,
            matchWholeWords: params.matchWholeWords,
          },
        },
      };
    },
  });
}

function formatGrepSummary(
  details: { total?: number; hits?: GrepAppHit[] } | undefined,
): string | undefined {
  const hits = details?.hits;
  if (!hits || hits.length === 0) return "no results";

  const repos = new Set(hits.map((hit) => hit.repo).filter(Boolean)).size;
  const total = typeof details?.total === "number" ? details.total : hits.length;
  const count = hits.length < total
    ? `${total}+ results`
    : `${total} ${total === 1 ? "result" : "results"}`;
  return repos > 1 ? `${count} · ${repos} repos` : count;
}

function renderGrepBody({ self, callLines, resultLines, theme }: BodyComposeContext): string[] {
  const body = callLines.slice(1);
  if (self.result && !self.result.isError) {
    const summary = formatGrepSummary(
      self.result.details as { total?: number; hits?: GrepAppHit[] } | undefined,
    );
    if (summary) body.push(theme.fg("muted", summary));
  }
  body.push(...resultLines);
  return body;
}

const PREVIEW_LINES = 5;

type ResultRenderOptions = {
  expanded: boolean;
  isPartial: boolean;
};

function renderGrepCall(args: GrepAppParams, theme: Theme): Component {
  const pattern = formatInline(args.pattern, 110);
  const title = theme.fg("toolTitle", theme.bold("gh_grep"));
  const callLabel = pattern ? ` ${theme.fg("accent", `"${pattern}"`)}` : "";
  const tree = renderFilterTree(args, theme);
  const text = `${title}${callLabel}${tree ? `\n${tree}` : ""}`;
  return new Text(text, 0, 0);
}

function renderFilterTree(args: GrepAppParams, theme: Theme): string {
  const parts: string[] = [];
  if (args.language?.length) parts.push(`language: ${args.language.join(", ")}`);
  if (args.repo) parts.push(`repo: ${args.repo}`);
  if (args.path) parts.push(`path: ${args.path}`);
  return parts
    .map((part, index) => {
      const branch = index === parts.length - 1 ? "└" : "├";
      return theme.fg("accent", `${branch} ${part}`);
    })
    .join("\n");
}

function formatInline(value: unknown, maxLength = 110): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

class GrepResultComponent implements Component {
  private text = "";
  private expanded = false;
  private isPartial = false;
  private isError = false;
  private theme: Theme;

  constructor(theme: Theme) {
    this.theme = theme;
  }

  setResult(
    text: string,
    options: ResultRenderOptions,
    theme: Theme,
    isError: boolean,
  ) {
    this.text = text;
    this.theme = theme;
    this.expanded = options.expanded;
    this.isPartial = options.isPartial;
    this.isError = isError;
  }

  render(width: number): string[] {
    const output = new Text(this.theme.fg("toolOutput", this.text), 0, 0).render(width);
    if (
      this.expanded ||
      this.isPartial ||
      this.isError ||
      output.length <= PREVIEW_LINES
    ) {
      return output.length > 0 ? ["", ...output] : output;
    }

    const hiddenLines = output.length - PREVIEW_LINES;
    const hint =
      this.theme.fg("muted", `... (${hiddenLines} more lines, `) +
      this.theme.fg("dim", keyText("app.tools.expand")) +
      this.theme.fg("muted", " to expand)");
    return [
      "",
      ...output.slice(0, PREVIEW_LINES),
      truncateToWidth(hint, width, "..."),
    ];
  }

  invalidate(): void {}
}

function renderGrepResult(
  result: { content: Array<{ type: string; text?: string }> },
  options: ResultRenderOptions,
  theme: Theme,
  context: { isError: boolean; lastComponent?: Component },
): Component {
  const text = result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!)
    .join("\n");

  const component =
    context.lastComponent instanceof GrepResultComponent
      ? context.lastComponent
      : new GrepResultComponent(theme);
  component.setResult(text, options, theme, context.isError);
  return component;
}
