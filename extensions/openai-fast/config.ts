import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_PATH = join(getAgentDir(), "openai-fast.json");
export const SUPPORTED_PROVIDERS = ["openai", "openai-codex"] as const;
export const DEFAULT_SUFFIX = "-fast";
export const DEFAULT_SERVICE_TIER = "priority";

export type FastProvider = (typeof SUPPORTED_PROVIDERS)[number];

export interface FastModelSpec {
  sourceModel: string;
  aliasModel?: string;
  serviceTier: string;
}

export interface OpenAIFastConfig {
  suffix: string;
  serviceTier: string;
  models: Record<FastProvider, FastModelSpec[]>;
  errors: string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function serviceTierValue(value: unknown, fallback: string, field: string, errors: string[]): string {
  const tier = stringValue(value);
  if (!tier) return fallback;

  // These are the service tiers accepted by the OpenAI Responses API. Keep the
  // value as a string so a compatible OpenAI proxy can add its own tier later.
  if (!["auto", "default", "flex", "priority"].includes(tier)) {
    errors.push(`${field} must be one of auto, default, flex, or priority; using ${fallback}`);
    return fallback;
  }
  return tier;
}

function addSpec(
  specs: FastModelSpec[],
  value: unknown,
  field: string,
  defaultTier: string,
  errors: string[],
): void {
  if (typeof value === "string") {
    const sourceModel = stringValue(value);
    if (sourceModel) specs.push({ sourceModel, serviceTier: defaultTier });
    else errors.push(`${field} must contain a non-empty model id`);
    return;
  }

  if (!isRecord(value)) {
    errors.push(`${field} must be a model id or object`);
    return;
  }

  const sourceModel = stringValue(value.model) ?? stringValue(value.source) ?? stringValue(value.id);
  if (!sourceModel) {
    errors.push(`${field} must define "model" (or "source")`);
    return;
  }

  const aliasModel = stringValue(value.alias) ?? stringValue(value.aliasModel);
  const serviceTier = serviceTierValue(value.serviceTier, defaultTier, `${field}.serviceTier`, errors);
  specs.push({ sourceModel, aliasModel, serviceTier });
}

function parseProviderModels(
  value: unknown,
  provider: FastProvider,
  defaultTier: string,
  errors: string[],
): FastModelSpec[] {
  const field = `models.${provider}`;
  const specs: FastModelSpec[] = [];

  if (Array.isArray(value)) {
    value.forEach((entry, index) => addSpec(specs, entry, `${field}[${index}]`, defaultTier, errors));
    return specs;
  }

  if (typeof value === "string") {
    addSpec(specs, value, field, defaultTier, errors);
    return specs;
  }

  if (!isRecord(value)) {
    errors.push(`${field} must be an array, model id, or object`);
    return specs;
  }

  // A single object may be written as { model, alias, serviceTier }.
  if (value.model !== undefined || value.source !== undefined || value.id !== undefined) {
    addSpec(specs, value, field, defaultTier, errors);
    return specs;
  }

  // The object form is a convenient source-to-alias map:
  // { "gpt-5.6-luna": "gpt-5.6-luna-fast" }
  for (const [sourceModel, aliasConfig] of Object.entries(value)) {
    if (aliasConfig === false || aliasConfig === null) continue;
    if (aliasConfig === true || aliasConfig === undefined) {
      specs.push({ sourceModel, serviceTier: defaultTier });
      continue;
    }
    if (typeof aliasConfig === "string") {
      specs.push({ sourceModel, aliasModel: aliasConfig, serviceTier: defaultTier });
      continue;
    }
    if (isRecord(aliasConfig)) {
      const aliasModel =
        stringValue(aliasConfig.alias) ?? stringValue(aliasConfig.aliasModel) ?? stringValue(aliasConfig.id);
      const serviceTier = serviceTierValue(
        aliasConfig.serviceTier,
        defaultTier,
        `${field}.${sourceModel}.serviceTier`,
        errors,
      );
      specs.push({ sourceModel, aliasModel, serviceTier });
      continue;
    }
    errors.push(`${field}.${sourceModel} must be false, an alias string, or an object`);
  }

  return specs;
}

function parseRootAliases(
  value: unknown,
  defaultTier: string,
  models: Record<FastProvider, FastModelSpec[]>,
  errors: string[],
): void {
  if (value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (!isRecord(entry)) {
        errors.push(`aliases[${index}] must be an object`);
        return;
      }
      const provider = stringValue(entry.provider);
      if (!provider || !SUPPORTED_PROVIDERS.includes(provider as FastProvider)) {
        errors.push(`aliases[${index}].provider must be openai or openai-codex`);
        return;
      }
      const spec: FastModelSpec[] = [];
      addSpec(spec, entry, `aliases[${index}]`, defaultTier, errors);
      models[provider as FastProvider].push(...spec);
    });
    return;
  }

  if (!isRecord(value)) {
    errors.push("aliases must be an array or object");
    return;
  }

  for (const provider of SUPPORTED_PROVIDERS) {
    if (value[provider] !== undefined) {
      models[provider].push(...parseProviderModels(value[provider], provider, defaultTier, errors));
    }
  }
}

export function loadConfig(): OpenAIFastConfig {
  const models: Record<FastProvider, FastModelSpec[]> = {
    openai: [],
    "openai-codex": [],
  };
  const errors: string[] = [];

  if (!existsSync(CONFIG_PATH)) {
    return { suffix: DEFAULT_SUFFIX, serviceTier: DEFAULT_SERVICE_TIER, models, errors };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    errors.push(`Failed to parse ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`);
    return { suffix: DEFAULT_SUFFIX, serviceTier: DEFAULT_SERVICE_TIER, models, errors };
  }

  if (!isRecord(parsed)) {
    errors.push("The root value must be a JSON object");
    return { suffix: DEFAULT_SUFFIX, serviceTier: DEFAULT_SERVICE_TIER, models, errors };
  }

  const suffix = stringValue(parsed.suffix) ?? DEFAULT_SUFFIX;
  const serviceTier = serviceTierValue(parsed.serviceTier, DEFAULT_SERVICE_TIER, "serviceTier", errors);

  const modelConfig = isRecord(parsed.models) ? parsed.models : parsed;
  for (const provider of SUPPORTED_PROVIDERS) {
    if (modelConfig[provider] !== undefined) {
      models[provider].push(...parseProviderModels(modelConfig[provider], provider, serviceTier, errors));
    }
  }
  parseRootAliases(parsed.aliases, serviceTier, models, errors);

  return { suffix, serviceTier, models, errors };
}

export function aliasId(spec: FastModelSpec, suffix: string): string {
  return spec.aliasModel ?? `${spec.sourceModel}${suffix}`;
}
