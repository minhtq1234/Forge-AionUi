/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateStudioProjectInput,
  StudioAsset,
  StudioEditableScene,
  StudioJob,
  StudioRendererProject,
  StudioRouteCatalogEntry,
  StudioScene,
  StudioTextModelOption,
  StudioUpdateModelSelectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import type { IProvider } from '@/common/config/storage';
import type { GenerationProviderAdapter } from '@process/services/creative-studio/adapters';
import { STUDIO_E2E_BOUNDARY_SENTINELS } from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import type { CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import {
  createCreativeStudioService,
  type CreativeStudioService,
} from '@process/services/creative-studio/creativeStudioService';
import {
  StudioStoryboardPlannerError,
  type StudioStoryboardPlanner,
} from '@process/services/creative-studio/planning/storyboardPlanner';

const makeInput = (overrides: Partial<CreateStudioProjectInput> = {}): CreateStudioProjectInput => ({
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
  ...overrides,
});

const makeScene = (id: string, durationSeconds = 4): StudioEditableScene => ({
  title: `Scene ${id}`,
  purpose: 'Introduce the product',
  visualPrompt: 'A cinematic studio product reveal',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds,
  referenceAssetId: null,
});

const storyboardProposal = {
  projectSummary: 'A concise product launch story.',
  scenes: [
    {
      title: 'Opening',
      purpose: 'Set the need.',
      visualPrompt: 'A cinematic morning commute.',
      narration: 'Every day starts with a choice.',
      onScreenText: '',
      mediaKind: 'video' as const,
      durationSeconds: 4,
    },
    {
      title: 'Product',
      purpose: 'Show the product.',
      visualPrompt: 'A premium reusable bottle in a studio.',
      narration: '',
      onScreenText: 'Built to last.',
      mediaKind: 'image' as const,
      durationSeconds: 4,
    },
    {
      title: 'Payoff',
      purpose: 'Close the story.',
      visualPrompt: 'Friends share a hilltop sunset.',
      narration: 'Carry better habits forward.',
      onScreenText: 'Refill your future.',
      mediaKind: 'video' as const,
      durationSeconds: 4,
    },
  ],
};

const storyboardOptions: StudioTextModelOption[] = [
  {
    providerId: 'provider_1',
    providerName: 'Provider One',
    model: 'gpt-4o',
    health: 'available',
  },
];

const routeOption = (
  kind: 'image' | 'video',
  overrides: Partial<StudioRouteCatalogEntry> = {}
): StudioRouteCatalogEntry => ({
  providerId: 'provider_1',
  providerName: 'Provider One',
  adapterId: kind === 'image' ? 'weprompt-image-v1' : 'weprompt-media-gateway-v1',
  model: `${kind}-model`,
  health: 'available',
  kind,
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['1080p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 12,
    supportsFirstFrame: true,
    silentOutput: true,
  },
  ...overrides,
});

type SelectionService = CreativeStudioService & {
  updateModelSelection(input: StudioUpdateModelSelectionRequest): Promise<StudioRendererProject>;
};

const makePlanner = (overrides: Partial<StudioStoryboardPlanner> = {}): StudioStoryboardPlanner => ({
  listModels: async () => storyboardOptions,
  draft: async () => storyboardProposal,
  dispose: async () => {},
  ...overrides,
});

const selectStoryboard = (store: ReturnType<typeof createCreativeStudioStore>, project: StudioRendererProject) =>
  store.updateProject(project.id, (current) => ({
    ...current,
    routing: {
      ...current.routing,
      storyboard: { providerId: 'provider_1', model: 'gpt-4o' },
    },
  }));

type StoryboardService = CreativeStudioService & {
  proposeStoryboard(input: {
    projectId: string;
    expectedRevision: number;
    replaceExisting: boolean;
  }): Promise<StudioRendererProject>;
};

describe('CreativeStudioService', () => {
  let rootDir = '';
  let service: CreativeStudioService;
  let onProjectUpdated: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'creative-studio-service-'));
    onProjectUpdated = vi.fn();
    service = createCreativeStudioService({
      store: createCreativeStudioStore({
        rootDir,
        now: () => '2026-07-30T00:00:00.000Z',
        createId: () => 'project_1',
      }),
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
    });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('rejects an update for a missing project instead of creating an orphan manifest', async () => {
    await expect(
      service.updateProject({ projectId: 'missing_project', expectedRevision: 1, name: 'Changed' })
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('validates and delegates every durable generation mutation to the runtime-owned job manager', async () => {
    const job: StudioJob = {
      id: 'job_1',
      projectId: 'project_1',
      sceneId: 'scene_1',
      status: 'failed',
      provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'open-sora' },
      idempotencyKey: 'key_1',
      providerJobId: null,
      outputAssetIds: [],
      error: {
        code: 'provider_unavailable',
        messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      },
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    };
    const submitScenes = vi.fn(async () => []);
    const cancelJob = vi.fn(async () => job);
    const retryJob = vi.fn(async () => job);
    const retryDownload = vi.fn(async () => job);
    const generationStore = createCreativeStudioStore({ rootDir });
    const generationService = createCreativeStudioService({
      store: generationStore,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => ({
          routes: [routeOption('video', { model: 'open-sora' })],
          generationCatalogVersion: 'generation-v1',
        }),
        isGenerationRouteAvailable: async () => true,
      },
      jobManager: {
        submitScenes,
        cancelJob,
        retryJob,
        retryDownload,
        resumePendingJobs: vi.fn(),
        dispose: vi.fn(),
      },
    } as unknown as Parameters<typeof createCreativeStudioService>[0]);
    const project = await generationService.createProject(makeInput());
    const catalog = await generationService.listRoutes({ projectId: project.id });
    const submitInput = {
      projectId: project.id,
      expectedRevision: project.revision,
      sceneIds: ['scene_1'],
      catalogVersion: catalog.catalogVersion,
      routes: [
        {
          sceneId: 'scene_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1' as const,
          model: 'open-sora',
          kind: 'video' as const,
        },
      ],
    };
    const jobInput = { projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 };
    const retryInput = { ...jobInput, acknowledgePossibleDuplicateCharge: true };

    await generationService.submitScenes(submitInput);
    await generationService.cancelJob(jobInput);
    await generationService.retryJob(retryInput);
    await generationService.retryDownload(jobInput);

    expect(submitScenes).toHaveBeenCalledWith({
      ...submitInput,
      catalogVersion: 'generation-v1',
    });
    expect(cancelJob).toHaveBeenCalledWith(jobInput);
    expect(retryJob).toHaveBeenCalledWith(retryInput);
    expect(retryDownload).toHaveBeenCalledWith(jobInput);
  });

  it('rejects invalid job identities and revisions before invoking the job manager', async () => {
    const cancelJob = vi.fn();
    const generationService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      jobManager: {
        submitScenes: vi.fn(),
        cancelJob,
        retryJob: vi.fn(),
        retryDownload: vi.fn(),
        resumePendingJobs: vi.fn(),
        dispose: vi.fn(),
      },
    } as unknown as Parameters<typeof createCreativeStudioService>[0]);

    await expect(
      generationService.cancelJob({ projectId: '../project', jobId: 'job_1', expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      generationService.cancelJob({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 0 })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(cancelJob).not.toHaveBeenCalled();
  });

  it('saves a validation-derived connection without treating it as a successful project route', async () => {
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      createConnectionId: () => 'binding_1',
      validateConnection: async (input) => ({
        schemaVersion: 1,
        id: 'discarded_by_service',
        providerId: input.providerId,
        adapterId: input.adapterId,
        model: input.model,
        capabilities: { mediaKinds: ['video'], audioModes: ['none'] },
        validatedAt: '2026-07-30T00:00:00.000Z',
      }),
    });
    const project = await connectionService.createProject(makeInput());

    const binding = await connectionService.saveConnection({
      providerId: 'provider_1',
      adapterId: 'weprompt-media-gateway-v1',
      model: 'open-sora',
    });

    expect(binding.id).toBe('binding_1');
    expect((await connectionService.getProject(project.id))?.routing.video).toBeNull();
  });

  it('lists and removes a saved binding after the service is recreated over the same store', async () => {
    const originalStore = createCreativeStudioStore({ rootDir });
    await originalStore.saveConnection({
      schemaVersion: 1,
      id: 'binding_stale',
      providerId: 'provider_deleted',
      adapterId: 'weprompt-media-gateway-v1',
      model: 'open-sora',
      capabilities: { mediaKinds: ['video'], audioModes: ['none'] },
      validatedAt: '2026-07-30T00:00:00.000Z',
    });
    const reloaded = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
    });

    await expect(reloaded.listConnections()).resolves.toMatchObject([{ id: 'binding_stale' }]);
    await expect(reloaded.removeConnection({ connectionId: 'binding_stale' })).resolves.toBe(true);
    await expect(reloaded.listConnections()).resolves.toEqual([]);
  });

  it('validates, normalizes, sanitizes, and saves a manual gateway model absent from chat discovery', async () => {
    const validateConnection = vi.fn(async () => ({
      ok: true as const,
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['none'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p'],
        minDurationSeconds: 2,
        maxDurationSeconds: 20,
        supportsFirstFrame: true,
        cancellation: true,
        rawProviderField: STUDIO_E2E_BOUNDARY_SENTINELS,
      },
    }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection,
      validateRequest: () => ({
        ok: true,
        normalized: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 5 },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'job_1' }),
    };
    const manualProvider: IProvider = {
      id: 'provider_1',
      platform: 'custom',
      name: 'Gateway',
      base_url: STUDIO_E2E_BOUNDARY_SENTINELS.providerUrl,
      api_key: STUDIO_E2E_BOUNDARY_SENTINELS.credential,
      models: [],
    };
    Object.assign(manualProvider, STUDIO_E2E_BOUNDARY_SENTINELS);
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      createConnectionId: () => 'binding_manual',
      listProviders: async () => [manualProvider],
      adapterRegistry: new Map([['weprompt-media-gateway-v1', adapter]]),
    });

    const saved = await connectionService.saveConnection({
      providerId: 'provider_1',
      adapterId: 'weprompt-media-gateway-v1',
      model: '  open-sora-manual  ',
    });

    expect(validateConnection).toHaveBeenCalledWith(
      { model: 'open-sora-manual' },
      manualProvider,
      expect.any(AbortSignal)
    );
    expect(saved).toMatchObject({
      id: 'binding_manual',
      model: 'open-sora-manual',
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['none'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p'],
        minDurationSeconds: 2,
        maxDurationSeconds: 20,
        supportsFirstFrame: true,
        cancellation: true,
      },
    });
    expect(saved.capabilities).not.toHaveProperty('rawProviderField');
    const exposedConnections = await connectionService.listConnections();
    const storedConnections = await readFile(path.join(rootDir, 'connections.json'), 'utf8');
    for (const sentinel of Object.values(STUDIO_E2E_BOUNDARY_SENTINELS)) {
      expect(JSON.stringify(saved)).not.toContain(sentinel);
      expect(JSON.stringify(exposedConnections)).not.toContain(sentinel);
      expect(storedConnections).not.toContain(sentinel);
    }
  });

  it('does not validate a manual model after its provider is disabled', async () => {
    const validateConnection = vi.fn();
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      listProviders: async () => [
        {
          id: 'provider_1',
          platform: 'custom',
          name: 'Gateway',
          base_url: 'https://gateway.example',
          api_key: 'secret',
          models: [],
          enabled: false,
        },
      ],
      adapterRegistry: new Map([
        [
          'weprompt-media-gateway-v1',
          {
            id: 'weprompt-media-gateway-v1',
            validateConnection,
            validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
            submit: async () => ({ kind: 'remote' as const, providerJobId: 'never' }),
          },
        ],
      ]),
    });

    await expect(
      connectionService.validateConnection({
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1',
        model: 'open-sora-manual',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(validateConnection).not.toHaveBeenCalled();
  });

  it('maps resolver dependency failures to a provider error', async () => {
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      providerResolver: {
        listConnectionCandidates: async () => {
          throw new Error('provider backend unavailable');
        },
        listGenerationRoutes: async () => {
          throw new Error('settings backend unavailable');
        },
        isGenerationRouteAvailable: async () => false,
      },
    });

    await expect(connectionService.listConnectionCandidates()).rejects.toMatchObject({ code: 'provider_error' });
    await expect(connectionService.listRoutes()).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('composes the fresh planner and generation catalogs for a project', async () => {
    const listModels = vi.fn(async () => storyboardOptions);
    const listGenerationRoutes = vi.fn(async () => ({
      routes: [routeOption('image')],
      generationCatalogVersion: 'generation-v1',
    }));
    const routed = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      storyboardPlanner: makePlanner({ listModels }),
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes,
        isGenerationRouteAvailable: async () => false,
      },
    });
    const project = await routed.createProject(makeInput());

    const catalog = await routed.listRoutes({ projectId: project.id });

    expect(catalog.storyboard.options).toEqual(storyboardOptions);
    expect(catalog.image.options).toHaveLength(1);
    expect(listModels).toHaveBeenCalledOnce();
    expect(listGenerationRoutes).toHaveBeenCalledOnce();
  });

  it('rejects metadata outside renderer bounds instead of persisting oversized text', async () => {
    const project = await service.createProject(makeInput());

    await expect(
      service.updateProject({
        projectId: project.id,
        expectedRevision: project.revision,
        brief: 'x'.repeat(16 * 1024 + 1),
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects stale revisions instead of overwriting a newer project edit', async () => {
    const project = await service.createProject(makeInput());
    await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Newer launch film',
    });

    await expect(
      service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'Late launch film' })
    ).rejects.toMatchObject({ code: 'stale_project' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects a stale delete instead of deleting a project changed by another editor', async () => {
    const project = await service.createProject(makeInput());
    await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Newer launch film',
    });

    await expect(
      service.deleteProject({ projectId: project.id, expectedRevision: project.revision })
    ).rejects.toMatchObject({
      code: 'stale_project',
    } satisfies Partial<CreativeStudioStoreError>);
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: 'Newer launch film' });
  });

  it("upserts one bounded scene while retaining the project's canonical scene order", async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });

    expect(updated.sceneOrder).toEqual(['scene_1']);
    expect(updated.scenes.scene_1?.visualPrompt).toBe('A cinematic studio product reveal');
    expect(updated.scenes.scene_1).toMatchObject({
      id: 'scene_1',
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: 'ready',
    });
  });

  it('keeps a newly created scene draft when it has no usable visual prompt', async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: { ...makeScene('scene_1'), visualPrompt: '   ' },
    });

    expect(updated.scenes.scene_1.reviewState).toBe('draft');
  });

  it('preserves main-owned scene history while applying renderer-editable fields', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withHistory = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_1 = {
          id: 'asset_1',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'assets', fileName: 'asset_1.mp4' },
          byteSize: 1,
          sha256: '1'.repeat(64),
          durationSeconds: 4,
          createdAt: next.createdAt,
        };
        next.jobs.job_1 = {
          id: 'job_1',
          projectId: next.id,
          sceneId: 'scene_1',
          status: 'succeeded',
          provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'model_1' },
          idempotencyKey: 'key_1',
          providerJobId: 'remote_1',
          outputAssetIds: ['asset_1'],
          error: null,
          retryOfJobId: null,
          retryReason: null,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
          createdAt: next.createdAt,
          updatedAt: next.updatedAt,
        };
        next.scenes.scene_1.assetIds = ['asset_1'];
        next.scenes.scene_1.jobIds = ['job_1'];
        next.scenes.scene_1.selectedAssetId = 'asset_1';
        next.scenes.scene_1.reviewState = 'complete';
        return next;
      },
      withScene.revision
    );

    const updated = await service.updateScene({
      projectId: withHistory.id,
      expectedRevision: withHistory.revision,
      sceneId: 'scene_1',
      scene: { ...makeScene('scene_1'), title: 'Edited title' },
    });

    expect(updated.scenes.scene_1).toMatchObject({
      id: 'scene_1',
      title: 'Edited title',
      assetIds: ['asset_1'],
      jobIds: ['job_1'],
      selectedAssetId: 'asset_1',
      reviewState: 'complete',
    });
  });

  it('blocks media-kind changes while a scene has any nonterminal job', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withPendingJob = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.jobs.job_1 = {
          id: 'job_1',
          projectId: next.id,
          sceneId: 'scene_1',
          status: 'needs_attention',
          provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'model_1' },
          idempotencyKey: 'key_1',
          providerJobId: null,
          outputAssetIds: [],
          error: {
            code: 'submission_unknown',
            messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
          },
          retryOfJobId: null,
          retryReason: null,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
          createdAt: next.createdAt,
          updatedAt: next.updatedAt,
        };
        next.scenes.scene_1.jobIds = ['job_1'];
        next.scenes.scene_1.reviewState = 'blocked';
        return next;
      },
      withScene.revision
    );

    await expect(
      service.updateScene({
        projectId: withPendingJob.id,
        expectedRevision: withPendingJob.revision,
        sceneId: 'scene_1',
        scene: { ...makeScene('scene_1'), mediaKind: 'image' },
      })
    ).rejects.toMatchObject({ code: 'busy' });
  });

  it('validates reference ownership and clears only an incompatible selection on an allowed kind change', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withAssets = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_video = {
          id: 'asset_video',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'assets', fileName: 'asset_video.mp4' },
          byteSize: 1,
          sha256: '2'.repeat(64),
          durationSeconds: 4,
          createdAt: next.createdAt,
        };
        next.assets.asset_reference = {
          id: 'asset_reference',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'asset_reference.png' },
          byteSize: 1,
          sha256: '3'.repeat(64),
          createdAt: next.createdAt,
        };
        next.scenes.scene_1.assetIds = ['asset_video', 'asset_reference'];
        next.scenes.scene_1.selectedAssetId = 'asset_video';
        next.scenes.scene_1.reviewState = 'complete';
        return next;
      },
      withScene.revision
    );

    const changed = await service.updateScene({
      projectId: withAssets.id,
      expectedRevision: withAssets.revision,
      sceneId: 'scene_1',
      scene: {
        ...makeScene('scene_1'),
        mediaKind: 'image',
        referenceAssetId: 'asset_reference',
      },
    });
    expect(changed.scenes.scene_1).toMatchObject({
      selectedAssetId: null,
      referenceAssetId: 'asset_reference',
      reviewState: 'ready',
      assetIds: ['asset_video', 'asset_reference'],
    });

    await expect(
      service.updateScene({
        projectId: changed.id,
        expectedRevision: changed.revision,
        sceneId: 'scene_1',
        scene: { ...makeScene('scene_1'), mediaKind: 'image', referenceAssetId: 'missing_asset' },
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('omits provider identities and idempotency keys from every service project and job result', async () => {
    const internalJob: StudioJob = {
      id: 'job_1',
      projectId: 'project_1',
      sceneId: 'scene_1',
      status: 'queued_remote',
      provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'model_1' },
      idempotencyKey: 'secret_idempotency_key',
      providerJobId: STUDIO_E2E_BOUNDARY_SENTINELS.providerJobId,
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    };
    const nonRetryableDownloadJob: StudioJob = {
      ...internalJob,
      id: 'job_without_remote_identity',
      status: 'failed',
      providerJobId: null,
      error: {
        code: 'download_failed',
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      },
    };
    const retryableDownloadJob: StudioJob = {
      ...nonRetryableDownloadJob,
      id: 'job_with_remote_identity',
      providerJobId: 'secret_download_remote_id',
    };
    const projectStore = createCreativeStudioStore({ rootDir, createId: () => 'project_1' });
    const created = await projectStore.createProject(makeInput());
    await projectStore.updateProject(created.id, (current) => {
      const next = structuredClone(current);
      next.scenes.scene_1 = {
        id: 'scene_1',
        ...makeScene('scene_1'),
        selectedAssetId: null,
        assetIds: [],
        jobIds: ['job_1'],
        reviewState: 'generating',
      };
      next.sceneOrder = ['scene_1'];
      next.jobs.job_1 = internalJob;
      return next;
    });
    Object.assign(internalJob, STUDIO_E2E_BOUNDARY_SENTINELS);
    const submitScenes = vi.fn(async () => [internalJob]);
    const cancelJob = vi.fn(async () => internalJob);
    const retryJob = vi.fn(async () => nonRetryableDownloadJob);
    const retryDownload = vi.fn(async () => retryableDownloadJob);
    const rendererService = createCreativeStudioService({
      store: projectStore,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => ({
          routes: [routeOption('video', { model: 'model_1' })],
          generationCatalogVersion: 'generation-v1',
        }),
        isGenerationRouteAvailable: async () => true,
      },
      jobManager: {
        submitScenes,
        cancelJob,
        retryJob,
        retryDownload,
        resumePendingJobs: vi.fn(),
        dispose: vi.fn(),
      },
    } as unknown as Parameters<typeof createCreativeStudioService>[0]);

    const forgedProject = (await projectStore.getProject('project_1'))!;
    Object.assign(forgedProject.jobs.job_1, STUDIO_E2E_BOUNDARY_SENTINELS);
    (forgedProject.scenes.scene_1 as StudioScene & { providerJobId?: string }).providerJobId = 'scene-provider-secret';
    forgedProject.assets.asset_1 = {
      id: 'asset_1',
      projectId: 'project_1',
      sceneId: 'scene_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
      byteSize: 1,
      sha256: '1'.repeat(64),
      createdAt: forgedProject.createdAt,
      idempotencyKey: 'asset-provider-secret',
      sourcePath: STUDIO_E2E_BOUNDARY_SENTINELS.rawOutputPath,
    } as StudioAsset & { idempotencyKey: string; sourcePath: string };
    forgedProject.assets.asset_poster = {
      id: 'asset_poster',
      projectId: 'project_1',
      sceneId: 'scene_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'thumbnails', fileName: 'asset_poster.png' },
      byteSize: 1,
      sha256: '2'.repeat(64),
      createdAt: forgedProject.createdAt,
      sourceUrl: STUDIO_E2E_BOUNDARY_SENTINELS.providerUrl,
    } as StudioAsset & { sourceUrl: string };
    forgedProject.jobs.job_1.outputAssetIds = ['asset_1', 'asset_poster'];
    forgedProject.scenes.scene_1.assetIds = ['asset_1', 'asset_poster'];
    forgedProject.scenes.scene_1.selectedAssetId = 'asset_1';
    vi.spyOn(projectStore, 'getProject').mockResolvedValueOnce(forgedProject);

    const projectResult = await rendererService.getProject('project_1');
    const updatedProjectResult = await rendererService.updateProject({
      projectId: 'project_1',
      expectedRevision: 2,
      name: 'Renderer-safe project',
    });
    const catalog = await rendererService.listRoutes({ projectId: 'project_1' });
    const jobResults = [
      await rendererService.submitScenes({
        projectId: 'project_1',
        expectedRevision: 3,
        sceneIds: ['scene_1'],
        catalogVersion: catalog.catalogVersion,
        routes: [
          {
            sceneId: 'scene_1',
            providerId: 'provider_1',
            adapterId: 'weprompt-media-gateway-v1',
            model: 'model_1',
            kind: 'video',
          },
        ],
      }),
      await rendererService.cancelJob({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 }),
      await rendererService.retryJob({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 }),
      await rendererService.retryDownload({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 }),
    ];

    expect(projectResult?.jobs.job_1).not.toHaveProperty('providerJobId');
    expect(projectResult?.jobs.job_1).not.toHaveProperty('idempotencyKey');
    expect(projectResult?.jobs.job_1.canRetryDownload).toBe(false);
    expect(projectResult?.scenes.scene_1).not.toHaveProperty('providerJobId');
    expect(projectResult?.assets.asset_1).not.toHaveProperty('idempotencyKey');
    expect(projectResult?.jobs.job_1.outputAssetIds).toEqual(['asset_1', 'asset_poster']);
    expect(projectResult?.assets.asset_poster.managedAsset.collection).toBe('thumbnails');
    expect(projectResult?.assets.asset_1).not.toHaveProperty('sourcePath');
    expect(projectResult?.assets.asset_poster).not.toHaveProperty('sourceUrl');
    expect(updatedProjectResult.jobs.job_1).not.toHaveProperty('providerJobId');
    expect(updatedProjectResult.jobs.job_1).not.toHaveProperty('idempotencyKey');
    const sanitizedJobResults = jobResults.flat();
    expect(sanitizedJobResults.map((result) => result.canRetryDownload)).toEqual([false, false, false, true]);
    for (const result of sanitizedJobResults) {
      expect(result).not.toHaveProperty('providerJobId');
      expect(result).not.toHaveProperty('idempotencyKey');
    }
    const rendererPayloads = JSON.stringify([projectResult, updatedProjectResult, sanitizedJobResults]);
    for (const sentinel of Object.values(STUDIO_E2E_BOUNDARY_SENTINELS)) {
      expect(rendererPayloads).not.toContain(sentinel);
    }
  });

  it('rejects a reordered list that is not an exact project scene permutation', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });

    await expect(
      service.reorderScenes({
        projectId: withScene.id,
        expectedRevision: withScene.revision,
        sceneOrder: ['scene_1', 'scene_1'],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects selecting an asset from another scene instead of crossing scene ownership', async () => {
    const project = await service.createProject(makeInput());
    const withFirstScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const withBothScenes = await service.updateScene({
      projectId: withFirstScene.id,
      expectedRevision: withFirstScene.revision,
      sceneId: 'scene_2',
      scene: makeScene('scene_2'),
    });
    const withAsset = await service.updateProject({
      projectId: withBothScenes.id,
      expectedRevision: withBothScenes.revision,
      name: withBothScenes.name,
    });
    const assetProject = await createCreativeStudioStore({ rootDir }).updateProject(
      withAsset.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_2 = {
          id: 'asset_2',
          projectId: next.id,
          sceneId: 'scene_2',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'assets', fileName: 'asset_2.png' },
          byteSize: 1,
          sha256: '1'.repeat(64),
          createdAt: next.createdAt,
        };
        next.scenes.scene_2.assetIds = ['asset_2'];
        return next;
      },
      withAsset.revision
    );

    await expect(
      service.selectAsset({
        projectId: assetProject.id,
        expectedRevision: assetProject.revision,
        sceneId: 'scene_1',
        assetId: 'asset_2',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects selecting a historical asset whose media kind differs from the scene', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withImage = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_image = {
          id: 'asset_image',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'assets', fileName: 'asset_image.png' },
          byteSize: 1,
          sha256: '4'.repeat(64),
          createdAt: next.createdAt,
        };
        next.scenes.scene_1.assetIds = ['asset_image'];
        return next;
      },
      withScene.revision
    );

    await expect(
      service.selectAsset({
        projectId: withImage.id,
        expectedRevision: withImage.revision,
        sceneId: 'scene_1',
        assetId: 'asset_image',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('serializes concurrent expected-revision edits instead of applying a stale scene change', async () => {
    const project = await service.createProject(makeInput());

    const results = await Promise.allSettled([
      service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'Edited launch film' }),
      service.updateScene({
        projectId: project.id,
        expectedRevision: project.revision,
        sceneId: 'scene_1',
        scene: makeScene('scene_1'),
      }),
    ]);

    const persisted = await service.getProject(project.id);
    expect(persisted?.name).toBe('Edited launch film');
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('emits only the project id after successful mutation and does not emit for reads or rejected mutations', async () => {
    const project = await service.createProject(makeInput());

    expect(onProjectUpdated).toHaveBeenLastCalledWith(project.id);
    onProjectUpdated.mockClear();
    await service.getProject(project.id);
    expect(onProjectUpdated).not.toHaveBeenCalled();
    await service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'Saved update' });
    expect(onProjectUpdated).toHaveBeenCalledWith(project.id);
    onProjectUpdated.mockClear();

    await expect(
      service.updateProject({ projectId: project.id, expectedRevision: 99, name: 'Rejected update' })
    ).rejects.toMatchObject({ code: 'stale_project' } satisfies Partial<CreativeStudioStoreError>);

    expect(onProjectUpdated).not.toHaveBeenCalled();
  });

  it('maps a freshly unavailable stored model without calling the provider', async () => {
    const draft = vi.fn();
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({ listModels: async () => [], draft }),
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    await expect(
      storyboardService.proposeStoryboard({
        projectId: project.id,
        expectedRevision: selected.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: 'planning_unavailable' });
    expect(draft).not.toHaveBeenCalled();
  });

  it.each([
    ['model_unavailable', 'planning_unavailable'],
    ['busy', 'busy'],
    ['provider_auth_failed', 'provider_error'],
    ['provider_rate_limited', 'provider_error'],
    ['provider_timeout', 'provider_error'],
    ['provider_request_failed', 'provider_error'],
    ['canceled', 'provider_error'],
    ['invalid_output', 'provider_error'],
  ] as const)('maps planner %s outcomes to the redacted Studio %s result', async (plannerCode, studioCode) => {
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({
        draft: async () => {
          throw new StudioStoryboardPlannerError(plannerCode);
        },
      }),
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    await expect(
      storyboardService.proposeStoryboard({
        projectId: project.id,
        expectedRevision: selected.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: studioCode });
  });

  it('refuses to replace an existing storyboard before invoking the planner', async () => {
    const runner = vi.fn();
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_existing',
      scene: makeScene('scene_existing'),
    });
    const storyboardService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      storyboardPlanner: makePlanner({ draft: runner }),
      createSceneId: () => 'scene_1',
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    await expect(
      storyboardService.proposeStoryboard({
        projectId: withScene.id,
        expectedRevision: withScene.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: 'storyboard_exists' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects duplicate scene identities without committing a partial storyboard', async () => {
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      createSceneId: () => 'scene_duplicate',
    });

    await expect(
      storyboardService.proposeStoryboard({
        projectId: selected.id,
        expectedRevision: selected.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(storyboardService.getProject(selected.id)).resolves.toMatchObject({
      revision: selected.revision,
      scenes: {},
    });
  });

  it('replaces an existing storyboard only after a complete replacement proposal validates', async () => {
    const runner = vi.fn(async () => storyboardProposal);
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_existing',
      scene: makeScene('scene_existing'),
    });
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, withScene);
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({ draft: runner }),
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    const drafted = await storyboardService.proposeStoryboard({
      projectId: withScene.id,
      expectedRevision: selected.revision,
      replaceExisting: true,
    });

    expect(drafted.sceneOrder).toEqual(['scene_1', 'scene_2', 'scene_3']);
    expect(drafted.scenes).not.toHaveProperty('scene_existing');
  });

  it('hydrates canonical draft scenes and emits exactly one update after a successful proposal', async () => {
    const runner = vi.fn(async () => storyboardProposal);
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    onProjectUpdated.mockClear();
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({ draft: runner }),
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    const drafted = await storyboardService.proposeStoryboard({
      projectId: project.id,
      expectedRevision: selected.revision,
      replaceExisting: false,
    });

    expect(drafted.sceneOrder).toEqual(['scene_1', 'scene_2', 'scene_3']);
    expect(drafted.scenes.scene_1).toMatchObject({
      assetIds: [],
      jobIds: [],
      referenceAssetId: null,
      selectedAssetId: null,
    });
    expect(onProjectUpdated).toHaveBeenCalledOnce();
  });

  it('discards a late proposal when a concurrent project mutation changes the captured revision', async () => {
    let release!: (result: typeof storyboardProposal) => void;
    const runner = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({ draft: runner }),
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;
    const proposed = storyboardService.proposeStoryboard({
      projectId: project.id,
      expectedRevision: selected.revision,
      replaceExisting: false,
    });

    await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce());
    const edited = await service.updateProject({
      projectId: project.id,
      expectedRevision: selected.revision,
      name: 'Edited while planning',
    });
    release(storyboardProposal);

    await expect(proposed).rejects.toMatchObject({ code: 'stale_project' });
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: edited.name, scenes: {} });
  });

  describe('unified model catalog', () => {
    const createCatalogHarness = async (
      options: {
        models?: StudioTextModelOption[];
        routes?: StudioRouteCatalogEntry[];
      } = {}
    ) => {
      const store = createCreativeStudioStore({ rootDir });
      const listModels = vi.fn(async () => options.models ?? storyboardOptions);
      const draft = vi.fn(async () => storyboardProposal);
      const planner: StudioStoryboardPlanner = {
        listModels,
        draft,
        dispose: vi.fn(async () => {}),
      };
      const listGenerationRoutes = vi.fn(async () => ({
        routes: options.routes ?? [routeOption('image'), routeOption('video')],
        generationCatalogVersion: 'generation-v1',
      }));
      const submitScenes = vi.fn(async () => []);
      const catalogService = createCreativeStudioService({
        store,
        onProjectUpdated,
        storyboardPlanner: planner,
        providerResolver: {
          listConnectionCandidates: async () => [],
          listGenerationRoutes,
          isGenerationRouteAvailable: async () => true,
        },
        jobManager: {
          submitScenes,
          cancelJob: vi.fn(),
          retryJob: vi.fn(),
          retryDownload: vi.fn(),
          resumePendingJobs: vi.fn(),
          dispose: vi.fn(),
        },
        createSceneId: (() => {
          let index = 0;
          return () => `draft_scene_${++index}`;
        })(),
      } as unknown as Parameters<typeof createCreativeStudioService>[0]) as SelectionService;
      const project = await catalogService.createProject(makeInput());
      return {
        store,
        service: catalogService,
        project,
        planner,
        listModels,
        draft,
        listGenerationRoutes,
        submitScenes,
      };
    };

    it('persists only a freshly available storyboard selection', async () => {
      const harness = await createCatalogHarness();
      const requested = {
        providerId: 'provider_1',
        model: 'gpt-4o',
        authorization: 'must-not-persist',
      };

      const updated = await harness.service.updateModelSelection({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        role: 'storyboard',
        selection: requested,
      });

      expect(updated.routing.storyboard).toEqual({ providerId: 'provider_1', model: 'gpt-4o' });
    });

    it('keeps a removed persisted model visible as unavailable without falling back', async () => {
      const harness = await createCatalogHarness();
      await harness.store.updateProject(harness.project.id, (current) => ({
        ...current,
        routing: {
          ...current.routing,
          storyboard: { providerId: 'removed', model: 'old-model' },
        },
      }));

      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });

      expect(catalog.storyboard).toMatchObject({
        status: 'unavailable',
        selected: { providerId: 'removed', model: 'old-model' },
      });
    });

    it('projects storyboard options to safe public fields before returning the catalog', async () => {
      const harness = await createCatalogHarness();
      harness.listModels.mockResolvedValue([
        {
          providerId: 'provider_1',
          providerName: 'Provider\u0000 One',
          model: 'gpt-4o',
          health: 'available',
          authorization: 'must-not-cross-main',
        },
        {
          providerId: '../unsafe',
          providerName: 'Unsafe',
          model: 'unsafe-model',
          health: 'available',
        },
        {
          providerId: 'provider_2',
          providerName: 'Unsafe model',
          model: 'bad\nmodel',
          health: 'available',
        },
      ]);

      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });

      expect(catalog.storyboard.options).toEqual([
        {
          providerId: 'provider_1',
          providerName: 'Provider One',
          model: 'gpt-4o',
          health: 'available',
        },
      ]);
      expect(JSON.stringify(catalog)).not.toMatch(/authorization|must-not-cross-main|\.\.\/unsafe|bad\\nmodel/i);
    });

    it('rejects a media selection whose kind or exact adapter identity does not match the role', async () => {
      const harness = await createCatalogHarness();

      await expect(
        harness.service.updateModelSelection({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          role: 'image',
          selection: {
            providerId: 'provider_1',
            adapterId: 'weprompt-media-gateway-v1',
            model: 'video-model',
          },
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });
    });

    it('filters media options against every current scene before allowing selection', async () => {
      const harness = await createCatalogHarness();
      const withScene = await harness.service.updateScene({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneId: 'scene_long',
        scene: makeScene('scene_long', 20),
      });

      const catalog = await harness.service.listRoutes({ projectId: withScene.id });
      expect(catalog.video).toMatchObject({ status: 'setup_required', options: [] });
      await expect(
        harness.service.updateModelSelection({
          projectId: withScene.id,
          expectedRevision: withScene.revision,
          role: 'video',
          selection: {
            providerId: 'provider_1',
            adapterId: 'weprompt-media-gateway-v1',
            model: 'video-model',
          },
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });
    });

    it('filters routes by project format, reference support, health, and silent output', async () => {
      const harness = await createCatalogHarness({
        routes: [
          routeOption('video', {
            model: 'aspect-model',
            constraints: { ...routeOption('video').constraints, aspectRatios: ['1:1'] },
          }),
          routeOption('video', {
            model: 'resolution-model',
            constraints: { ...routeOption('video').constraints, resolutions: ['720p'] },
          }),
          routeOption('video', { model: 'unavailable-model', health: 'unavailable' }),
          routeOption('video', {
            model: 'audio-model',
            constraints: { ...routeOption('video').constraints, silentOutput: false },
          }),
          routeOption('video', {
            model: 'no-reference-model',
            constraints: { ...routeOption('video').constraints, supportsFirstFrame: false },
          }),
        ],
      });
      const referenced = await harness.store.updateProject(harness.project.id, (current) => ({
        ...current,
        sceneOrder: ['scene_reference'],
        scenes: {
          scene_reference: {
            id: 'scene_reference',
            ...makeScene('scene_reference'),
            referenceAssetId: 'asset_reference',
            selectedAssetId: null,
            assetIds: ['asset_reference'],
            jobIds: [],
            reviewState: 'ready',
          },
        },
        assets: {
          asset_reference: {
            id: 'asset_reference',
            projectId: current.id,
            sceneId: 'scene_reference',
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'imports', fileName: 'asset_reference.png' },
            byteSize: 1,
            sha256: 'a'.repeat(64),
            createdAt: current.createdAt,
          },
        },
      }));

      const catalog = await harness.service.listRoutes({ projectId: referenced.id });

      expect(catalog.video.options).toEqual([]);
    });

    it('clears a selection while preserving optimistic revision checks', async () => {
      const harness = await createCatalogHarness();
      const beforeSelection = await harness.service.listRoutes({ projectId: harness.project.id });
      const selected = await harness.service.updateModelSelection({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        role: 'storyboard',
        selection: { providerId: 'provider_1', model: 'gpt-4o' },
      });
      const afterSelection = await harness.service.listRoutes({ projectId: selected.id });

      const cleared = await harness.service.updateModelSelection({
        projectId: selected.id,
        expectedRevision: selected.revision,
        role: 'storyboard',
        selection: null,
      });

      expect(cleared.routing.storyboard).toBeNull();
      expect(afterSelection.catalogVersion).toBe(beforeSelection.catalogVersion);
      await expect(
        harness.service.updateModelSelection({
          projectId: selected.id,
          expectedRevision: selected.revision,
          role: 'storyboard',
          selection: null,
        })
      ).rejects.toMatchObject({ code: 'stale_project' });
    });

    it('rejects a selection mutation for a missing project', async () => {
      const harness = await createCatalogHarness();

      await expect(
        harness.service.updateModelSelection({
          projectId: 'missing_project',
          expectedRevision: 1,
          role: 'storyboard',
          selection: null,
        })
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('maps planner or generation catalog failures to provider_error', async () => {
      const harness = await createCatalogHarness();
      harness.listModels.mockRejectedValueOnce(new Error('planner unavailable'));
      await expect(harness.service.listRoutes({ projectId: harness.project.id })).rejects.toMatchObject({
        code: 'provider_error',
      });

      harness.listGenerationRoutes.mockRejectedValueOnce(new Error('generation unavailable'));
      await expect(harness.service.listRoutes({ projectId: harness.project.id })).rejects.toMatchObject({
        code: 'provider_error',
      });
    });

    it('rejects paid submission when the reviewed unified catalog changed', async () => {
      const harness = await createCatalogHarness();
      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });
      harness.listModels.mockResolvedValue([
        ...storyboardOptions,
        {
          providerId: 'provider_2',
          providerName: 'Provider Two',
          model: 'new-model',
          health: 'available',
        },
      ]);

      await expect(
        harness.service.submitScenes({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          sceneIds: ['scene_1'],
          routes: [
            {
              sceneId: 'scene_1',
              providerId: 'provider_1',
              adapterId: 'weprompt-image-v1',
              model: 'image-model',
              kind: 'image',
            },
          ],
          catalogVersion: catalog.catalogVersion,
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });
      expect(harness.submitScenes).not.toHaveBeenCalled();
    });

    it('drafts with the canonical stored storyboard model only', async () => {
      const harness = await createCatalogHarness();
      const selectedProject = await harness.store.updateProject(harness.project.id, (current) => ({
        ...current,
        routing: {
          ...current.routing,
          storyboard: { providerId: 'provider_1', model: 'gpt-4o' },
        },
      }));

      await harness.service.proposeStoryboard({
        projectId: harness.project.id,
        expectedRevision: selectedProject.revision,
        replaceExisting: false,
      });

      expect(harness.draft).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: harness.project.id,
          projectRevision: selectedProject.revision,
        }),
        { providerId: 'provider_1', model: 'gpt-4o' }
      );
    });

    it('does not call a provider when the stored storyboard selection is absent', async () => {
      const harness = await createCatalogHarness();

      await expect(
        harness.service.proposeStoryboard({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          replaceExisting: false,
        })
      ).rejects.toMatchObject({ code: 'planning_unavailable' });
      expect(harness.draft).not.toHaveBeenCalled();
    });
  });
});
