import { Type } from "typebox";
import type { Static } from "typebox";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import type { BodyComposeContext, ToolDisplayDescriptor } from "./ui/transcript/tool-display";

const BASE_URL = "https://context7.com/api";

const ResolveLibraryIdParams = Type.Object({
  query: Type.String({
    minLength: 1,
    description:
      "The task or documentation need, used to rank matching library candidates by relevance.",
  }),
  libraryName: Type.String({
    minLength: 1,
    description:
      "Library, package, or product name to resolve, such as Next.js, React, or Prisma.",
  }),
});

type ResolveLibraryIdParams = Static<typeof ResolveLibraryIdParams>;

const QueryDocsParams = Type.Object({
  libraryId: Type.String({
    minLength: 1,
    description:
      "Exact Context7 library ID, such as /vercel/next.js. " +
      "If not already known, obtain it with resolve_library_id first.",
  }),
  query: Type.String({
    minLength: 1,
    description:
      "Documentation question or topic to retrieve from the selected library. " +
      "Include the specific API, behavior, or integration detail needed by the task.",
  }),
});

type QueryDocsParams = Static<typeof QueryDocsParams>;

interface SearchResult {
  id: string;
  title: string;
  description: string;
  totalSnippets?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
  source?: string;
}

interface SearchResponse {
  results?: SearchResult[];
  error?: string;
  searchFilterApplied?: boolean;
}

/** Structured summary of a resolve_library_id call, for the tool display. */
interface ResolveLibraryDetails {
  total: number;
  results: Array<{
    id: string;
    title: string;
    totalSnippets?: number;
    trustScore?: number;
  }>;
  searchFilterApplied: boolean;
}

