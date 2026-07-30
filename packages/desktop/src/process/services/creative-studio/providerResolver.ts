/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { IProvider } from '@/common/config/storage';
import type { AppOperationsModelResponse } from '@/common/types/appOperations';
import type {
  StudioConnectionBinding,
  StudioConnectionCandidate,
  StudioConnectionCapabilities,
  StudioMediaKind,
  StudioProviderModelOption,
  StudioProviderAdapterId,
  StudioProviderRef,
  StudioRouteCatalog,
  StudioRouteConstraints,
  StudioRouteSuggestion,
  StudioRoutingPreferences,
} from '@/common/types/project/creativeStudioTypes';
import { isImageGenSupported, isImagesApiModel } from '@/common/utils/imageModelAllowlist';
import { getBytePlusSeedanceModelSpec, isSupportedBytePlusSeedanceProvider } from './adapters/bytePlusSeedanceAdapter';

type ClientSettings = Record<string, unknown>;
type PlanningReadiness = AppOperationsModelResponse;

export type StudioProviderResolverDeps = {
  listProviders: () => Promise<IProvider[]>;
  getClientSettings: () => Promise<ClientSettings>;
  getPlanningReadiness: () => Promise<PlanningReadiness>;
  listConnections: () => Promise<StudioConnectionBinding[]>;
};

export type StudioProviderResolver = {
  listConnectionCandidates(): Promise<StudioConnectionCandidate[]>;
  listRoutes(input?: { routing?: StudioRoutingPreferences }): Promise<StudioRouteCatalog>;
};

const imageAdapter: StudioProviderAdapterId = 'weprompt-image-v1';
const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const isUnsafeTextCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0)!;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff);
};

const isSafeProviderId = (value: string): boolean => SAFE_ID.test(value);
const isSafeModel = (value: string): boolean =>
  value.length > 0 && value.length <= 256 && value === value.trim() && !Array.from(value).some(isUnsafeTextCharacter);
