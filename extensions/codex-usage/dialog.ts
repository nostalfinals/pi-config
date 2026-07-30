import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text } from "@earendil-works/pi-tui";
import { CodexUsageError, fetchCodexUsage, type CodexUsage, type UsageWindow } from "./fetch";

type DialogState =
  | { kind: "loading" }
  | { kind: "usage"; usage: CodexUsage }
  | { kind: "error"; error: CodexUsageError };

function clampPercent(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.min(100, value));
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${mins > 0 ? ` ${mins}m` : ""}`;
  return `${mins}m`;
}

function windowName(window: UsageWindow, fallback: string): string {
  const seconds = window.windowSeconds;
  if (seconds === undefined) return fallback;
  if (seconds >= 6 * 24 * 3600 && seconds <= 8 * 24 * 3600) return "Weekly";
  if (seconds >= 4 * 3600 && seconds <= 6 * 3600) return "5-hour";
  return `${formatDuration(seconds)} window`;
}

function resetText(window: UsageWindow): string | undefined {
  let resetMs: number | undefined;
  if (window.resetAt !== undefined) {
    resetMs = window.resetAt > 10_000_000_000 ? window.resetAt : window.resetAt * 1000;
  } else if (window.resetAfterSeconds !== undefined) {
    resetMs = Date.now() + window.resetAfterSeconds * 1000;
  }
  if (resetMs === undefined || !Number.isFinite(resetMs)) return undefined;

  const remaining = resetMs - Date.now();
  if (remaining > 0) return `resets in ${formatDuration(remaining / 1000)}`;
  return "reset due now";
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function renderWindow(
  theme: Theme,
  window: UsageWindow,
  fallbackName: string,
  width: number,
): string {
  const percent = clampPercent(window.usedPercent);
  const barWidth = Math.max(10, Math.min(24, width - 42));
  const filled = percent === undefined ? 0 : Math.round((percent / 100) * barWidth);
  const bar = theme.fg("accent", "█".repeat(filled)) + theme.fg("dim", "░".repeat(barWidth - filled));
  const amount = percent === undefined
    ? theme.fg("muted", "usage unavailable")
    : `${theme.fg(percent >= 90 ? "error" : percent >= 75 ? "warning" : "success", `${Math.round(percent)}% used`)}${theme.fg("dim", ` · ${Math.round(100 - percent)}% left`)}`;
  const reset = resetText(window);
  return `${theme.bold(windowName(window, fallbackName).padEnd(9))} ${bar}  ${amount}${reset ? theme.fg("dim", ` · ${reset}`) : ""}`;
}

function errorTitle(error: CodexUsageError): string {
  switch (error.kind) {
    case "not-logged-in": return "OpenAI login required";
    case "login-expired": return "OpenAI login expired";
    case "no-access": return "Codex access unavailable";
    case "temporary": return "Usage temporarily unavailable";
    case "invalid-response": return "Unexpected usage response";
  }
}

export async function showCodexUsageDialog(ctx: ExtensionContext): Promise<void> {
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
      void fetchCodexUsage(ctx, controller.signal).then(
        (usage) => {
          if (closed || controller.signal.aborted) return;
          state = { kind: "usage", usage };
          tui.requestRender();
        },
        (error: unknown) => {
          if (closed || controller.signal.aborted) return;
          state = {
            kind: "error",
            error: error instanceof CodexUsageError
              ? error
              : new CodexUsageError("temporary", "Could not load Codex usage. Please try again."),
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
        container.addChild(new Text(theme.fg("accent", theme.bold("Codex Usage")), 1, 0));

        if (state.kind === "loading") {
          container.addChild(new Text(`${theme.fg("muted", "Fetching usage from OpenAI…")}`, 1, 1));
        } else if (state.kind === "error") {
          container.addChild(new Text(theme.fg("warning", theme.bold(errorTitle(state.error))), 1, 1));
          container.addChild(new Text(state.error.message, 1, 0));
        } else {
          const { usage } = state;
          const account = [usage.email, usage.plan ? `${titleCase(usage.plan)} plan` : undefined]
            .filter(Boolean)
            .join(" · ");
          if (account) container.addChild(new Text(theme.fg("muted", account), 1, 1));

          for (const [index, limit] of usage.limits.entries()) {
            if (usage.limits.length > 1) {
              container.addChild(new Text(theme.fg("accent", theme.bold(titleCase(limit.label))), 1, index === 0 ? 1 : 0));
            }
            if (limit.primary) container.addChild(new Text(renderWindow(theme, limit.primary, "Primary", width), 1, 0));
            if (limit.secondary) container.addChild(new Text(renderWindow(theme, limit.secondary, "Secondary", width), 1, 0));
          }

          if (usage.credits !== undefined) {
            container.addChild(new Text(`${theme.fg("muted", "Credits")}  ${theme.bold(String(usage.credits))}`, 1, 1));
          }
        }

        container.addChild(new Text(theme.fg("dim", "r refresh · enter/esc close"), 1, 1));
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