const resolveLibraryIdTool: ToolDefinition<typeof ResolveLibraryIdParams, ResolveLibraryDetails> & {
  display: ToolDisplayDescriptor;
} = {
  name: "resolve_library_id",
  label: "Resolve Context7 Library ID",
  description: `Resolve a library or product name to a Context7 library ID.`,
  parameters: ResolveLibraryIdParams,
  display: {
    cacheable: true,
    suppressResultWhenCollapsed: true,
    unwrappedCallHeader: true,
    composeBody: renderResolveBody,
  },
  renderCall: (args, theme) => renderResolveCall(args, theme),
  async execute(_toolCallId, params, signal) {
    const url = new URL(`${BASE_URL}/v2/libs/search`);
    url.searchParams.set("query", params.query);
    url.searchParams.set("libraryName", params.libraryName);

    const response = await fetch(url, {
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) return textResult(await errorMessage(response));

    const payload = (await response.json()) as SearchResponse;
    if (!payload.results || payload.results.length === 0) {
      return textResult(payload.error ?? "No libraries found matching the provided name.");
    }

    const note = payload.searchFilterApplied
      ? "**Note:** Results are filtered by the Context7 teamspace policies.\n\n"
      : "";
    const libraries = payload.results.map(formatSearchResult).join("\n----------\n");
    return {
      content: [{ type: "text", text: `Available Libraries:\n\n${note}${libraries}` }],
      details: {
        total: payload.results.length,
        results: payload.results.map((result) => ({
          id: result.id,
          title: result.title,
          totalSnippets: result.totalSnippets,
          trustScore: result.trustScore,
        })),
        searchFilterApplied: payload.searchFilterApplied ?? false,
      },
    };
  },
};

const queryDocsTool: ToolDefinition<typeof QueryDocsParams, undefined> & {
  display: ToolDisplayDescriptor;
} = {
  name: "query_docs",
  label: "Query Documentation",
  description: `"Retrieve documentation and code examples from Context7.`,
  parameters: QueryDocsParams,
  display: {
    cacheable: true,
    suppressResultWhenCollapsed: true,
    unwrappedCallHeader: true,
  },
  renderCall: (args, theme) => renderQueryDocsCall(args, theme),
  async execute(_toolCallId, params, signal) {
    const url = new URL(`${BASE_URL}/v2/context`);
    url.searchParams.set("query", params.query);
    url.searchParams.set("libraryId", params.libraryId);

    const response = await fetch(url, {
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) return textResult(await errorMessage(response));

    const text = await response.text();
    return textResult(
      text ||
      "Documentation not found. Check the Context7-compatible library ID and try again.",
    );
  },
};

export default function context7Extension(pi: ExtensionAPI) {
  pi.registerTool(resolveLibraryIdTool);
  pi.registerTool(queryDocsTool);
}

function renderResolveCall(args: ResolveLibraryIdParams, theme: Theme): Component {
  const title = theme.fg("toolTitle", theme.bold("resolve_library_id"));
  const tree = renderResolveTree(args, theme);
  const text = `${title}${tree ? `\n${tree}` : ""}`;
  return new Text(text, 0, 0);
}

function renderResolveTree(args: ResolveLibraryIdParams, theme: Theme): string {
  const parts: string[] = [];
  const libraryName = formatInline(args.libraryName, 110);
  if (libraryName) parts.push(`library: ${libraryName}`);
  const query = formatInline(args.query, 110);
  if (query) parts.push(`query: ${query}`);
  return renderTree(theme, parts);
}

function renderQueryDocsCall(args: QueryDocsParams, theme: Theme): Component {
  const title = theme.fg("toolTitle", theme.bold("query_docs"));
  const tree = renderQueryDocsTree(args, theme);
  const text = `${title}${tree ? `\n${tree}` : ""}`;
  return new Text(text, 0, 0);
}

function renderQueryDocsTree(args: QueryDocsParams, theme: Theme): string {
  const parts: string[] = [];
  const libraryId = formatInline(args.libraryId, 110);
  if (libraryId) parts.push(`library: ${libraryId}`);
  const query = formatInline(args.query, 110);
  if (query) parts.push(`query: ${query}`);
  return renderTree(theme, parts);
}

function renderTree(theme: Theme, parts: string[]): string {
  return parts
    .map((part, index) => {
      const branch = index === parts.length - 1 ? "└" : "├";
      return theme.fg("accent", `${branch} ${part}`);
    })
    .join("\n");
}

function renderResolveBody({ self, callLines, resultLines, theme }: BodyComposeContext): string[] {
  const body = callLines.slice(1);
  if (self.result && !self.result.isError) {
    const summary = formatResolveSummary(
      self.result.details as ResolveLibraryDetails | undefined,
      theme,
    );
    if (summary) body.push(summary);
  }
  body.push(...resultLines);
  return body;
}

function formatResolveSummary(
  details: ResolveLibraryDetails | undefined,
  theme: Theme,
): string | undefined {
  const results = details?.results;
  if (!results || results.length === 0) return undefined;
  const text = results.length === 1
    ? `1 library · ${results[0].id}`
    : `${results.length} libraries`;
  return theme.fg("muted", text);
}

function formatInline(value: unknown, maxLength = 110): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * Header summary for resolve_library_id: library count; the single hit
 * also shows its ID. Pending calls get no summary.
 */
function authHeaders(): Record<string, string> {
  const apiKey = process.env.CONTEXT7_API_KEY;
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload.message) return payload.message;
  } catch {
    // Fall through to status-specific messages.
  }

  if (response.status === 401) {
    return "Invalid Context7 API key. Check CONTEXT7_API_KEY.";
  }
  if (response.status === 404) {
    return "The requested Context7 library does not exist. Check the library ID.";
  }
  if (response.status === 429) {
    return "Context7 rate limit or quota exceeded.";
  }
  return `Context7 request failed with status ${response.status}.`;
}

function formatSearchResult(result: SearchResult): string {
  const lines = [
    `- Title: ${result.title}`,
    `- Context7-compatible library ID: ${result.id}`,
    `- Description: ${result.description}`,
  ];

  if (result.totalSnippets !== undefined && result.totalSnippets >= 0) {
    lines.push(`- Code Snippets: ${result.totalSnippets}`);
  }
  if (result.trustScore !== undefined) {
    lines.push(`- Source Reputation: ${reputation(result.trustScore)}`);
  }
  if (result.benchmarkScore !== undefined && result.benchmarkScore > 0) {
    lines.push(`- Benchmark Score: ${result.benchmarkScore}`);
  }
  if (result.versions && result.versions.length > 0) {
    lines.push(`- Versions: ${result.versions.join(", ")}`);
  }
  if (result.source) lines.push(`- Source: ${result.source}`);
  return lines.join("\n");
}

function reputation(score: number): string {
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: undefined,
  };
}
