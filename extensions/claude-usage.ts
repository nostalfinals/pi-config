import { tmpdir } from "node:os";
import { DynamicBorder, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Spacer, Text } from "@earendil-works/pi-tui";

const TIMEOUT_MS = 30_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Claude Code prints lines like:
//   Current session: 10% used · resets Nov 5, 12pm (UTC)
//   Current week (all models): 2% used · resets Nov 11, 7pm (UTC)
const LIMIT_LINE = /^(.+?):\s*(\d+(?:\.\d+)?)%\s+used(?:\s*·\s*resets\s+(.+?))?\s*$/;

export interface UsageWindow {
  label: string;
  usedPercent: number;
  resetAt?: number;
  resetRaw?: string;
}

export class ClaudeUsageError extends Error {
  constructor(
    public readonly title: string,
    message: string,
  ) {
    super(message);
    this.name = "ClaudeUsageError";
  }
}

/** Parses "Nov 5, 8pm", "Nov 5, 8:30pm" or "8pm" as UTC, picking the next occurrence. */
function parseReset(text: string, now = Date.now()): number | undefined {
  const match = /^(?:([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i
    .exec(text.replace(/\s*\(UTC\)$/, "").trim());
  if (!match) return undefined;

  const [, monthName, dayText, hourText, minuteText, meridiem] = match;
  const hour = (Number(hourText) % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  const minute = minuteText ? Number(minuteText) : 0;
  const today = new Date(now);

  if (!monthName) {
    let at = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hour, minute);
    if (at < now) at += 24 * 3600 * 1000;
    return at;
  }

  const month = MONTHS.indexOf(monthName.toLowerCase());
  if (month < 0) return undefined;
  const day = Number(dayText);
  let at = Date.UTC(today.getUTCFullYear(), month, day, hour, minute);
  // The text carries no year; a date well in the past means it rolls over into next year.
  if (at < now - 24 * 3600 * 1000) at = Date.UTC(today.getUTCFullYear() + 1, month, day, hour, minute);
  return at;
}

function windowLabel(raw: string): string {
  if (/^current session$/i.test(raw)) return "Session";
  if (/^current week \(all models\)$/i.test(raw)) return "Weekly";
  return raw.replace(/^current\s+/i, "").replace(/^\w/, (c) => c.toUpperCase());
}

function parseUsage(text: string): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const line of text.split("\n")) {
    const match = LIMIT_LINE.exec(line.trim());
    if (!match) continue;
    const [, label, percent, reset] = match;
    windows.push({
      label: windowLabel(label.trim()),
      usedPercent: Number(percent),
      resetAt: reset ? parseReset(reset) : undefined,
      resetRaw: reset,
    });
  }
  return windows;
}

async function fetchClaudeUsage(pi: ExtensionAPI, signal: AbortSignal): Promise<UsageWindow[]> {
  // TZ=UTC makes Claude Code print reset times in UTC, so we don't have to resolve its local timezone names.
  const result = await pi.exec(
    "env",
    ["TZ=UTC", "claude", "-p", "/usage", "--output-format", "json", "--no-session-persistence"],
    { signal, timeout: TIMEOUT_MS, cwd: tmpdir(), maxBuffer: 1024 * 1024 },
  );
  if (signal.aborted) throw signal.reason;

  if (result.code === 127 || /No such file|not found|ENOENT/i.test(result.stderr)) {
    throw new ClaudeUsageError("Claude Code not found", "Install Claude Code and make sure `claude` is on PATH.");
  }
  if (result.killed) {
    throw new ClaudeUsageError("Usage check timed out", "Claude Code did not answer in time. Please try again.");
  }

  let payload: { is_error?: unknown; result?: unknown } | undefined;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    payload = undefined;
  }
  const text = typeof payload?.result === "string" ? payload.result.trim() : "";

  if (result.code !== 0 || !payload || payload.is_error === true) {
    const detail = text || result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new ClaudeUsageError("Claude Code reported an error", detail);
  }

  const windows = parseUsage(text);
  if (windows.length === 0) {
    // Not logged in, API-key billing, or Claude Code changed its wording: show what it said.
    throw new ClaudeUsageError("No usage limits found", text || "Claude Code returned no usage text.");
  }
  return windows;
}

