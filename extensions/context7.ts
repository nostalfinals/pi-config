import { Type } from "typebox";
import type { Static } from "typebox";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import type { ToolDisplayDescriptor, ToolInternals } from "./ui/transcript/tool-display";

const BASE_URL = "https://context7.com/api";

const ResolveLibraryIdParams = Type.Object({
  query: Type.String({
    minLength: 1,
    description:
      "What to look up in the library documentation. Keep this focused on one concept.",
  }),
  libraryName: Type.String({
    minLength: 1,
    description:
      "Official package or product name, such as Next.js, React, or Prisma.",
  }),
});

type ResolveLibraryIdParams = Static<typeof ResolveLibraryIdParams>;

const QueryDocsParams = Type.Object({
  libraryId: Type.String({
    minLength: 1,
    description: "Exact Context7-compatible library ID, such as /vercel/next.js.",
  }),
  query: Type.String({
    minLength: 1,
    description: "A focused documentation question about one specific concept.",
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
  description: `Resolves a package or product name to a Context7-compatible library ID and returns matching libraries.

Call resolve_library_id before query_docs unless the user already provides a library ID in /org/project or /org/project/version format. Prefer official, high-quality, and well-maintained results.`,
  parameters: ResolveLibraryIdParams,
  display: {
    cacheable: true,
    suppressResultWhenCollapsed: true,
    suppressCallBody: true,
    unwrappedCallHeader: true,
    summary: resolveSummary,
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
  description: `Retrieves up-to-date documentation and code examples from Context7.

Call resolve_library_id first to obtain the exact library ID unless the user already provides one. Keep each query focused on a single concept and do not include secrets, credentials, personal data, or proprietary code.`,
  parameters: QueryDocsParams,
  display: {
    cacheable: true,
    suppressResultWhenCollapsed: true,
    suppressCallBody: true,
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
  const text =
    theme.fg("toolTitle", theme.bold("resolve_library_id")) +
    ` ${theme.fg("accent", args.libraryName)}` +
    (args.query ? ` ${theme.fg("accent", `"${args.query}"`)}` : "");
  return new Text(text, 0, 0);
}

function renderQueryDocsCall(args: QueryDocsParams, theme: Theme): Component {
  const text =
    theme.fg("toolTitle", theme.bold("query_docs")) +
    ` ${theme.fg("accent", args.libraryId)}` +
    (args.query ? ` ${theme.fg("accent", `"${args.query}"`)}` : "");
  return new Text(text, 0, 0);
}

/**
 * Header summary for resolve_library_id: library count; the single hit
 * also shows its ID. Pending calls get no summary.
 */
function resolveSummary(self: ToolInternals): string | undefined {
  const result = self.result;
  if (!result || self.isPartial || result.isError) return undefined;
  const details = result.details as ResolveLibraryDetails | undefined;
  const results = details?.results;
  if (!results || results.length === 0) return undefined;
  if (results.length === 1) return `1 library · ${results[0].id}`;
  return `${results.length} libraries`;
}

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
