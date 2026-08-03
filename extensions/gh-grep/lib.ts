/**
 * Transport + formatting for the grep.app code search tool.
 *
 * Talks directly to grep.app's official programmatic endpoint
 * (https://mcp.grep.app/, streamable HTTP JSON-RPC). This is a plain HTTP
 * call — no MCP client, no adapter, no mcp.json involvement.
 *
 * Why not the REST API (https://grep.app/api/search)? It sits behind
 * Vercel's security checkpoint, which blocks non-browser HTTP clients
 * (curl and Node's fetch both get challenge/429 responses from many
 * networks, while a browser or a Python client sometimes gets through).
 * The streamable endpoint is built by Vercel specifically for
 * programmatic access and accepts plain HTTP requests.
 */

export interface GrepAppParams {
  /** Literal code pattern to search for (e.g. "useState(", "import x from"). */
  query: string;
  /** Interpret query as a regular expression. */
  useRegexp?: boolean;
  /** Case-sensitive matching. */
  matchCase?: boolean;
  /** Match whole words only. */
  matchWholeWords?: boolean;
  /** Filter by programming language, e.g. ["TypeScript", "TSX"]. */
  language?: string[];
  /** Filter by repository, e.g. "facebook/react" (partial names like "vercel/" work). */
  repo?: string;
  /** Filter by file path, e.g. "src/components/Button.tsx" (partial paths work). */
  path?: string;
  /** Max number of result blocks to return. */
  limit?: number;
}

export interface GrepAppHit {
  repo: string;
  path: string;
  url: string;
  license: string;
  snippetCount: number;
}

export interface GrepAppResult {
  /** One block of formatted text per hit, ready for the LLM. */
  text: string;
  /** Parsed metadata for each hit (best effort). */
  hits: GrepAppHit[];
  /** Raw number of hits returned by the server (before limit truncation). */
  total: number;
}

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

/** Parse a streamable-HTTP (SSE) response body into JSON-RPC messages. */
function parseSse(raw: string): McpJsonRpcResponse[] {
  const messages: McpJsonRpcResponse[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      messages.push(JSON.parse(data) as McpJsonRpcResponse);
    } catch {
      // Ignore non-JSON data lines.
    }
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
  if (params.useRegexp) parts.push("regexp");
  if (params.matchCase) parts.push("case-sensitive");
  if (params.matchWholeWords) parts.push("whole words");
  return parts.length > 0 ? `(${parts.join(", ")})` : "";
}

/**
 * Run a grep.app code search. Throws on transport/protocol errors.
 */
export async function searchGrepApp(
  params: GrepAppParams,
  signal?: AbortSignal,
): Promise<GrepAppResult> {
  const args: Record<string, unknown> = { query: params.query };
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

  // One retry for transient failures (cold starts, 5xx, network blips).
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

      const blocks = noResults ? content : content.slice(0, params.limit ?? 10);
      const total = content.length;

      let text: string;
      if (noResults) {
        text = `grep.app: no results for "${params.query}" ${describeFilters(params)}.`;
      } else {
        const header = `grep.app: ${total} result${total === 1 ? "" : "s"} for "${params.query}" ${describeFilters(params)}`;
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
