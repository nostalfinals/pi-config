import { Type } from "@earendil-works/pi-ai";
import type { Static } from "@earendil-works/pi-ai";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { readFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { join } from "node:path";
import type { BodyComposeContext, ToolDisplayDescriptor } from "./ui/transcript/tool-display";

const CODEX_PROVIDER = "openai-codex";
const DEEPSEEK_PROVIDER = "deepseek";
const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/v1/tools/search";
const CONFIG_FILE = "web-search.json";
const MAX_QUERIES = 5;
const DEFAULT_DEEPSEEK_COUNT = 5;
const DEEPSEEK_RETRY_DELAY_MS = 1000;

const Params = Type.Object({
  queries: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    maxItems: MAX_QUERIES,
    description:
      "Search queries. Use distinct queries when multiple search angles are useful.",
  }),
});

type Params = Static<typeof Params>;

type Backend = "codex" | "deepseek";

interface Citation {
  title?: string;
  url: string;
}

interface BackendResult {
  text: string;
  citations: Citation[];
}

interface SearchResult extends BackendResult {
  query: string;
  backend: Backend;
}

interface SearchDetails {
  model: string;
  /** Total time from starting the request until all query results settle. */
  elapsedMs?: number;
  queries: string[];
  successes: number;
  failures: Array<{ query: string; message: string }>;
  sources: number;
  backends: Record<Backend, number>;
}

interface SearchConfig {
  codexModel: string;
  deepseekCount: number;
  deepseekNeedContent: boolean;
}

interface CodexAuth {
  token: string;
  accountId: string;
}

interface StoredCredential {
  type?: unknown;
  accountId?: unknown;
}

type StoredCredentialReader = (provider: string) => StoredCredential | undefined;

interface LegacyModelRegistry {
  authStorage?: {
    get(provider: string): StoredCredential | undefined;
  };
}

interface SseEvent {
  type: string;
  data?: unknown;
}

interface ResponseOutputText {
  type?: string;
  text?: string;
  annotations?: Array<{
    type?: string;
    title?: string;
    url?: string;
  }>;
}

interface ResponseOutputItem {
  type?: string;
  role?: string;
  content?: ResponseOutputText[];
}

interface ResponseEventData {
  delta?: string;
  item?: ResponseOutputItem;
  error?: { message?: string; code?: string };
}

interface DeepSeekEntry {
  title?: string;
  url: string;
  snippet?: string;
  summary?: string;
  content?: string;
  site_name?: string | null;
  date?: string | null;
}

interface DeepSeekResponse {
  results?: unknown;
}

/**
 * Process-lifetime fallback latch. Once Codex fails and we actually switch to
 * DeepSeek, later searches skip Codex until Pi restarts. Missing credentials,
 * missing DeepSeek config and user cancellation never set it.
 */
let codexFailure: string | undefined;

const cfCookies = new Map<string, string>();
const allowedCookieNames = new Set([
  "__cf_bm",
  "__cflb",
  "__cfruid",
  "__cfseq",
  "__cfwaitingroom",
  "_cfuvid",
  "cf_clearance",
  "cf_ob_info",
  "cf_use_ob",
]);

