/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import type { StudioConnectionCapabilities } from '@/common/types/project/creativeStudioTypes';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';

const provider = (overrides: Partial<IProvider> = {}): IProvider => ({
  id: 'provider_1',
  platform: 'gemini',
  name: 'Image provider',
  base_url: 'https://example.invalid/v1',
  api_key: 'never-return-this',
  models: ['gemini-2.5-flash-image'],
  ...overrides,
});

const gatewayCapabilities = (overrides: Partial<StudioConnectionCapabilities> = {}): StudioConnectionCapabilities => ({
  mediaKinds: ['video'],
  audioModes: ['none'],
  aspectRatios: ['16:9', '9:16'],
  resolutions: ['720p', '1080p'],
  minDurationSeconds: 2,
  maxDurationSeconds: 30,
  supportsFirstFrame: false,
  cancellation: false,
  ...overrides,
});

describe('createStudioProviderResolver', () => {
  it('uses the current enabled image route before configured or sole candidates', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider()],
      getClientSettings: async () => ({
        'tools.imageGenerationModel': { id: 'provider_1', use_model: 'gemini-2.5-flash-image' },
      }),
      getPlanningReadiness: async () => ({
        setting: { mode: 'auto' },
        health: 'ready',
        resolved_model: { provider_id: 'planning_provider', model_id: 'planner' },
      }),
      listConnections: async () => [],
    });

    const catalog = await resolver.listRoutes({
      routing: {
        image: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'gemini-2.5-flash-image' },
        video: null,
      },
    });

    expect(catalog.planning).toEqual({
      health: 'ready',
      resolvedModel: { providerId: 'planning_provider', model: 'planner' },
    });
    expect(catalog.suggestions.image).toMatchObject({
      reason: 'last_successful',
      route: { providerId: 'provider_1' },
    });
    expect(JSON.stringify(catalog)).not.toContain('never-return-this');
    expect(JSON.stringify(catalog)).not.toContain('example.invalid');
  });

  it('keeps generation routes available when planning readiness cannot be loaded', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ models: ['media-model'], platform: 'custom' })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => {
        throw new Error('planning backend unavailable');
      },
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'media-model',
          capabilities: gatewayCapabilities(),
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    await expect(resolver.listRoutes()).resolves.toMatchObject({
      planning: { health: 'unavailable' },
      automatic: [
        expect.objectContaining({
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'media-model',
          kind: 'video',
        }),
      ],
      suggestions: {
        video: {
          reason: 'sole_compatible',
          route: expect.objectContaining({ model: 'media-model' }),
        },
      },
    });
  });

  it('does not use disabled or unhealthy models and has a stable version without timestamps', async () => {
    const make = () =>
      createStudioProviderResolver({
        listProviders: async () => [
          provider({ model_health: { 'gemini-2.5-flash-image': { status: 'unhealthy', last_check: Date.now() } } }),
        ],
        getClientSettings: async () => ({}),
        getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'unavailable' }),
        listConnections: async () => [],
      });

    const first = await make().listRoutes();
    const second = await make().listRoutes();
    expect(first.suggestions.image).toEqual({ reason: 'no_compatible_route', route: null });
    expect(first.catalogVersion).toBe(second.catalogVersion);
  });

  it('exposes gateway video from an explicitly saved binding while preserving unknown health', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ models: ['media-model'], platform: 'custom' })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'setup_required' }),
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'media-model',
          capabilities: gatewayCapabilities(),
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    const catalog = await resolver.listRoutes();
    expect(catalog.automatic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'media-model',
          providerName: 'Image provider',
          health: 'unknown',
        }),
      ])
    );
    expect(catalog.suggestions.video.reason).toBe('sole_compatible');
  });

  it('ignores a tampered gateway binding that advertises an incompatible image media kind', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ models: ['media-model'], platform: 'custom' })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_tampered',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'media-model',
          capabilities: gatewayCapabilities({ mediaKinds: ['image'] }),
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    const catalog = await resolver.listRoutes();
    expect(catalog.automatic).toEqual([]);
    expect(catalog.suggestions.image.reason).toBe('no_compatible_route');
    expect(catalog.suggestions.video.reason).toBe('no_compatible_route');
  });

  it('ignores a saved image binding whose model is not supported by the image engine', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ models: ['gemini-2.5-pro'] })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_text_model',
          providerId: 'provider_1',
          adapterId: 'weprompt-image-v1',
          model: 'gemini-2.5-pro',
          capabilities: { mediaKinds: ['image'] },
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    const catalog = await resolver.listRoutes();
    expect(catalog.automatic).toEqual([]);
    expect(catalog.suggestions.image).toEqual({ reason: 'no_compatible_route', route: null });
  });

  it.each([
    ['ready', undefined],
    ['checking', undefined],
    ['setup_required', 'no_eligible_model'],
    ['unavailable', 'health_check_failed'],
  ] as const)('preserves the App Operations %s planning state', async (health, reasonCode) => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({
        setting: { mode: 'auto' },
        health,
        ...(reasonCode ? { reason_code: reasonCode } : {}),
      }),
      listConnections: async () => [],
    });

    await expect(resolver.listRoutes()).resolves.toMatchObject({
      planning: { health, ...(reasonCode ? { reasonCode } : {}) },
    });
  });

  it('uses configured image, sole compatibility, manual choice, and no route in the documented order', async () => {
    const imageModels = ['gemini-2.5-flash-image', 'gemini-3-pro-image-1x1'];
    const configured = createStudioProviderResolver({
      listProviders: async () => [provider({ models: imageModels })],
      getClientSettings: async () => ({
        'tools.imageGenerationModel': { id: 'provider_1', use_model: imageModels[1] },
      }),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [],
    });
    expect((await configured.listRoutes()).suggestions.image).toMatchObject({
      reason: 'configured_image_model',
      route: { model: imageModels[1] },
    });

    const sole = createStudioProviderResolver({
      listProviders: async () => [provider()],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [],
    });
    expect((await sole.listRoutes()).suggestions.image.reason).toBe('sole_compatible');

    const manual = createStudioProviderResolver({
      listProviders: async () => [provider({ models: imageModels })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [],
    });
    expect((await manual.listRoutes()).suggestions.image).toEqual({ reason: 'manual_required', route: null });

    const absent = createStudioProviderResolver({
      listProviders: async () => [provider({ api_key: '', models: imageModels })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [],
    });
    expect((await absent.listRoutes()).suggestions.image).toEqual({ reason: 'no_compatible_route', route: null });
  });

  it('deduplicates an explicitly saved image binding from the automatic image route', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider()],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_image',
          providerId: 'provider_1',
          adapterId: 'weprompt-image-v1',
          model: 'gemini-2.5-flash-image',
          capabilities: { mediaKinds: ['image'], supportsFirstFrame: true },
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    const catalog = await resolver.listRoutes();
    expect(catalog.automatic).toHaveLength(1);
    expect(catalog.suggestions.image.reason).toBe('sole_compatible');
  });

  it('routes and recovers an explicitly validated image model absent from chat model discovery', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ models: [] })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_manual_image',
          providerId: 'provider_1',
          adapterId: 'weprompt-image-v1',
          model: 'gemini-2.5-flash-image',
          capabilities: { mediaKinds: ['image'], supportsFirstFrame: true },
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    await expect(resolver.listRoutes()).resolves.toMatchObject({
      automatic: [
        expect.objectContaining({
          adapterId: 'weprompt-image-v1',
          model: 'gemini-2.5-flash-image',
          kind: 'image',
        }),
      ],
    });
    await expect(
      resolver.isGenerationRouteAvailable({
        providerId: 'provider_1',
        adapterId: 'weprompt-image-v1',
        model: 'gemini-2.5-flash-image',
        kind: 'image',
      })
    ).resolves.toBe(true);
  });

  it('refreshes every catalog dependency, filters unsafe candidates, and versions only durable availability state', async () => {
    let providers = [provider({ model_health: { 'gemini-2.5-flash-image': { status: 'healthy', last_check: 1 } } })];
    let connections = [
      {
        schemaVersion: 1 as const,
        id: 'binding_1',
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1' as const,
        model: 'gemini-2.5-flash-image',
        capabilities: gatewayCapabilities({ minDurationSeconds: 4 }),
        validatedAt: 'first',
      },
    ];
    const listProviders = vi.fn(async () => providers);
    const getClientSettings = vi.fn(async () => ({}));
    const getPlanningReadiness = vi.fn(async () => ({ setting: { mode: 'auto' as const }, health: 'ready' as const }));
    const resolver = createStudioProviderResolver({
      listProviders,
      getClientSettings,
      getPlanningReadiness,
      listConnections: async () => connections,
    });
    const first = await resolver.listRoutes();
    connections = [
      {
        ...connections[0]!,
        capabilities: gatewayCapabilities({ minDurationSeconds: 5 }),
        validatedAt: 'second',
      },
    ];
    const changedCapabilities = await resolver.listRoutes();
    expect(changedCapabilities.catalogVersion).not.toBe(first.catalogVersion);
    connections = [{ ...connections[0]!, id: 'binding_rebound' }];
    const changedBinding = await resolver.listRoutes();
    expect(changedBinding.catalogVersion).not.toBe(changedCapabilities.catalogVersion);
    connections = [{ ...connections[0]!, validatedAt: 'third' }];
    const timestampOnly = await resolver.listRoutes();
    expect(timestampOnly.catalogVersion).toBe(changedBinding.catalogVersion);
    connections = [
      {
        ...connections[0]!,
        capabilities: gatewayCapabilities({ minDurationSeconds: 4 }),
        validatedAt: 'fourth',
      },
    ];
    const restoredCapability = await resolver.listRoutes();
    expect(restoredCapability.catalogVersion).not.toBe(timestampOnly.catalogVersion);
    providers = [provider({ model_enabled: { 'gemini-2.5-flash-image': false } })];
    const disabled = await resolver.listRoutes();
    expect(disabled.catalogVersion).not.toBe(first.catalogVersion);
    expect(await resolver.listConnectionCandidates()).toEqual([
      {
        providerId: 'provider_1',
        providerName: 'Image provider',
        models: [],
      },
    ]);
    expect(listProviders).toHaveBeenCalledTimes(7);
    expect(getClientSettings).toHaveBeenCalledTimes(6);
    expect(getPlanningReadiness).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(first)).not.toMatch(/never-return-this|example\.invalid|api_key|base_url|path|url/i);
  });

  it('keeps credential rows available for manual media models even when chat discovery is empty', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ models: [] })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [],
    });

    await expect(resolver.listConnectionCandidates()).resolves.toEqual([
      {
        providerId: 'provider_1',
        providerName: 'Image provider',
        models: [],
      },
    ]);
  });

  it('filters unsafe provider and model identities and omits unsafe planning resolution fields', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [
        provider({ id: '../unsafe', models: ['gemini-2.5-flash-image'] }),
        provider({
          id: 'provider_safe',
          name: 'Safe\u0000 provider',
          models: ['gemini-2.5-flash-image', `image-${'x'.repeat(260)}`, 'bad\nmodel'],
        }),
      ],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({
        setting: { mode: 'auto' },
        health: 'ready',
        resolved_model: { provider_id: '../planning', model_id: 'planner\nmodel' },
      }),
      listConnections: async () => [],
    });

    const candidates = await resolver.listConnectionCandidates();
    const catalog = await resolver.listRoutes();

    expect(candidates).toEqual([
      {
        providerId: 'provider_safe',
        providerName: 'Safe provider',
        models: [{ model: 'gemini-2.5-flash-image', health: 'unknown' }],
      },
    ]);
    expect(catalog.planning).toEqual({ health: 'ready' });
    expect(catalog.automatic).toEqual([
      expect.objectContaining({
        providerId: 'provider_safe',
        providerName: 'Safe provider',
        model: 'gemini-2.5-flash-image',
      }),
    ]);
    expect(catalog.providerModels).toEqual([
      {
        providerId: 'provider_safe',
        providerName: 'Safe provider',
        model: 'gemini-2.5-flash-image',
        health: 'unknown',
      },
    ]);
    expect(JSON.stringify({ candidates, catalog })).not.toMatch(/\.\.\/unsafe|bad\\nmodel|Safe\\u0000/);
  });

  it('retains a stale saved binding but excludes it when its provider is deleted', async () => {
    const bindings = [
      {
        schemaVersion: 1 as const,
        id: 'binding_1',
        providerId: 'deleted_provider',
        adapterId: 'weprompt-media-gateway-v1' as const,
        model: 'open-sora',
        capabilities: { mediaKinds: ['video' as const], audioModes: ['none'] },
        validatedAt: '2026-07-30T00:00:00.000Z',
      },
    ];
    const resolver = createStudioProviderResolver({
      listProviders: async () => [],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'setup_required' }),
      listConnections: async () => bindings,
    });

    expect((await resolver.listRoutes()).automatic).toEqual([]);
    expect(bindings).toHaveLength(1);
  });

  it('marks missing health unknown and changes the catalog version when the provider becomes unavailable', async () => {
    let enabled = true;
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ platform: 'custom', models: ['manual-video-model'], enabled })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [],
    });
    const available = await resolver.listRoutes();
    enabled = false;
    const unavailable = await resolver.listRoutes();

    expect(available.automatic).toEqual([]);
    expect(available.providerModels).toMatchObject([{ health: 'unknown' }]);
    expect(unavailable.providerModels).toMatchObject([{ health: 'unavailable' }]);
    expect(unavailable.catalogVersion).not.toBe(available.catalogVersion);
  });

  it('maps only explicitly healthy models to available and versions the health transition', async () => {
    let model_health: IProvider['model_health'];
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ model_health })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [],
    });

    const missing = await resolver.listRoutes();
    model_health = { 'gemini-2.5-flash-image': { status: 'unknown', last_check: 1 } };
    const unknown = await resolver.listRoutes();
    model_health = { 'gemini-2.5-flash-image': { status: 'healthy', last_check: 2 } };
    const healthy = await resolver.listRoutes();
    model_health = { 'gemini-2.5-flash-image': { status: 'unhealthy', last_check: 3 } };
    const unhealthy = await resolver.listRoutes();

    expect(missing.providerModels).toMatchObject([{ health: 'unknown' }]);
    expect(unknown.providerModels).toMatchObject([{ health: 'unknown' }]);
    expect(healthy.providerModels).toMatchObject([{ health: 'available' }]);
    expect(unhealthy.providerModels).toMatchObject([{ health: 'unavailable' }]);
    expect(missing.catalogVersion).toBe(unknown.catalogVersion);
    expect(healthy.catalogVersion).not.toBe(unknown.catalogVersion);
    expect(unhealthy.catalogVersion).not.toBe(healthy.catalogVersion);
  });

  it('exposes exact Seedance model constraints while adapter request tests remain canonical for request validation', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [
        provider({
          id: 'seedance_provider',
          platform: 'custom',
          base_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
          models: ['seedance-1-0-pro-250528', 'seedance-1-5-pro-251215', 'dreamina-seedance-2-0-260128'],
        }),
      ],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () =>
        ['seedance-1-0-pro-250528', 'seedance-1-5-pro-251215', 'dreamina-seedance-2-0-260128'].map((model, index) => ({
          schemaVersion: 1 as const,
          id: `binding_${index}`,
          providerId: 'seedance_provider',
          adapterId: 'byteplus-seedance-v1' as const,
          model,
          capabilities: { mediaKinds: ['video' as const], audioModes: ['none'] },
          validatedAt: '2026-07-30T00:00:00.000Z',
        })),
    });

    const automatic = (await resolver.listRoutes()).automatic;
    expect(automatic.find((entry) => entry.model === 'seedance-1-0-pro-250528')?.constraints).toMatchObject({
      minDurationSeconds: 2,
      maxDurationSeconds: 12,
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    });
    expect(automatic.find((entry) => entry.model === 'seedance-1-5-pro-251215')?.constraints).toMatchObject({
      minDurationSeconds: 4,
      maxDurationSeconds: 12,
      resolutions: ['720p', '1080p'],
    });
    expect(automatic.find((entry) => entry.model === 'dreamina-seedance-2-0-260128')?.constraints).toMatchObject({
      minDurationSeconds: 4,
      maxDurationSeconds: 15,
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    });
  });

  it('marks images-API routes as not supporting a first frame', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [
        provider({
          platform: 'openai',
          base_url: 'https://api.vngcloud.vn/v1',
          models: ['gpt-image-1'],
          capabilities: [{ type: 'image_generation' }],
        }),
      ],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [],
    });

    expect((await resolver.listRoutes()).automatic[0]?.constraints.supportsFirstFrame).toBe(false);
  });

  it('routes an explicitly validated manual gateway model absent from chat model discovery', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ platform: 'custom', models: [] })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_manual',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'open-sora-manual',
          capabilities: gatewayCapabilities({ supportsFirstFrame: false }),
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    await expect(resolver.listRoutes()).resolves.toMatchObject({
      automatic: [
        expect.objectContaining({
          model: 'open-sora-manual',
          constraints: expect.objectContaining({ supportsFirstFrame: false }),
        }),
      ],
    });
  });

  it('versions health changes for a manual bound model absent from chat model discovery', async () => {
    let model_health: IProvider['model_health'];
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ platform: 'custom', models: [], model_health })],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_manual',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'open-sora-manual',
          capabilities: gatewayCapabilities(),
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    const missing = await resolver.listRoutes();
    model_health = { 'open-sora-manual': { status: 'unknown', last_check: 1 } };
    const unknown = await resolver.listRoutes();
    model_health = { 'open-sora-manual': { status: 'healthy', last_check: 2 } };
    const healthy = await resolver.listRoutes();

    expect(missing.automatic).toMatchObject([{ health: 'unknown' }]);
    expect(healthy.automatic).toMatchObject([{ health: 'available' }]);
    expect(missing.catalogVersion).toBe(unknown.catalogVersion);
    expect(healthy.catalogVersion).not.toBe(unknown.catalogVersion);
  });

  it('routes an explicitly validated manual Seedance model absent from chat model discovery', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [
        provider({
          platform: 'custom',
          base_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
          models: [],
        }),
      ],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_manual_seedance',
          providerId: 'provider_1',
          adapterId: 'byteplus-seedance-v1',
          model: 'dreamina-seedance-2-0-260128',
          capabilities: {
            mediaKinds: ['video'],
            audioModes: ['none'],
            supportsFirstFrame: true,
          },
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    await expect(resolver.listRoutes()).resolves.toMatchObject({
      automatic: [expect.objectContaining({ model: 'dreamina-seedance-2-0-260128' })],
    });
  });

  it('keeps catalog hashing stable across provider binding and capability-order permutations', async () => {
    const providers = [provider({ id: 'provider_a', name: 'A' }), provider({ id: 'provider_b', name: 'B' })];
    const connections = [
      {
        schemaVersion: 1 as const,
        id: 'binding_a',
        providerId: 'provider_a',
        adapterId: 'weprompt-media-gateway-v1' as const,
        model: 'gemini-2.5-flash-image',
        capabilities: {
          ...gatewayCapabilities({ supportsFirstFrame: true }),
        },
        validatedAt: 'first',
      },
    ];
    const make = (reverse: boolean) =>
      createStudioProviderResolver({
        listProviders: async () => (reverse ? providers.toReversed() : providers),
        getClientSettings: async () => ({}),
        getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
        listConnections: async () =>
          reverse
            ? connections.map((binding) => ({
                ...binding,
                capabilities: {
                  cancellation: binding.capabilities.cancellation,
                  supportsFirstFrame: binding.capabilities.supportsFirstFrame,
                  resolutions: binding.capabilities.resolutions.toReversed(),
                  aspectRatios: binding.capabilities.aspectRatios.toReversed(),
                  audioModes: binding.capabilities.audioModes,
                  mediaKinds: binding.capabilities.mediaKinds,
                  minDurationSeconds: binding.capabilities.minDurationSeconds,
                  maxDurationSeconds: binding.capabilities.maxDurationSeconds,
                },
              }))
            : connections,
      });

    expect((await make(false).listRoutes()).catalogVersion).toBe((await make(true).listRoutes()).catalogVersion);
  });

  it('drops a saved Seedance binding after the provider host no longer matches the exact adapter', async () => {
    const resolver = createStudioProviderResolver({
      listProviders: async () => [
        provider({
          platform: 'custom',
          base_url: 'https://ark.ap-southeast.bytepluses.com.evil.test/api/v3',
          models: [],
        }),
      ],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_seedance',
          providerId: 'provider_1',
          adapterId: 'byteplus-seedance-v1',
          model: 'seedance-1-5-pro-251215',
          capabilities: { mediaKinds: ['video'], audioModes: ['none'], supportsFirstFrame: true },
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    expect((await resolver.listRoutes()).automatic).toEqual([]);
  });

  it('checks a durable generation route without depending on planning or client settings', async () => {
    const getClientSettings = vi.fn(async () => {
      throw new Error('settings unavailable');
    });
    const getPlanningReadiness = vi.fn(async () => {
      throw new Error('planning unavailable');
    });
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider({ models: ['media-model'], platform: 'custom' })],
      getClientSettings,
      getPlanningReadiness,
      listConnections: async () => [
        {
          schemaVersion: 1,
          id: 'binding_recovery',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'media-model',
          capabilities: gatewayCapabilities(),
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
    });

    await expect(
      resolver.isGenerationRouteAvailable({
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1',
        model: 'media-model',
        kind: 'video',
      })
    ).resolves.toBe(true);
    expect(getClientSettings).not.toHaveBeenCalled();
    expect(getPlanningReadiness).not.toHaveBeenCalled();
  });
});
