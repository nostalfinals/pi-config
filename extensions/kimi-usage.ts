import { DynamicBorder, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Spacer, Text } from "@earendil-works/pi-tui";

const USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const TIMEOUT_MS = 10_000;

type JsonRecord = Record<string, unknown>;

export interface UsageWindow {
  usedPercent?: number;
  windowSeconds?: number;
  resetAt?: number;
}

export interface UsageLimit {
  label: string;
  primary?: UsageWindow;
  secondary?: UsageWindow;
}

export interface KimiUsage {
  plan?: string;
  limits: UsageLimit[];
}

export type UsageErrorKind =
  | "not-logged-in"
  | "login-expired"
  | "no-access"
  | "temporary"
  | "invalid-response";

export class KimiUsageError extends Error {
  constructor(
    public readonly kind: UsageErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "KimiUsageError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resetTime(value: unknown): number | undefined {
  const timestamp = nonEmptyString(value);
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function windowSeconds(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const duration = finiteNumber(value.duration);
  const unit = nonEmptyString(value.timeUnit ?? value.time_unit)?.toUpperCase();
  if (duration === undefined || duration < 0 || !unit) return undefined;
  if (unit === "TIME_UNIT_MINUTE" || unit === "MINUTE" || unit === "MINUTES") return duration * 60;
  if (unit === "TIME_UNIT_HOUR" || unit === "HOUR" || unit === "HOURS") return duration * 3600;
  return undefined;
}

function usagePercent(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const ratio = finiteNumber(value.used_ratio);
  if (ratio !== undefined) return ratio * 100;

  const limit = finiteNumber(value.limit);
  const used = finiteNumber(value.used);
  const remaining = finiteNumber(value.remaining);
  if (used !== undefined && limit !== undefined && limit > 0) return (used / limit) * 100;
  if (remaining !== undefined && limit !== undefined && limit > 0) return ((limit - remaining) / limit) * 100;
  return undefined;
}

function parseWindow(value: unknown, duration?: number): UsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const usedPercent = usagePercent(value);
  const resetAt = resetTime(value.resetTime ?? value.reset_time ?? value.resetAt ?? value.reset_at);
  if (usedPercent === undefined && resetAt === undefined) return undefined;
  return { usedPercent, windowSeconds: duration, resetAt };
}

function membershipLabel(value: unknown): string | undefined {
  const level = nonEmptyString(value);
  if (!level) return undefined;
  return level
    .replace(/^LEVEL_/, "")
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ") || undefined;
}

function parseUsage(payload: unknown): KimiUsage {
  if (!isRecord(payload)) {
    throw new KimiUsageError("invalid-response", "Kimi returned an unreadable usage response.");
  }

  let rolling: UsageWindow | undefined;
  if (Array.isArray(payload.limits)) {
    for (const item of payload.limits) {
      if (!isRecord(item)) continue;
      rolling = parseWindow(item.detail, windowSeconds(item.window));
      if (rolling) break;
    }
  }

  const usages = isRecord(payload.usages) ? payload.usages : undefined;
  rolling ??= parseWindow(usages?.limit_5h, 5 * 3600);

  const longWindow = parseWindow(payload.usage, 7 * 24 * 3600)
    ?? parseWindow(usages?.limit_month_total, 30 * 24 * 3600);
  if (!rolling && !longWindow) {
    throw new KimiUsageError(
      "no-access",
      "This Kimi account does not expose Kimi For Coding usage. Check that its plan includes coding access.",
    );
  }

  const user = isRecord(payload.user) ? payload.user : undefined;
  const membership = user && isRecord(user.membership) ? user.membership : undefined;
  return {
    plan: membershipLabel(membership?.level),
    limits: [{ label: "Kimi For Coding", primary: rolling, secondary: longWindow }],
  };
}

function errorForStatus(status: number): KimiUsageError {
  if (status === 401) {
    return new KimiUsageError("login-expired", "Your Kimi For Coding login has expired. Run /login to sign in again.");
  }
  if (status === 400 || status === 403) {
    return new KimiUsageError(
      "no-access",
      "This Kimi account does not have Kimi For Coding access, or its plan does not expose usage.",
    );
  }
  return new KimiUsageError(
    "temporary",
    status === 429
      ? "Kimi rate-limited the usage check. Please try again shortly."
      : `Kimi usage service is unavailable (HTTP ${status}).`,
  );
}

async function fetchKimiUsage(ctx: ExtensionContext, signal?: AbortSignal): Promise<KimiUsage> {
  let resolved;
  try {
    resolved = await ctx.modelRegistry.getProviderAuth("kimi-coding");
  } catch {
    throw new KimiUsageError("login-expired", "Could not refresh your Kimi For Coding login. Run /login to sign in again.");
  }

  const authorization = resolved?.auth.headers?.Authorization
    ?? (resolved?.auth.apiKey ? `Bearer ${resolved.auth.apiKey}` : undefined);
  if (!authorization) {
    throw new KimiUsageError("not-logged-in", "No Kimi For Coding login was found. Run /login and choose Kimi For Coding.");
  }

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      signal: requestSignal,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "User-Agent": "pi-kimi-usage/1.0",
      },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new KimiUsageError(
      "temporary",
      error instanceof DOMException && error.name === "TimeoutError"
        ? "The Kimi usage request timed out. Please try again."
        : "Could not reach the Kimi usage service. Check your connection and try again.",
    );
  }

  if (!response.ok) throw errorForStatus(response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new KimiUsageError("invalid-response", "Kimi returned an unreadable usage response.");
  }
  return parseUsage(payload);
}