const webSearchTool: ToolDefinition<typeof Params, SearchDetails> & {
  display: ToolDisplayDescriptor;
} = {
  name: "web_search",
  label: "Web Search",
  description: "Search the web.",
  parameters: Params,
  display: {
    cacheable: true,
    suppressResultWhenCollapsed: true,
    // Multi-query calls render their query list as a tree in the call body.
    // The details line is composed below the tree as well.
    unwrappedCallHeader: true,
    composeBody: renderSearchBody,
  },
  renderCall: (args, theme) => {
    const queries = args.queries.map((query) => formatInline(query, 110));
    const title = theme.fg("toolTitle", theme.bold("web_search"));
    const callLabel =
      queries.length === 1
        ? queries[0]
          ? ` ${theme.fg("accent", `"${queries[0]}"`)}`
          : ""
        : queries.length > 1
          ? ` ${theme.fg("accent", `${queries.length} queries`)}`
          : "";
    const text = `${title}${callLabel}${queries.length > 1 ? `\n${renderQueryTree(queries, theme)}` : ""
      }`;
    return new Text(text, 0, 0);
  },
  renderResult: (result, _options, theme, context) => {
    const text = result.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
    const component = context.lastComponent ?? new Text("", 0, 0);
    if (component instanceof Text) component.setText(formatSearchResult(text, theme));
    return component;
  },

  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const startedAt = Date.now();
    const queries = params.queries.map((query) => query.trim()).filter(Boolean);
    const config = await loadConfig();
    const deepseekToken = await ctx.modelRegistry.getApiKeyForProvider(DEEPSEEK_PROVIDER);

    let codexProblem = codexFailure;
    let codex: CodexAuth | undefined;
    if (!codexProblem) {
      const token = await ctx.modelRegistry.getApiKeyForProvider(CODEX_PROVIDER);
      if (!token) {
        codexProblem = "OpenAI Codex is not logged in";
      } else {
        const accountId = resolveAccountId(token, ctx.modelRegistry);
        if (accountId) codex = { token, accountId };
        else codexProblem = "OpenAI Codex account id was not found; re-run /login openai-codex";
      }
    }

    if (!codex && !deepseekToken) {
      throw new Error(
        `Web search is unavailable: ${codexProblem ?? "no search backend is available"}, and no DeepSeek API key is configured (run /login deepseek or set DEEPSEEK_API_KEY).`,
      );
    }

    const settled = await Promise.allSettled(
      queries.map((query) =>
        runQuery({
          query,
          config,
          codex,
          codexProblem,
          deepseekToken,
          sessionId: ctx.sessionManager.getSessionId(),
          signal,
        }),
      ),
    );

    const successes: SearchResult[] = [];
    const failures: Array<{ query: string; message: string }> = [];

    settled.forEach((result, index) => {
      const query = queries[index] ?? "";
      if (result.status === "fulfilled") {
        successes.push(result.value);
      } else {
        failures.push({ query, message: errorMessage(result.reason) });
      }
    });

    if (successes.length === 0) {
      throw new Error(
        failures.map((failure) => `${failure.query}: ${failure.message}`).join("\n"),
      );
    }

    const blocks = [
      ...successes.map((result) => formatSuccess(result, queries.length > 1)),
      ...failures.map(
        (failure) =>
          `## Query: ${failure.query}\n\nFAILED: ${failure.message}`,
      ),
    ];

    const backends: Record<Backend, number> = { codex: 0, deepseek: 0 };
    for (const result of successes) backends[result.backend] += 1;

    return {
      content: [{ type: "text", text: blocks.join("\n\n") }],
      details: {
        model: config.codexModel,
        elapsedMs: Date.now() - startedAt,
        queries,
        successes: successes.length,
        failures,
        sources: successes.reduce((sum, result) => sum + result.citations.length, 0),
        backends,
      },
    };
  },
};

export default async function webSearchExtension(pi: ExtensionAPI) {
  await loadConfig();
  pi.registerTool(webSearchTool);
}

/**
 * Keep the header limited to the call parameters. The settled details use the
 * same body rail as the query tree.
 */
function renderSearchBody({ self, callLines, resultLines, theme }: BodyComposeContext): string[] {
  const body = callLines.slice(1);

  if (self.result && !self.result.isError) {
    const details = self.result.details as SearchDetails | undefined;
    if (details) body.push(formatSearchSummary(details, theme));
  }

  body.push(...resultLines);
  return body;
}

/**
 * Format the web_search result body: section headers, source lists and
 * failure markers get their own muted/error colors; everything else is plain
 * tool output (which the chrome turns red when the call errored).
 */
function formatSearchResult(text: string, theme: Theme): string {
  let inSources = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^#{2,3} /u.test(line)) {
        inSources = false;
        return theme.fg("muted", theme.bold(line));
      }
      if (line.startsWith("Sources:")) {
        inSources = true;
        return theme.fg("muted", line);
      }
      if (inSources && /^\d+\.\s/u.test(line)) return theme.fg("muted", line);
      if (line.startsWith("FAILED:")) return theme.fg("error", line);
      return theme.fg("toolOutput", line);
    })
    .join("\n");
}

async function loadConfig(): Promise<SearchConfig> {
  const configDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const configPath = join(configDir, CONFIG_FILE);

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${configPath}: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }

  const codex = parsed.codex;
  const model = isRecord(codex) && typeof codex.model === "string" ? codex.model.trim() : "";
  if (!model) {
    throw new Error(`${configPath} must contain a non-empty string field "codex.model".`);
  }

  const deepseek = parsed.deepseek;
  let count = DEFAULT_DEEPSEEK_COUNT;
  let needContent = false;

  if (deepseek !== undefined) {
    if (!isRecord(deepseek)) {
      throw new Error(`${configPath}: "deepseek" must be an object.`);
    }
    if (deepseek.count !== undefined) {
      if (
        typeof deepseek.count !== "number" ||
        !Number.isInteger(deepseek.count) ||
        deepseek.count < 1 ||
        deepseek.count > 50
      ) {
        throw new Error(`${configPath}: "deepseek.count" must be an integer between 1 and 50.`);
      }
      count = deepseek.count;
    }
    if (deepseek.needContent !== undefined) {
      if (typeof deepseek.needContent !== "boolean") {
        throw new Error(`${configPath}: "deepseek.needContent" must be a boolean.`);
      }
      needContent = deepseek.needContent;
    }
  }

  return { codexModel: model, deepseekCount: count, deepseekNeedContent: needContent };
}