const sanitizedProviderName = (provider: IProvider): string => {
  const normalized = Array.from(provider.name, (character) => (isUnsafeTextCharacter(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
  return normalized || provider.id;
};

const available = (provider: IProvider, model: string): boolean =>
  provider.enabled !== false &&
  provider.model_enabled?.[model] !== false &&
  provider.model_health?.[model]?.status !== 'unhealthy' &&
  provider.api_key.trim().length > 0;

const validListedModel = (provider: IProvider, model: string): boolean =>
  available(provider, model) && provider.models.includes(model);

const modelHealth = (provider: IProvider, model: string): StudioProviderModelOption['health'] => {
  if (!available(provider, model)) return 'unavailable';
  return provider.model_health?.[model]?.status === 'healthy' ? 'available' : 'unknown';
};

const allRatios = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
const allResolutions = ['720p', '1080p'] as const;
const imageConstraints = (model: string): StudioRouteConstraints => ({
  aspectRatios: [...allRatios],
  resolutions: [...allResolutions],
  minDurationSeconds: 1,
  maxDurationSeconds: 60,
  supportsFirstFrame: !isImagesApiModel(model),
  silentOutput: true,
});

const seedanceConstraints = (model: string): StudioRouteConstraints | null => {
  const spec = getBytePlusSeedanceModelSpec(model);
  return spec
    ? {
        aspectRatios: [...spec.ratios],
        resolutions: [...spec.resolutions],
        minDurationSeconds: spec.minDuration,
        maxDurationSeconds: spec.maxDuration,
        supportsFirstFrame: true,
        silentOutput: true,
      }
    : null;
};

const bindingConstraints = (capabilities: StudioConnectionCapabilities): StudioRouteConstraints | null => {
  if (
    !capabilities.aspectRatios?.length ||
    !capabilities.resolutions?.length ||
    capabilities.minDurationSeconds === undefined ||
    capabilities.maxDurationSeconds === undefined
  )
    return null;
  return {
    aspectRatios: [...capabilities.aspectRatios].toSorted(),
    resolutions: [...capabilities.resolutions].toSorted(),
    minDurationSeconds: capabilities.minDurationSeconds,
    maxDurationSeconds: capabilities.maxDurationSeconds,
    supportsFirstFrame: capabilities.supportsFirstFrame ?? false,
    silentOutput: capabilities.audioModes?.includes('none') ?? false,
  };
};

const canonicalBindingCapabilities = (capabilities: StudioConnectionCapabilities): StudioConnectionCapabilities => ({
  mediaKinds: [...capabilities.mediaKinds].toSorted(),
  ...(capabilities.audioModes ? { audioModes: [...capabilities.audioModes].toSorted() } : {}),
  ...(capabilities.aspectRatios ? { aspectRatios: [...capabilities.aspectRatios].toSorted() } : {}),
  ...(capabilities.resolutions ? { resolutions: [...capabilities.resolutions].toSorted() } : {}),
  ...(capabilities.minDurationSeconds === undefined ? {} : { minDurationSeconds: capabilities.minDurationSeconds }),
  ...(capabilities.maxDurationSeconds === undefined ? {} : { maxDurationSeconds: capabilities.maxDurationSeconds }),
  ...(capabilities.supportsFirstFrame === undefined ? {} : { supportsFirstFrame: capabilities.supportsFirstFrame }),
  ...(capabilities.cancellation === undefined ? {} : { cancellation: capabilities.cancellation }),
});

const routeIdentity = (route: StudioRouteCatalog['automatic'][number]): string =>
  `${route.adapterId}\u0000${route.providerId}\u0000${route.model}\u0000${route.kind}`;

const bindingMediaKind = (binding: StudioConnectionBinding): StudioMediaKind | null => {
  const expected = binding.adapterId === 'weprompt-image-v1' ? 'image' : 'video';
  return binding.capabilities.mediaKinds.length === 1 && binding.capabilities.mediaKinds[0] === expected
    ? expected
    : null;
};

const availableRoute = (
  route: StudioProviderRef,
  routes: StudioRouteCatalog['automatic']
): StudioRouteCatalog['automatic'][number] | null =>
  routes.find(
    (candidate) =>
      candidate.providerId === route.providerId &&
      candidate.adapterId === route.adapterId &&
      candidate.model === route.model
  ) ?? null;

const suggest = (
  kind: StudioMediaKind,
  routes: StudioRouteCatalog['automatic'],
  routing: StudioRoutingPreferences | undefined,
  configuredImage: StudioProviderRef | null
): StudioRouteSuggestion => {
  const compatible = routes.filter((route) => route.kind === kind);
  const prior = routing?.[kind] ? availableRoute(routing[kind]!, compatible) : null;
  if (prior) return { reason: 'last_successful', route: prior };
  if (kind === 'image' && configuredImage && availableRoute(configuredImage, compatible)) {
    return { reason: 'configured_image_model', route: availableRoute(configuredImage, compatible) };
  }
  if (compatible.length === 1) return { reason: 'sole_compatible', route: compatible[0]! };
  return { reason: compatible.length === 0 ? 'no_compatible_route' : 'manual_required', route: null };
};

const configuredRoute = (value: unknown, providers: IProvider[]): StudioProviderRef | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { id?: unknown; use_model?: unknown };
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.use_model !== 'string' ||
    !isSafeProviderId(candidate.id) ||
    !isSafeModel(candidate.use_model)
  )
    return null;
  const provider = providers.find((item) => item.id === candidate.id);
  if (
    !provider ||
    !validListedModel(provider, candidate.use_model) ||
    !isImageGenSupported(provider, candidate.use_model)
  )
    return null;
  return { providerId: provider.id, adapterId: imageAdapter, model: candidate.use_model };
};

/** Resolves fresh AionCore provider rows into renderer-safe connection candidates and routes. */
export const createStudioProviderResolver = (deps: StudioProviderResolverDeps): StudioProviderResolver => {
  const listConnectionCandidates = async (): Promise<StudioConnectionCandidate[]> => {
    const providers = await deps.listProviders();
    return providers
      .filter(
        (provider) => isSafeProviderId(provider.id) && provider.enabled !== false && provider.api_key.trim().length > 0
      )
      .map((provider) => ({
        providerId: provider.id,
        providerName: sanitizedProviderName(provider),
        models: [...new Set(provider.models.filter((model) => isSafeModel(model) && validListedModel(provider, model)))]
          .map((model) => ({ model, health: modelHealth(provider, model) }))
          .toSorted((left, right) => left.model.localeCompare(right.model)),
      }))
      .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
  };

  const listRoutes = async (input: { routing?: StudioRoutingPreferences } = {}): Promise<StudioRouteCatalog> => {
    const [providers, settings, planning, connections] = await Promise.all([
      deps.listProviders(),
      deps.getClientSettings(),
      deps.getPlanningReadiness(),
      deps.listConnections(),
    ]);
    const routes: StudioRouteCatalog['automatic'] = [];
    for (const provider of providers) {
      if (!isSafeProviderId(provider.id)) continue;
      for (const model of provider.models) {
        if (!isSafeModel(model)) continue;
        if (!validListedModel(provider, model)) continue;
        if (isImageGenSupported(provider, model)) {
          routes.push({
            providerId: provider.id,
            providerName: sanitizedProviderName(provider),
            model,
            health: modelHealth(provider, model),
            adapterId: imageAdapter,
            kind: 'image',
            constraints: imageConstraints(model),
          });
        }
      }
    }
    for (const binding of connections) {
      const provider = providers.find((item) => item.id === binding.providerId);
      const kind = bindingMediaKind(binding);
      if (
        !provider ||
        !isSafeProviderId(provider.id) ||
        !isSafeModel(binding.model) ||
        !available(provider, binding.model) ||
        !kind
      )
        continue;
      if (binding.adapterId === imageAdapter && !isImageGenSupported(provider, binding.model)) continue;
      if (binding.adapterId === 'weprompt-media-gateway-v1' && !binding.capabilities.audioModes?.includes('none'))
        continue;
      if (binding.adapterId === 'byteplus-seedance-v1' && !isSupportedBytePlusSeedanceProvider(provider, binding.model))
        continue;
      const constraints =
        binding.adapterId === 'byteplus-seedance-v1'
          ? seedanceConstraints(binding.model)
          : bindingConstraints(binding.capabilities);
      if (!constraints) continue;
      routes.push({
        providerId: binding.providerId,
        providerName: sanitizedProviderName(provider),
        model: binding.model,
        health: modelHealth(provider, binding.model),
        adapterId: binding.adapterId,
        kind,
        constraints,
      });
    }
    const uniqueRoutes = new Map<string, StudioRouteCatalog['automatic'][number]>();
    for (const route of routes) {
      const identity = routeIdentity(route);
      if (!uniqueRoutes.has(identity)) uniqueRoutes.set(identity, route);
    }
    const sortedRoutes = [...uniqueRoutes.values()].toSorted((left, right) =>
      routeIdentity(left).localeCompare(routeIdentity(right))
    );
    const configuredImage = configuredRoute(settings['tools.imageGenerationModel'], providers);
    const providerModels = providers
      .filter((provider) => isSafeProviderId(provider.id))
      .flatMap((provider) =>
        provider.models.filter(isSafeModel).map((model) => ({
          providerId: provider.id,
          providerName: sanitizedProviderName(provider),
          model,
          health: modelHealth(provider, model),
        }))
      )
      .toSorted((left, right) =>
        `${left.providerId}\u0000${left.providerName}\u0000${left.model}`.localeCompare(
          `${right.providerId}\u0000${right.providerName}\u0000${right.model}`
        )
      );
    const stable = {
      automatic: sortedRoutes.map((route) => ({
        providerId: route.providerId,
        providerName: route.providerName,
        adapterId: route.adapterId,
        model: route.model,
        health: route.health,
        kind: route.kind,
        constraints: route.constraints,
      })),
      providerModels,
      bindings: connections
        .map((binding) => ({
          id: binding.id,
          providerId: binding.providerId,
          adapterId: binding.adapterId,
          model: binding.model,
          capabilities: canonicalBindingCapabilities(binding.capabilities),
        }))
        .toSorted((left, right) => left.id.localeCompare(right.id)),
    };
    const safePlanningResolution =
      planning.resolved_model &&
      isSafeProviderId(planning.resolved_model.provider_id) &&
      isSafeModel(planning.resolved_model.model_id)
        ? {
            providerId: planning.resolved_model.provider_id,
            model: planning.resolved_model.model_id,
          }
        : undefined;
    return {
      planning: {
        health: planning.health,
        ...(planning.reason_code ? { reasonCode: planning.reason_code } : {}),
        ...(safePlanningResolution ? { resolvedModel: safePlanningResolution } : {}),
      },
      automatic: sortedRoutes,
      providerModels,
      suggestions: {
        image: suggest('image', sortedRoutes, input.routing, configuredImage),
        video: suggest('video', sortedRoutes, input.routing, configuredImage),
      },
      catalogVersion: createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16),
    };
  };

  return { listConnectionCandidates, listRoutes };
};