type DialogState =
  | { kind: "loading" }
  | { kind: "usage"; usage: KimiUsage }
  | { kind: "error"; error: KimiUsageError };

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
  if (seconds >= 28 * 24 * 3600 && seconds <= 31 * 24 * 3600) return "Monthly";
  if (seconds >= 6 * 24 * 3600 && seconds <= 8 * 24 * 3600) return "Weekly";
  if (seconds >= 4 * 3600 && seconds <= 6 * 3600) return "Code 5-hour";
  return `${formatDuration(seconds)} window`;
}

function resetText(window: UsageWindow): string | undefined {
  if (window.resetAt === undefined || !Number.isFinite(window.resetAt)) return undefined;
  const remaining = window.resetAt - Date.now();
  if (remaining > 0) return `resets in ${formatDuration(remaining / 1000)}`;
  return "reset due now";
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
  return `${theme.bold(windowName(window, fallbackName).padEnd(11))} ${bar}  ${amount}${reset ? theme.fg("dim", ` · ${reset}`) : ""}`;
}

function errorTitle(error: KimiUsageError): string {
  switch (error.kind) {
    case "not-logged-in": return "Kimi login required";
    case "login-expired": return "Kimi login expired";
    case "no-access": return "Kimi For Coding access unavailable";
    case "temporary": return "Usage temporarily unavailable";
    case "invalid-response": return "Unexpected usage response";
  }
}

async function showKimiUsageDialog(ctx: ExtensionContext): Promise<void> {
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
      void fetchKimiUsage(ctx, controller.signal).then(
        (usage) => {
          if (closed || controller.signal.aborted) return;
          state = { kind: "usage", usage };
          tui.requestRender();
        },
        (error: unknown) => {
          if (closed || controller.signal.aborted) return;
          state = {
            kind: "error",
            error: error instanceof KimiUsageError
              ? error
              : new KimiUsageError("temporary", "Could not load Kimi usage. Please try again."),
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
        container.addChild(new Text(theme.fg("accent", theme.bold("Kimi Usage")), 1, 0));
        container.addChild(new Spacer(1));

        if (state.kind === "loading") {
          container.addChild(new Text(theme.fg("muted", "Fetching usage from Kimi…"), 1, 1));
        } else if (state.kind === "error") {
          container.addChild(new Text(theme.fg("warning", theme.bold(errorTitle(state.error))), 1, 1));
          container.addChild(new Text(state.error.message, 1, 0));
        } else {
          const { usage } = state;
          if (usage.plan) container.addChild(new Text(theme.fg("muted", `${usage.plan} plan`), 1, 1));

          for (const [index, limit] of usage.limits.entries()) {
            if (usage.limits.length > 1) {
              container.addChild(new Text(`${index > 0 ? "\n" : ""}${theme.fg("accent", theme.bold(limit.label))}`, 1, 0));
            }
            if (limit.primary) container.addChild(new Text(renderWindow(theme, limit.primary, "Code 5-hour", width), 1, 0));
            if (limit.secondary) container.addChild(new Text(renderWindow(theme, limit.secondary, "Overall", width), 1, 0));
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

export default function kimiUsage(pi: ExtensionAPI): void {
  let dialogOpen = false;

  pi.registerCommand("kimi-usage", {
    description: "Show Kimi For Coding usage",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Kimi usage is available in TUI mode only.", "warning");
        return;
      }
      if (dialogOpen) return;

      dialogOpen = true;
      try {
        await showKimiUsageDialog(ctx);
      } finally {
        dialogOpen = false;
      }
    },
  });
}