async function runQuery(options: {
  query: string;
  config: SearchConfig;
  codex: CodexAuth | undefined;
  codexProblem: string | undefined;
  deepseekToken: string | undefined;
  sessionId: string;
  signal: AbortSignal | undefined;
}): Promise<SearchResult> {
  const { query, config, codex, deepseekToken, sessionId, signal } = options;
  let codexProblem = options.codexProblem;

  if (codex && !codexFailure) {
    try {
      const result = await runCodexSearch({
        query,
        model: config.codexModel,
        token: codex.token,
        accountId: codex.accountId,
        sessionId,
        signal,
      });
      return { query, backend: "codex", ...result };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!deepseekToken) throw new Error(`Codex: ${errorMessage(error)}`);
      codexProblem = errorMessage(error);
      codexFailure = codexProblem;
    }
  }

  if (!deepseekToken) {
    throw new Error(`Codex: ${codexProblem ?? "search is unavailable"}`);
  }

  try {
    const result = await runDeepSeekSearch({
      query,
      token: deepseekToken,
      count: config.deepseekCount,
      needContent: config.deepseekNeedContent,
      signal,
    });
    return { query, backend: "deepseek", ...result };
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      [
        codexProblem ? `Codex: ${codexProblem}` : "",
        `DeepSeek: ${errorMessage(error)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function runCodexSearch(options: {
  query: string;
  model: string;
  token: string;
  accountId: string;
  sessionId: string;
  signal: AbortSignal | undefined;
}): Promise<BackendResult> {
  const {
    query,
    model,
    token,
    accountId,
    sessionId,
    signal,
  } = options;
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "ChatGPT-Account-ID": accountId,
    originator: "codex_cli_rs",
    "User-Agent": `codex_cli_rs/0.143.0 (${process.platform} ${release()}; ${process.arch})`,
    accept: "text/event-stream",
    "content-type": "application/json",
    "session-id": sessionId,
    "thread-id": sessionId,
    "x-client-request-id": sessionId,
  });

  const webSearchTool: Record<string, unknown> = {
    type: "web_search",
    external_web_access: true,
    search_context_size: "high",
  };

  const response = await fetchCodex(CODEX_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: query }],
        },
      ],
      tools: [webSearchTool],
      tool_choice: "required",
      parallel_tool_calls: true,
      store: false,
      stream: true,
      include: [],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  if (!response.body) throw new Error("Response did not include a body.");

  let streamedText = "";
  const finalText: string[] = [];
  const citations = new Map<string, Citation>();

  for await (const event of parseSse(response.body)) {
    const data = event.data as ResponseEventData | undefined;
    if (!data) continue;

    if (event.type === "response.output_text.delta") {
      const delta = data.delta ?? "";
      streamedText += delta;
      continue;
    }

    if (event.type === "response.output_item.done") {
      const item = data.item;
      if (!item || item.type !== "message" || item.role !== "assistant") continue;
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        finalText.push(part.text ?? "");
        for (const annotation of part.annotations ?? []) {
          if (annotation.type !== "url_citation" || !annotation.url) continue;
          citations.set(annotation.url, {
            title: annotation.title,
            url: annotation.url,
          });
        }
      }
      continue;
    }

    if (event.type === "response.failed") {
      throw new Error(data.error?.message ?? data.error?.code ?? "Response failed.");
    }
  }

  return {
    text: finalText.join("") || streamedText || "(no response text)",
    citations: [...citations.values()],
  };
}

async function runDeepSeekSearch(options: {
  query: string;
  token: string;
  count: number;
  needContent: boolean;
  signal: AbortSignal | undefined;
}): Promise<BackendResult> {
  const response = await postDeepSeek(
    {
      query: options.query,
      count: options.count,
      need_content: options.needContent,
    },
    options.token,
    options.signal,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as DeepSeekResponse;
  if (!Array.isArray(payload.results)) {
    throw new Error("Unexpected response: missing results array.");
  }

  const results = payload.results.filter(isDeepSeekEntry);
  if (results.length === 0) {
    return { text: "No results.", citations: [] };
  }

  return {
    text: results
      .map((entry, index) => formatDeepSeekEntry(entry, index + 1, options.needContent))
      .join("\n\n"),
    citations: results.map((entry) => ({ title: entry.title, url: entry.url })),
  };
}

/**
 * DeepSeek limits Search to 5 requests per second per account. A single retry
 * covers parallel tool calls and other clients sharing the same key; every
 * other error is reported as-is.
 */
async function postDeepSeek(
  body: Record<string, unknown>,
  token: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const request = () =>
    fetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

  const response = await request();
  if (response.status !== 429) return response;

  await response.body?.cancel().catch(() => undefined);
  await delay(DEEPSEEK_RETRY_DELAY_MS, signal);
  return request();
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function formatDeepSeekEntry(
  entry: DeepSeekEntry,
  index: number,
  needContent: boolean,
): string {
  const title = nonEmpty(entry.title) ?? entry.url;
  const meta = [formatDate(entry.date), nonEmpty(entry.site_name)]
    .filter(Boolean)
    .join(" · ");
  const summary = nonEmpty(entry.summary) ?? nonEmpty(entry.snippet);
  const body = needContent ? nonEmpty(entry.content) : undefined;

  return [
    `### ${index}. ${title}`,
    entry.url,
    meta,
    summary,
    body,
  ]
    .filter(Boolean)
    .join("\n");
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let separator = findSeparator(buffer);
      while (separator) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        const event = parseFrame(frame);
        if (event) yield event;
        separator = findSeparator(buffer);
      }
    }
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  buffer += decoder.decode();
  const event = parseFrame(buffer);
  if (event) yield event;
}

