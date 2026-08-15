import { DynamicBorder, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text } from "@earendil-works/pi-tui";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const AUTH_CLAIM = "https://api.openai.com/auth";
const PROFILE_CLAIM = "https://api.openai.com/profile";
const TIMEOUT_MS = 10_000;

type JsonRecord = Record<string, unknown>;

export interface UsageWindow {
  usedPercent?: number;
  windowSeconds?: number;
  resetAt?: number;
  resetAfterSeconds?: number;
}

export interface UsageLimit {
  label: string;
  primary?: UsageWindow;
  secondary?: UsageWindow;
}

export interface CodexUsage {
  email?: string;
  plan?: string;
  limits: UsageLimit[];
  credits?: number;
}

export type UsageErrorKind =
  | "not-logged-in"
  | "login-expired"
  | "no-access"
  | "temporary"
  | "invalid-response";

export class CodexUsageError extends Error {
  constructor(
    public readonly kind: UsageErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "CodexUsageError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeJwt(token: string): JsonRecord | undefined {
  const encoded = token.split(".")[1];
  if (!encoded) return undefined;
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    const payload: unknown = JSON.parse(decoded);
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function jwtDetails(token: string): { accountId?: string; email?: string } {
  const payload = decodeJwt(token);
  const auth = payload?.[AUTH_CLAIM];
  const profile = payload?.[PROFILE_CLAIM];
  return {
    accountId: isRecord(auth) ? nonEmptyString(auth.chatgpt_account_id) : undefined,
    email: isRecord(profile) ? nonEmptyString(profile.email)?.toLowerCase() : undefined,
  };
}

function parseWindow(value: unknown): UsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const window: UsageWindow = {
    usedPercent: finiteNumber(value.used_percent),
    windowSeconds: finiteNumber(value.limit_window_seconds),
    resetAt: finiteNumber(value.reset_at),
    resetAfterSeconds: finiteNumber(value.reset_after_seconds),
  };
  return Object.values(window).some((item) => item !== undefined) ? window : undefined;
}

function parseRateLimit(value: unknown): Pick<UsageLimit, "primary" | "secondary"> {
  if (!isRecord(value)) return {};
  return {
    primary: parseWindow(value.primary_window),
    secondary: parseWindow(value.secondary_window),
  };
}

function parseUsage(payload: unknown, fallbackEmail?: string): CodexUsage {
  if (!isRecord(payload)) {
    throw new CodexUsageError("invalid-response", "OpenAI returned an unreadable usage response.");
  }

  const limits: UsageLimit[] = [];
  const main = parseRateLimit(payload.rate_limit);
  if (main.primary || main.secondary) limits.push({ label: "Codex", ...main });

  if (Array.isArray(payload.additional_rate_limits)) {
    for (const item of payload.additional_rate_limits) {
      if (!isRecord(item)) continue;
      const parsed = parseRateLimit(item.rate_limit);
      if (!parsed.primary && !parsed.secondary) continue;
      limits.push({
        label: nonEmptyString(item.limit_name) ?? nonEmptyString(item.metered_feature) ?? "Additional limit",
        ...parsed,
      });
    }
  }

  if (limits.length === 0) {
    throw new CodexUsageError(
      "no-access",
      "This OpenAI account does not expose Codex usage. Codex may not be enabled for its plan or workspace.",
    );
  }

  const credits = isRecord(payload.credits) ? finiteNumber(payload.credits.balance) : undefined;
  return {
    email: nonEmptyString(payload.email)?.toLowerCase() ?? fallbackEmail,
    plan: nonEmptyString(payload.plan_type),
    limits,
    credits,
  };
}

function errorForStatus(status: number): CodexUsageError {
  if (status === 401) {
    return new CodexUsageError("login-expired", "Your OpenAI Codex login has expired. Run /login to sign in again.");
  }
  if (status === 400 || status === 403) {
    return new CodexUsageError(
      "no-access",
      "This OpenAI account does not have Codex access, or its workspace does not expose usage.",
    );
  }
  return new CodexUsageError(
    "temporary",
    status === 429
      ? "OpenAI rate-limited the usage check. Please try again shortly."
      : `OpenAI usage service is unavailable (HTTP ${status}).`,
  );
}

async function fetchCodexUsage(ctx: ExtensionContext, signal?: AbortSignal): Promise<CodexUsage> {
  let resolved;
  try {
    resolved = await ctx.modelRegistry.getProviderAuth("openai-codex");
  } catch {
    throw new CodexUsageError("login-expired", "Could not refresh your OpenAI Codex login. Run /login to sign in again.");
  }

  const token = resolved?.auth.apiKey;
  if (!token) {
    throw new CodexUsageError("not-logged-in", "No OpenAI Codex login was found. Run /login and choose OpenAI Codex.");
  }

  const details = jwtDetails(token);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      signal: requestSignal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "pi-codex-usage/1.0",
        originator: "pi-codex-usage",
        ...(details.accountId ? { "ChatGPT-Account-Id": details.accountId } : {}),
      },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CodexUsageError(
      "temporary",
      error instanceof DOMException && error.name === "TimeoutError"
        ? "The OpenAI usage request timed out. Please try again."
        : "Could not reach the OpenAI usage service. Check your connection and try again.",
    );
  }

  if (!response.ok) throw errorForStatus(response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CodexUsageError("invalid-response", "OpenAI returned an unreadable usage response.");
  }
  return parseUsage(payload, details.email);
}

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

async function showCodexUsageDialog(ctx: ExtensionContext): Promise<void> {
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

export default function codexUsage(pi: ExtensionAPI): void {
  let dialogOpen = false;

  pi.registerCommand("codex-usage", {
    description: "Show OpenAI Codex usage",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Codex usage is available in TUI mode only.", "warning");
        return;
      }
      if (dialogOpen) return;

      dialogOpen = true;
      try {
        await showCodexUsageDialog(ctx);
      } finally {
        dialogOpen = false;
      }
    },
  });
}
