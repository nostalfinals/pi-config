import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Model, Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  aliasId,
  CONFIG_PATH,
  loadConfig,
  type FastModelSpec,
  type FastProvider,
  type OpenAIFastConfig,
  SUPPORTED_PROVIDERS,
} from "./config";

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

function withAliases(provider: Provider, aliases: Model<any>[]): Provider {
  return {
    ...provider,
    getModels: () => [...provider.getModels(), ...aliases],
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
    if (provider) pi.registerProvider(withAliases(provider, aliases));
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
      pi.registerProvider(withAliases(provider, aliases));
    }

    notifyErrors(ctx, errors);
  });
}

export type { FastModelSpec, FastProvider, OpenAIFastConfig } from "./config";