type DialogState =
  | { kind: "loading" }
  | { kind: "usage"; windows: UsageWindow[] }
  | { kind: "error"; error: ClaudeUsageError };

function formatDuration(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${mins > 0 ? ` ${mins}m` : ""}`;
  return `${mins}m`;
}

function resetText(window: UsageWindow): string | undefined {
  if (window.resetAt === undefined) return window.resetRaw ? `resets ${window.resetRaw}` : undefined;
  const remaining = window.resetAt - Date.now();
  return remaining > 0 ? `resets in ${formatDuration(remaining / 1000)}` : "reset due now";
}

function renderWindow(theme: Theme, window: UsageWindow, labelWidth: number, width: number): string {
  const percent = Math.max(0, Math.min(100, window.usedPercent));
  const barWidth = Math.max(10, Math.min(24, width - 42));
  const filled = Math.round((percent / 100) * barWidth);
  const bar = theme.fg("accent", "█".repeat(filled)) + theme.fg("dim", "░".repeat(barWidth - filled));
  const color = percent >= 90 ? "error" : percent >= 75 ? "warning" : "success";
  const amount = `${theme.fg(color, `${Math.round(percent)}% used`)}${theme.fg("dim", ` · ${Math.round(100 - percent)}% left`)}`;
  const reset = resetText(window);
  return `${theme.bold(window.label.padEnd(labelWidth))} ${bar}  ${amount}${reset ? theme.fg("dim", ` · ${reset}`) : ""}`;
}

async function showClaudeUsageDialog(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    let state: DialogState = { kind: "loading" };
    let closed = false;
    let request: AbortController | undefined;

    const load = () => {
      request?.abort();
      request = new AbortController();
      const controller = request;
      state = { kind: "loading" };
      tui.requestRender();
      void fetchClaudeUsage(pi, controller.signal).then(
        (windows) => {
          if (closed || controller.signal.aborted) return;
          state = { kind: "usage", windows };
          tui.requestRender();
        },
        (error: unknown) => {
          if (closed || controller.signal.aborted) return;
          state = {
            kind: "error",
            error: error instanceof ClaudeUsageError
              ? error
              : new ClaudeUsageError("Usage temporarily unavailable", "Could not load Claude usage. Please try again."),
          };
          tui.requestRender();
        },
      );
    };

    const close = () => {
      closed = true;
      request?.abort();
      done();
    };

    queueMicrotask(load);

    return {
      render: (width: number) => {
        const container = new Container();
        container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
        container.addChild(new Text(theme.fg("accent", theme.bold("Claude Usage")), 1, 0));
        container.addChild(new Spacer(1));

        if (state.kind === "loading") {
          container.addChild(new Text(theme.fg("muted", "Asking Claude Code for usage…"), 1, 0));
        } else if (state.kind === "error") {
          container.addChild(new Text(theme.fg("warning", theme.bold(state.error.title)), 1, 0));
          container.addChild(new Text(state.error.message, 1, 0));
        } else {
          const labelWidth = Math.max(...state.windows.map((window) => window.label.length));
          for (const window of state.windows) {
            container.addChild(new Text(renderWindow(theme, window, labelWidth, width), 1, 0));
          }
        }

        container.addChild(new Text(`\n${theme.fg("dim", "r refresh · enter/esc close")}`, 1, 0));
        container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
        return container.render(width);
      },
      invalidate: () => {},
      handleInput: (data: string) => {
        if (matchesKey(data, "escape") || matchesKey(data, "enter")) close();
        else if (data === "r" || data === "R") load();
      },
    };
  });
}

export default function claudeUsage(pi: ExtensionAPI): void {
  let dialogOpen = false;

  pi.registerCommand("claude-usage", {
    description: "Show Claude subscription usage (via Claude Code)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Claude usage is available in TUI mode only.", "warning");
        return;
      }
      if (dialogOpen) return;

      dialogOpen = true;
      try {
        await showClaudeUsageDialog(pi, ctx);
      } finally {
        dialogOpen = false;
      }
    },
  });
}
