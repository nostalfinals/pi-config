import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatDuration } from "../shared/duration";

const RESPONSE_STATS_ENTRY_TYPE = "ui-customization-response-stats";

type ResponseStatsEntryData = {
  outputTokens: number;
  streamMs: number;
  elapsedMs?: number;
};

function renderSummary(data: ResponseStatsEntryData, theme: Theme) {
  const seconds = data.streamMs / 1_000;
  const tokensPerSecond = Math.round(data.outputTokens / seconds);
  return [
    theme.fg("success", "✓"),
    theme.fg("muted", `${tokensPerSecond} tok/s`),
    theme.fg("dim", "•"),
    theme.fg("muted", formatDuration(data.elapsedMs ?? data.streamMs)),
  ].join(" ");
}

export function installResponseStats(pi: ExtensionAPI) {
  // Register during factory loading so restored custom entries are available
  // before Pi reconstructs the transcript on reload/session replacement.
  // Entry renderers are inert outside interactive mode; collection and entry
  // creation below are explicitly TUI-only.
  pi.registerEntryRenderer<ResponseStatsEntryData>(
    RESPONSE_STATS_ENTRY_TYPE,
    (entry, _options, theme) => {
      const data = entry.data;
      if (
        !data ||
        !Number.isFinite(data.outputTokens) ||
        data.outputTokens <= 0 ||
        !Number.isFinite(data.streamMs) ||
        data.streamMs <= 0
      ) {
        return new Text(theme.fg("dim", "Response statistics unavailable"), 1, 0);
      }
      return new Text(renderSummary(data, theme), 1, 0);
    },
  );

  let agentStartedAt: number | null = null;
  let turnStart: number | null = null;
  let messageStart: number | null = null;
  let totalOutputTokens = 0;
  let totalRequestMs = 0;

  function resetMessage() {
    turnStart = null;
    messageStart = null;
  }

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || agentStartedAt !== null) return;
    agentStartedAt = Date.now();
    totalOutputTokens = 0;
    totalRequestMs = 0;
    resetMessage();
  });

  // Pi emits message_start only when the provider stream begins, after TTFT.
  // turn_start precedes the request, so measuring from it matches OpenRouter's
  // throughput definition (fetch latency + TTFT + streaming time).
  pi.on("turn_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    turnStart = Date.now();
  });

  pi.on("message_start", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
    messageStart = Date.now();
  });

  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "assistant") return;

    const outputTokens = event.message.usage.output;
    const startedAt = turnStart ?? messageStart;
    if (startedAt !== null && outputTokens > 0) {
      totalOutputTokens += outputTokens;
      totalRequestMs += Math.max(0, Date.now() - startedAt);
    }
    resetMessage();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.mode === "tui" && totalOutputTokens > 0 && totalRequestMs > 0) {
      const elapsedMs = agentStartedAt === null
        ? totalRequestMs
        : Math.max(0, Date.now() - agentStartedAt);
      pi.appendEntry<ResponseStatsEntryData>(RESPONSE_STATS_ENTRY_TYPE, {
        outputTokens: totalOutputTokens,
        streamMs: totalRequestMs,
        elapsedMs,
      });
    }

    agentStartedAt = null;
    totalOutputTokens = 0;
    totalRequestMs = 0;
    resetMessage();
  });
}
