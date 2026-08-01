import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_PATH = join(getAgentDir(), "bash-timeout.json");

export const DEFAULT_DEFAULT_TIMEOUT_SECONDS = 10;
export const DEFAULT_MAX_TIMEOUT_SECONDS = 600;

export interface BashTimeoutConfig {
  defaultTimeoutSeconds: number | undefined;
  maxTimeoutSeconds: number | undefined;
  errors: string[];
}

function parseSeconds(
  value: unknown,
  field: string,
  fallback: number,
  errors: string[],
): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || (value !== -1 && value <= 0)) {
    errors.push(`${field} must be -1 (disabled) or a positive number of seconds; using ${fallback}`);
    return fallback;
  }
  if (value === -1) return undefined;
  return value;
}

export function loadConfig(): BashTimeoutConfig {
  const fallback: BashTimeoutConfig = {
    defaultTimeoutSeconds: DEFAULT_DEFAULT_TIMEOUT_SECONDS,
    maxTimeoutSeconds: DEFAULT_MAX_TIMEOUT_SECONDS,
    errors: [],
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    return { ...fallback, errors: [error instanceof Error ? error.message : String(error)] };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...fallback, errors: ["configuration root must be an object"] };
  }

  const value = parsed as Record<string, unknown>;
  const errors: string[] = [];

  const defaultTimeoutSeconds = parseSeconds(
    value.defaultTimeoutSeconds,
    "defaultTimeoutSeconds",
    DEFAULT_DEFAULT_TIMEOUT_SECONDS,
    errors,
  );
  const maxTimeoutSeconds = parseSeconds(
    value.maxTimeoutSeconds,
    "maxTimeoutSeconds",
    DEFAULT_MAX_TIMEOUT_SECONDS,
    errors,
  );

  if (
    defaultTimeoutSeconds !== undefined &&
    maxTimeoutSeconds !== undefined &&
    defaultTimeoutSeconds > maxTimeoutSeconds
  ) {
    errors.push(
      `defaultTimeoutSeconds (${defaultTimeoutSeconds}) exceeds maxTimeoutSeconds (${maxTimeoutSeconds}); the injected default will be clamped to ${maxTimeoutSeconds}s`,
    );
  }

  return { defaultTimeoutSeconds, maxTimeoutSeconds, errors };
}
