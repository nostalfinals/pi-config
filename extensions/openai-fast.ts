import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Model, Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CONFIG_PATH = join(getAgentDir(), "openai-fast.json");
const SUPPORTED_PROVIDERS = ["openai", "openai-codex"] as const;
const DEFAULT_SUFFIX = "-fast";
const DEFAULT_SERVICE_TIER = "priority";

type FastProvider = (typeof SUPPORTED_PROVIDERS)[number];

interface FastModelSpec {
  sourceModel: string;
  aliasModel?: string;
  serviceTier: string;
}

interface OpenAIFastConfig {
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

function loadConfig(): OpenAIFastConfig {
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

function aliasId(spec: FastModelSpec, suffix: string): string {
  return spec.aliasModel ?? `${spec.sourceModel}${suffix}`;
}

interface FastAlias {
  provider: FastProvider;
  sourceModel: string;
  aliasModel: string;
  serviceTier: string;
}

type ModelSource = (provider: FastProvider, modelId: string) => Model<any> | undefined;

function modelKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function addError(errors: string[], message: string): void {
  if (!errors.includes(message)) errors.push(message);
}

function aliasForModel(
  provider: Provider,
  model: Model<any>,
  aliasesById: ReadonlyMap<string, FastAlias>,
): FastAlias | undefined {
  return aliasesById.get(modelKey(provider.id, model.id));
}

// Compaction can call the provider directly, without going through Pi's
// before_provider_request hook. Rewrite at the provider boundary as well.
// Keep the alias model itself intact so responses and session metadata still
// refer to the selected alias.
function fastRequestOptions(options: unknown, alias: FastAlias): unknown {
  const baseOptions = isRecord(options) ? options : {};
  const onPayload = baseOptions.onPayload;
  return {
    ...baseOptions,
    onPayload: async (payload: unknown, model: Model<any>) => {
      const transformedPayload = typeof onPayload === "function" ? await onPayload(payload, model) : undefined;
      const nextPayload = transformedPayload === undefined ? payload : transformedPayload;
      if (!isRecord(nextPayload)) return nextPayload;

      return {
        ...nextPayload,
        model: alias.sourceModel,
        service_tier: alias.serviceTier,
      };
    },
  };
}

function withAliases(
  provider: Provider,
  aliases: Model<any>[],
  aliasesById: ReadonlyMap<string, FastAlias>,
): Provider {
  const resolve = (model: Model<any>) => {
    const alias = aliasForModel(provider, model, aliasesById);
    return alias ? { model, alias } : { model };
  };

  return {
    ...provider,
    getModels: () => [...provider.getModels(), ...aliases],
    stream: (model, context, options) => {
      const resolved = resolve(model);
      return provider.stream(
        resolved.model,
        context,
        resolved.alias ? (fastRequestOptions(options, resolved.alias) as typeof options) : options,
      );
    },
    streamSimple: (model, context, options) => {
      const resolved = resolve(model);
      return provider.streamSimple(
        resolved.model,
        context,
        resolved.alias ? (fastRequestOptions(options, resolved.alias) as typeof options) : options,
      );
    },
  };
}

function makeAliasModel(source: Model<any>, aliasModel: string): Model<any> {
  return {
    ...source,
    id: aliasModel,
    name: `${source.name} (fast)`,
  };
}

function buildAliases(
  config: OpenAIFastConfig,
  sourceModel: ModelSource,
  aliasesById: Map<string, FastAlias>,
  errors: string[],
  existingModelIds?: ReadonlySet<string>,
  reportMissingSource = true,
): Map<FastProvider, Model<any>[]> {
  const aliasesByProvider = new Map<FastProvider, Model<any>[]>();

  for (const provider of SUPPORTED_PROVIDERS) {
    const providerAliases: Model<any>[] = [];
    const seenAliasIds = new Set<string>();

    for (const spec of config.models[provider]) {
      const aliasModel = aliasId(spec, config.suffix);
      const key = modelKey(provider, aliasModel);

      if (seenAliasIds.has(aliasModel) || aliasesById.has(key)) continue;
      seenAliasIds.add(aliasModel);

      const source = sourceModel(provider, spec.sourceModel);
      if (!source) {
        if (reportMissingSource) addError(errors, `Model not found for ${provider}: ${spec.sourceModel}`);
        continue;
      }
      if (aliasModel === spec.sourceModel) {
        addError(errors, `Alias for ${provider}/${spec.sourceModel} must differ from its source model`);
        continue;
      }
      if (existingModelIds?.has(key)) {
        addError(errors, `Alias model already exists: ${key}`);
        continue;
      }

      providerAliases.push(makeAliasModel(source, aliasModel));
      aliasesById.set(key, {
        provider,
        sourceModel: spec.sourceModel,
        aliasModel,
        serviceTier: spec.serviceTier,
      });
    }

    if (providerAliases.length > 0) aliasesByProvider.set(provider, providerAliases);
  }

  return aliasesByProvider;
}

function sourceFromProviders(providers: ReadonlyMap<FastProvider, Provider>): ModelSource {
  return (provider, modelId) => providers.get(provider)?.getModels().find((model) => model.id === modelId);
}

function notifyErrors(ctx: ExtensionContext, errors: string[]): void {
  if (errors.length === 0) return;
  ctx.ui.notify(`Invalid openai-fast config (${CONFIG_PATH}):\n${errors.join("\n")}`, "error");
}

export default function openaiFast(pi: ExtensionAPI): void {
  const config = loadConfig();
  const aliasesById = new Map<string, FastAlias>();
  const errors = [...config.errors];

  // Register native overlays during extension loading. This keeps the aliases
  // available to --list-models and to initial model resolution, while retaining
  // the original provider auth and stream implementation.
  const providers = new Map<FastProvider, Provider>();
  for (const provider of builtinProviders()) {
    if (SUPPORTED_PROVIDERS.includes(provider.id as FastProvider)) {
      providers.set(provider.id as FastProvider, provider);
    }
  }

  const builtinModelIds = new Set(
    [...providers].flatMap(([providerId, provider]) =>
      provider.getModels().map((model) => modelKey(providerId, model.id)),
    ),
  );
  const aliasesByProvider = buildAliases(
    config,
    sourceFromProviders(providers),
    aliasesById,
    errors,
    builtinModelIds,
    false,
  );
  for (const [providerId, aliases] of aliasesByProvider) {
    const provider = providers.get(providerId);
    if (provider) pi.registerProvider(withAliases(provider, aliases, aliasesById));
  }

  // The provider payload has already been built by the time this hook runs.
  // Replace the alias with the real backend model id and request OpenAI's
  // priority service tier. The alias remains the model selected and persisted
  // by Pi, so it is also visible to model-preset and the model selector.
  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    if (!model) return;

    const alias = aliasesById.get(modelKey(model.provider, model.id));
    if (!alias || typeof event.payload !== "object" || event.payload === null) return;

    return {
      ...(event.payload as Record<string, unknown>),
      model: alias.sourceModel,
      service_tier: alias.serviceTier,
    };
  });

  pi.on("session_start", (_event, ctx) => {
    // models.json may add a custom model to an OpenAI provider. The initial
    // registration cannot see those models, so complete the alias overlay once
    // the session's effective registry is available.
    const allModels = ctx.modelRegistry.getAll();
    const allModelIds = new Set(allModels.map((model) => modelKey(model.provider, model.id)));
    const sourceModel = (provider: FastProvider, modelId: string) =>
      allModels.find((model) => model.provider === provider && model.id === modelId);
    const dynamicAliases = buildAliases(config, sourceModel, aliasesById, errors, allModelIds);

    for (const [providerId, aliases] of dynamicAliases) {
      const provider = ctx.modelRegistry.getProvider(providerId);
      if (!provider) continue;

      // Preserve the current effective provider (including auth, custom
      // endpoint configuration, and any models.json changes) and only append
      // aliases that were discovered after the initial provider registration.
      pi.registerProvider(withAliases(provider, aliases, aliasesById));
    }

    notifyErrors(ctx, errors);
  });
}
