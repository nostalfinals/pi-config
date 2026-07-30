import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

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

export async function fetchCodexUsage(ctx: ExtensionContext, signal?: AbortSignal): Promise<CodexUsage> {
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