function findSeparator(buffer: string): { index: number; length: number } | undefined {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match?.index === undefined
    ? undefined
    : { index: match.index, length: match[0].length };
}

function parseFrame(frame: string): SseEvent | undefined {
  let type = "";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return undefined;
  const raw = dataLines.join("\n");
  if (raw === "[DONE]") return undefined;

  try {
    const data = JSON.parse(raw) as { type?: string };
    return { type: type || data.type || "", data };
  } catch {
    return undefined;
  }
}

function renderQueryTree(queries: string[], theme: Theme): string {
  return queries
    .map((query, index) => {
      const branch = index === queries.length - 1 ? "└" : "├";
      return theme.fg("accent", `${branch} ${query}`);
    })
    .join("\n");
}

function formatInline(value: unknown, maxLength = 90): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatDuration(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

function formatSearchSummary(details: SearchDetails, theme: Theme): string {
  const total = details.queries.length;
  const searchCount = details.failures.length > 0
    ? `${details.successes}/${total} searches`
    : `${details.successes} ${details.successes === 1 ? "search" : "searches"}`;
  const parts = [searchCount];
  if (details.sources > 0) {
    parts.push(`${details.sources} ${details.sources === 1 ? "source" : "sources"}`);
  }
  if (details.backends.codex > 0) {
    parts.push(details.backends.deepseek > 0 ? "via Codex + DeepSeek" : "via Codex");
  } else if (details.backends.deepseek > 0) {
    parts.push("via DeepSeek");
  }
  if (details.elapsedMs !== undefined) parts.push(`took ${formatDuration(details.elapsedMs)}`);
  const role = details.failures.length > 0 ? "warning" : "muted";
  return theme.fg(role, parts.join(" · "));
}

function formatSuccess(result: SearchResult, multiple: boolean): string {
  const sources =
    result.backend === "codex" && result.citations.length > 0
      ? `Sources:\n${result.citations
        .map((citation, index) => `${index + 1}. ${citation.title || citation.url}: ${citation.url}`)
        .join("\n")}`
      : "";
  const body = [result.text, sources].filter(Boolean).join("\n\n");
  return multiple ? `## Query: ${result.query}\n\n${body}` : body;
}

function resolveAccountId(token: string, modelRegistry: object): string | undefined {
  const reader = (piCodingAgent as { readStoredCredential?: StoredCredentialReader })
    .readStoredCredential;
  const credential = reader
    ? reader(CODEX_PROVIDER)
    : (modelRegistry as LegacyModelRegistry).authStorage?.get(CODEX_PROVIDER);
  if (credential?.type === "oauth" && typeof credential.accountId === "string") {
    const accountId = credential.accountId.trim();
    if (accountId) return accountId;
  }

  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
    };
    const accountId = payload["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
  } catch {
    return undefined;
  }
}

async function fetchCodex(input: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cfCookies.size > 0) {
    headers.set(
      "cookie",
      [...cfCookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }

  const response = await fetch(input, { ...init, headers });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const setCookie of setCookies) {
    const firstPart = setCookie.split(";", 1)[0] ?? "";
    const separator = firstPart.indexOf("=");
    if (separator <= 0) continue;
    const name = firstPart.slice(0, separator).trim();
    if (!allowedCookieNames.has(name)) continue;
    cfCookies.set(name, firstPart.slice(separator + 1).trim());
  }
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDeepSeekEntry(value: unknown): value is DeepSeekEntry {
  return isRecord(value) && typeof value.url === "string" && value.url.length > 0;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatDate(value: unknown): string | undefined {
  const text = nonEmpty(value);
  return text ? text.slice(0, 10) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
