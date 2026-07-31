/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import type { StudioProject, StudioRouteConstraints, StudioScene } from '@/common/types/project/creativeStudioTypes';
import type { StudioGenerationRouteCatalog } from '@process/services/creative-studio/providerResolver';
import type {
  GenerationProviderAdapter,
  ProviderJobSnapshot,
  ProviderSubmitResult,
} from '@process/services/creative-studio/adapters';
import {
  createStudioJobManager,
  type StudioJobManager,
  type StudioResolvedSceneRouteSnapshot,
} from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore, type StudioMediaStore } from '@process/services/creative-studio/mediaStore';
import { createCreativeStudioStore, type CreativeStudioStore } from '@process/services/creative-studio/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const mp4 = Buffer.from('000000186674797069736f6d00000000', 'hex');

const provider: IProvider = {
  id: 'provider_1',
  platform: 'openai',
  name: 'Image provider',
  base_url: 'https://provider.example/v1',
  api_key: 'secret',
  models: ['image-model'],
};

const route: StudioResolvedSceneRouteSnapshot = {
  sceneId: 'scene_1',
  providerId: provider.id,
  adapterId: 'weprompt-image-v1',
  model: 'image-model',
  kind: 'image',
};

const selectionFor = (candidate: StudioResolvedSceneRouteSnapshot) => ({
  providerId: candidate.providerId,
  adapterId: candidate.adapterId,
  model: candidate.model,
});

const incompatibleConstraints: Array<[string, Partial<StudioRouteConstraints>]> = [
  ['aspect ratio', { aspectRatios: ['1:1'] }],
  ['resolution', { resolutions: ['1080p'] }],
  ['minimum duration', { minDurationSeconds: 6 }],
  ['maximum duration', { maxDurationSeconds: 4 }],
];

const catalog = (routes: StudioResolvedSceneRouteSnapshot[] = [route]): StudioGenerationRouteCatalog => ({
  routes: routes.map((candidate) => ({
    providerId: candidate.providerId,
    providerName: 'Provider',
    model: candidate.model,
    health: 'available',
    adapterId: candidate.adapterId,
    kind: candidate.kind,
    constraints: {
      aspectRatios: ['16:9'],
      resolutions: ['720p'],
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      supportsFirstFrame: true,
      silentOutput: true,
    },
  })),
  generationCatalogVersion: 'catalog_1',
});

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene_1',
  title: 'Opening',
  purpose: 'Introduce the product',
  visualPrompt: 'A paper airplane crossing a sunrise',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
  ...overrides,
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const waitFor = async (assertion: () => void | Promise<void>): Promise<void> => {
  let latestError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      latestError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw latestError;
};

type Harness = {
  rootDir: string;
  store: CreativeStudioStore;
  mediaStore: StudioMediaStore;
  project: StudioProject;
  manager: StudioJobManager;
};

const harnesses: Harness[] = [];

type HarnessOptions = {
  scenes?: StudioScene[];
  routes?: StudioResolvedSceneRouteSnapshot[];
  provider?: IProvider;
  jobIds?: string[];
  idempotencyKeys?: string[];
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  jitterMs?: (baseMs: number, attempt: number) => number;
  catalog?: () => Promise<StudioGenerationRouteCatalog>;
  decorateMediaStore?: (mediaStore: StudioMediaStore) => StudioMediaStore;
  onProjectUpdated?: (projectId: string) => void;
};

const sequence = (values: string[]): (() => string) => {
  let index = 0;
  return () => values[index++] ?? `generated_${index}`;
};

const createHarness = async (adapter: GenerationProviderAdapter, options: HarnessOptions = {}): Promise<Harness> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-job-manager-'));
  const store = createCreativeStudioStore({ rootDir });
  const scenes = options.scenes ?? [scene()];
  const routes = options.routes ?? [route];
  const selectedProvider = options.provider ?? provider;
  const selectedRoute = (kind: StudioResolvedSceneRouteSnapshot['kind']) => {
    const candidate = routes.find((routeCandidate) => routeCandidate.kind === kind);
    return candidate ? selectionFor(candidate) : null;
  };
  const created = await store.createProject({
    name: 'Launch film',
    brief: 'A concise launch story',
    aspectRatio: '16:9',
    targetDurationSeconds: scenes.reduce((total, candidate) => total + candidate.durationSeconds, 0),
    resolution: '720p',
  });
  const project = await store.updateProject(created.id, (current) => ({
    ...current,
    sceneOrder: scenes.map((candidate) => candidate.id),
    scenes: Object.fromEntries(scenes.map((candidate) => [candidate.id, candidate])),
    routing: {
      storyboard: selectedRoute('storyboard'),
      image: selectedRoute('image'),
      video: selectedRoute('video'),
    },
  }));
  const mediaStore = createStudioMediaStore({ store });
  const managerMediaStore = options.decorateMediaStore?.(mediaStore) ?? mediaStore;
  const manager = createStudioJobManager({
    store,
    mediaStore: managerMediaStore,
    providerResolver: {
      listConnectionCandidates: async () => [],
      listGenerationRoutes: options.catalog ?? (async () => catalog(routes)),
      isGenerationRouteAvailable: async (candidate) =>
        routes.some(
          (available) =>
            available.providerId === candidate.providerId &&
            available.adapterId === candidate.adapterId &&
            available.model === candidate.model &&
            available.kind === candidate.kind
        ),
    },
    adapters: new Map([[adapter.id, adapter]]),
    listProviders: async () => [selectedProvider],
    createJobId: sequence(options.jobIds ?? ['job_1']),
    createIdempotencyKey: sequence(options.idempotencyKeys ?? ['key_1']),
    sleep: options.sleep,
    jitterMs: options.jitterMs ?? ((baseMs) => baseMs),
    ...(options.onProjectUpdated === undefined ? {} : { onProjectUpdated: options.onProjectUpdated }),
  });
  const harness = { rootDir, store, mediaStore, project, manager };
  harnesses.push(harness);
  return harness;
};

afterEach(async () => {
  await Promise.all(
    harnesses.splice(0).map(async (harness) => {
      await harness.manager.dispose();
      await rm(harness.rootDir, { recursive: true, force: true });
    })
  );
});

describe('StudioJobManager durable submission', () => {
  it('persists the local job and idempotency key before adapter submission begins', async () => {
    const submission = deferred<ProviderSubmitResult>();
    let observedProject: StudioProject | null = null;
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async (request) => {
        observedProject = await store.getProject(project.id);
        expect(request.idempotencyKey).toBe('key_1');
        return submission.promise;
      },
    };
    const { store, project, manager } = await createHarness(adapter);

    const jobs = await manager.submitScenes({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });

    expect(jobs).toMatchObject([{ id: 'job_1', idempotencyKey: 'key_1', status: 'queued_local' }]);
    await waitFor(() => expect(observedProject?.jobs.job_1.status).toBe('submitting'));
    expect(observedProject?.scenes.scene_1.jobIds).toContain('job_1');
    submission.reject(new Error('transport interrupted'));
    await waitFor(async () =>
      expect((await store.getProject(project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        error: { code: 'submission_unknown' },
      })
    );
  });

  it('rejects another paid submission while the scene already has active generation work', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => submission.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const active = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.submitScenes({
        projectId: active.id,
        expectedRevision: active.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'busy' });
    expect(submit).toHaveBeenCalledOnce();

    submission.reject(new Error('transport interrupted'));
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('needs_attention')
    );
  });

  it('persists the remote identity before polling and uses the exact capped backoff schedule', async () => {
    const observedProviderIds: Array<string | null | undefined> = [];
    const delays: number[] = [];
    let outputPath = '';
    let harness!: Harness;
    let pollCount = 0;
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_1' }),
      poll: async () => {
        observedProviderIds.push((await harness.store.getProject(harness.project.id))?.jobs.job_1.providerJobId);
        pollCount += 1;
        if (pollCount < 5) return { status: 'queued' };
        return {
          status: 'succeeded',
          outputs: [
            {
              mediaKind: 'image',
              role: 'primary',
              source: { kind: 'file', path: outputPath },
              mimeType: 'image/png',
            },
          ],
        };
      },
    };
    harness = await createHarness(adapter, {
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });
    outputPath = path.join(harness.rootDir, 'generated.png');
    await writeFile(outputPath, png);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    expect(observedProviderIds).toEqual(['remote_1', 'remote_1', 'remote_1', 'remote_1', 'remote_1']);
    expect(delays).toEqual([2_000, 4_000, 8_000, 15_000, 15_000]);
  });

  it('requires attention when a remote identity cannot be persisted after provider acceptance', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => submission.promise,
    };
    const harness = await createHarness(adapter);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('submitting')
    );
    vi.spyOn(harness.store, 'updateProject').mockRejectedValueOnce(new Error('disk write interrupted'));

    submission.resolve({ kind: 'remote', providerJobId: 'remote_accepted' });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: null,
        error: { code: 'submission_unknown' },
      })
    );
  });

  it('retries the safety transition when both remote-ID persistence and its first attention write fail', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => submission.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    vi.spyOn(harness.store, 'updateProject')
      .mockRejectedValueOnce(new Error('remote identity write failed'))
      .mockRejectedValueOnce(new Error('first safety write failed'));

    submission.resolve({ kind: 'remote', providerJobId: 'remote_accepted' });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: null,
        error: { code: 'submission_unknown' },
      })
    );
  });

  it('preserves ambiguous submit safety when the first attention write fails transiently', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => submission.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('submitting')
    );
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    vi.spyOn(harness.store, 'updateProject').mockRejectedValueOnce(new Error('transient safety-write failure'));

    submission.reject(new Error('transport interrupted after request write'));

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: null,
        error: { code: 'submission_unknown' },
      })
    );
  });

  it('preserves durable remote safety when the first poll-error write fails transiently', async () => {
    const polled = deferred<ProviderJobSnapshot>();
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_write_retry' }));
    const poll = vi.fn(async () => polled.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());
    vi.spyOn(harness.store, 'updateProject').mockRejectedValueOnce(new Error('transient safety-write failure'));

    polled.reject(Object.assign(new Error('poll transport lost'), { code: 'timeout' }));

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: 'remote_write_retry',
        error: { code: 'unknown' },
      })
    );
    expect(submit).toHaveBeenCalledOnce();
  });

  it('surfaces provider catalog outages without mislabeling them as storage failures', async () => {
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
    };
    const harness = await createHarness(adapter, {
      catalog: async () => {
        throw new Error('provider API unavailable');
      },
    });

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'provider_error' });

    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
  });
});

describe('StudioJobManager route and reference isolation', () => {
  const adapterWithSubmit = (submit: ReturnType<typeof vi.fn>): GenerationProviderAdapter => ({
    id: 'weprompt-image-v1',
    validateConnection: async () => ({ ok: true }),
    validateRequest: (request) => ({
      ok: true,
      normalized: {
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        durationSeconds: request.durationSeconds,
      },
    }),
    submit,
  });

  it('rejects a submitted route that differs from the project model selection', async () => {
    const selected = { providerId: provider.id, adapterId: route.adapterId, model: 'image-a' };
    const selectedRoute = { sceneId: route.sceneId, kind: route.kind, ...selected };
    const submitted = { ...selectedRoute, model: 'image-b' };
    const selectedProvider = { ...provider, models: ['image-a', 'image-b'] };
    const harness = await createHarness(adapterWithSubmit(vi.fn()), {
      routes: [selectedRoute, submitted],
      provider: selectedProvider,
    });
    const project = await harness.store.updateProject(harness.project.id, (current) => ({
      ...current,
      routing: { ...current.routing, image: selected },
    }));

    await expect(
      harness.manager.submitScenes({
        projectId: project.id,
        expectedRevision: project.revision,
        sceneIds: ['scene_1'],
        routes: [submitted],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('rejects a new submission when its scene media kind has no project selection', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn()));
    const project = await harness.store.updateProject(harness.project.id, (current) => ({
      ...current,
      routing: { ...current.routing, image: null },
    }));

    await expect(
      harness.manager.submitScenes({
        projectId: project.id,
        expectedRevision: project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('rejects a route whose media kind differs from the scene selection', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn()));

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [{ ...route, kind: 'video' }],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('rejects an unavailable project selection even when the submitted route matches it', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn()), {
      catalog: async () => catalog([]),
    });

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('rejects a matching selection when the submitted catalog version is stale', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn()), {
      catalog: async () => ({ ...catalog(), generationCatalogVersion: 'catalog_2' }),
    });

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('accepts a route that exactly matches the current project selection', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn(async () => ({ kind: 'complete', outputs: [] }))));

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).resolves.toMatchObject([{ provider: selectionFor(route) }]);
  });

  it.each(incompatibleConstraints)(
    'rejects a canonical route with incompatible %s before submit',
    async (_, override) => {
      const submit = vi.fn();
      const harness = await createHarness(adapterWithSubmit(submit), {
        catalog: async () => {
          const result = catalog();
          result.routes[0]!.constraints = {
            ...result.routes[0]!.constraints,
            ...override,
          };
          return result;
        },
      });

      await expect(
        harness.manager.submitScenes({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          sceneIds: ['scene_1'],
          routes: [route],
          catalogVersion: 'catalog_1',
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });

      expect(submit).not.toHaveBeenCalled();
      expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
    }
  );

  it('rejects a scene that belongs to a different project before submit', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit));
    const foreignCreated = await harness.store.createProject({
      name: 'Foreign project',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    await harness.store.updateProject(foreignCreated.id, (project) => ({
      ...project,
      sceneOrder: ['foreign_scene'],
      scenes: { foreign_scene: scene({ id: 'foreign_scene' }) },
    }));

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['foreign_scene'],
        routes: [{ ...route, sceneId: 'foreign_scene' }],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects cross-project and foreign-scene references before resolving provider media', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit));
    const resolveProviderInput = vi.spyOn(harness.mediaStore, 'resolveProviderInput');
    const getProject = vi.spyOn(harness.store, 'getProject');

    for (const mismatch of [
      { projectId: 'foreign_project', sceneId: 'scene_1' },
      { projectId: harness.project.id, sceneId: 'foreign_scene' },
    ]) {
      const forged = structuredClone(harness.project);
      forged.assets.asset_reference = {
        id: 'asset_reference',
        projectId: mismatch.projectId,
        sceneId: mismatch.sceneId,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'asset_reference.png' },
        byteSize: png.length,
        sha256: '1'.repeat(64),
        createdAt: forged.createdAt,
      };
      forged.scenes.scene_1.referenceAssetId = 'asset_reference';
      getProject.mockResolvedValueOnce(forged);

      await expect(
        harness.manager.submitScenes({
          projectId: forged.id,
          expectedRevision: forged.revision,
          sceneIds: ['scene_1'],
          routes: [route],
          catalogVersion: 'catalog_1',
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });
    }

    expect(resolveProviderInput).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects unsupported and oversized first frames before submit', async () => {
    const submit = vi.fn();
    let supportsFirstFrame = false;
    const harness = await createHarness(adapterWithSubmit(submit), {
      catalog: async () => {
        const result = catalog();
        result.routes[0]!.constraints.supportsFirstFrame = supportsFirstFrame;
        return result;
      },
    });
    const sourcePath = path.join(harness.rootDir, 'reference.png');
    await writeFile(sourcePath, png);
    const imported = await harness.mediaStore.importReferenceFromPath({
      projectId: harness.project.id,
      sceneId: 'scene_1',
      sourcePath,
      expectedRevision: harness.project.revision,
    });
    const withReference = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.submitScenes({
        projectId: withReference.id,
        expectedRevision: withReference.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(submit).not.toHaveBeenCalled();

    supportsFirstFrame = true;
    const resolveProviderInput = harness.mediaStore.resolveProviderInput.bind(harness.mediaStore);
    vi.spyOn(harness.mediaStore, 'resolveProviderInput').mockImplementation(async (projectId, assetId) => ({
      ...(await resolveProviderInput(projectId, assetId)),
      byteSize: 30 * 1024 * 1024 + 1,
    }));
    await expect(
      harness.manager.submitScenes({
        projectId: withReference.id,
        expectedRevision: withReference.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    expect(imported.id).toBe(withReference.scenes.scene_1.referenceAssetId);
    expect(submit).not.toHaveBeenCalled();
    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
  });

  it('serializes deletion behind durable submission and refuses the active project atomically', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => submission.promise);
    const harness = await createHarness(adapterWithSubmit(submit));
    const updateEnqueued = deferred<void>();
    const updateProject = harness.store.updateProject.bind(harness.store);
    let intercepted = false;
    vi.spyOn(harness.store, 'updateProject').mockImplementation((projectId, mutate, expectedRevision) => {
      const update = updateProject(projectId, mutate, expectedRevision);
      if (!intercepted) {
        intercepted = true;
        updateEnqueued.resolve(undefined);
      }
      return update;
    });

    const submitted = harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await updateEnqueued.promise;
    const deletion = harness.store.deleteProject(harness.project.id, harness.project.revision);

    await expect(submitted).resolves.toMatchObject([{ id: 'job_1', status: 'queued_local' }]);
    await expect(deletion).rejects.toMatchObject({ code: 'busy' });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    submission.reject(Object.assign(new Error('provider rejected'), { code: 'no_output' }));
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('failed')
    );
  });
});

describe('StudioJobManager scheduling', () => {
  it.each([
    { kind: 'image' as const, adapterId: 'weprompt-image-v1' as const, capacity: 2, count: 3 },
    { kind: 'video' as const, adapterId: 'weprompt-media-gateway-v1' as const, capacity: 1, count: 2 },
  ])('runs $kind work FIFO with global capacity $capacity', async ({ kind, adapterId, capacity, count }) => {
    const selectedProvider: IProvider = {
      ...provider,
      models: [`${kind}-model`],
    };
    const scenes = Array.from({ length: count }, (_, index) =>
      scene({
        id: `scene_${index + 1}`,
        title: `Scene ${index + 1}`,
        visualPrompt: `prompt_${index + 1}`,
        mediaKind: kind,
        durationSeconds: kind === 'video' ? 4 : 2,
      })
    );
    const routes = scenes.map(
      (candidate): StudioResolvedSceneRouteSnapshot => ({
        sceneId: candidate.id,
        providerId: selectedProvider.id,
        adapterId,
        model: `${kind}-model`,
        kind,
      })
    );
    const gates: Array<Deferred<ProviderSubmitResult>> = [];
    const started: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const adapter: GenerationProviderAdapter = {
      id: adapterId,
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async (request) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        started.push(request.prompt);
        const gate = deferred<ProviderSubmitResult>();
        gates.push(gate);
        try {
          return await gate.promise;
        } finally {
          active -= 1;
        }
      },
    };
    const harness = await createHarness(adapter, {
      scenes,
      routes,
      provider: selectedProvider,
      jobIds: scenes.map((_, index) => `job_${index + 1}`),
      idempotencyKeys: scenes.map((_, index) => `key_${index + 1}`),
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: scenes.map((candidate) => candidate.id),
      routes,
      catalogVersion: 'catalog_1',
    });

    await waitFor(() => expect(started).toHaveLength(capacity));
    expect(started).toEqual(scenes.slice(0, capacity).map((candidate) => candidate.visualPrompt));
    gates[0]!.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(() => expect(started).toHaveLength(Math.min(count, capacity + 1)));
    expect(started).toEqual(scenes.slice(0, Math.min(count, capacity + 1)).map((candidate) => candidate.visualPrompt));
    expect(maximumActive).toBe(capacity);
    for (const gate of gates) gate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(async () => {
      const current = await harness.store.getProject(harness.project.id);
      expect(Object.values(current?.jobs ?? {}).every((job) => job.status === 'failed')).toBe(true);
    });
  });

  it('isolates identical local job IDs that belong to different projects', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-job-project-isolation-'));
    const store = createCreativeStudioStore({ rootDir });
    const createProject = async (name: string): Promise<StudioProject> => {
      const created = await store.createProject({
        name,
        brief: '',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      return store.updateProject(created.id, (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: { scene_1: scene() },
        routing: { ...project.routing, image: selectionFor(route) },
      }));
    };
    const [firstProject, secondProject] = await Promise.all([createProject('First'), createProject('Second')]);
    const gates: Array<Deferred<ProviderSubmitResult>> = [];
    const submit = vi.fn(async () => {
      const gate = deferred<ProviderSubmitResult>();
      gates.push(gate);
      return gate.promise;
    });
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const mediaStore = createStudioMediaStore({ store });
    const manager = createStudioJobManager({
      store,
      mediaStore,
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => catalog(),
        isGenerationRouteAvailable: async () => true,
      },
      adapters: new Map([['weprompt-image-v1', adapter]]),
      listProviders: async () => [provider],
      createJobId: () => 'job_same',
      createIdempotencyKey: sequence(['key_1', 'key_2']),
    });
    harnesses.push({ rootDir, store, mediaStore, project: firstProject, manager });

    await Promise.all(
      [firstProject, secondProject].map((project) =>
        manager.submitScenes({
          projectId: project.id,
          expectedRevision: project.revision,
          sceneIds: ['scene_1'],
          routes: [route],
          catalogVersion: 'catalog_1',
        })
      )
    );

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect((await store.getProject(firstProject.id))?.jobs.job_same.status).toBe('submitting');
    expect((await store.getProject(secondProject.id))?.jobs.job_same.status).toBe('submitting');
    for (const gate of gates) gate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
  });

  it('commits concurrent completions for separate scenes without stale-revision loss', async () => {
    const gates: Array<Deferred<ProviderSubmitResult>> = [];
    let call = 0;
    let outputPaths: string[] = [];
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => {
        const index = call++;
        const gate = deferred<ProviderSubmitResult>();
        gates.push(gate);
        return gate.promise.then(() => ({
          kind: 'complete' as const,
          outputs: [
            {
              mediaKind: 'image' as const,
              role: 'primary' as const,
              source: { kind: 'file' as const, path: outputPaths[index]! },
              mimeType: 'image/png' as const,
            },
          ],
        }));
      },
    };
    const secondScene = scene({ id: 'scene_2', title: 'Closing' });
    const secondRoute = { ...route, sceneId: secondScene.id };
    const harness = await createHarness(adapter, {
      scenes: [scene(), secondScene],
      routes: [route, secondRoute],
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });
    outputPaths = [path.join(harness.rootDir, 'first.png'), path.join(harness.rootDir, 'second.png')];
    await Promise.all(outputPaths.map((outputPath) => writeFile(outputPath, png)));

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', secondScene.id],
      routes: [route, secondRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(gates).toHaveLength(2));
    gates[0]!.resolve({ kind: 'complete', outputs: [] });
    gates[1]!.resolve({ kind: 'complete', outputs: [] });

    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_1.status).toBe('succeeded');
      expect(project?.jobs.job_2.status).toBe('succeeded');
      expect(Object.keys(project?.assets ?? {})).toHaveLength(2);
    });
  });
});

describe('StudioJobManager cancellation', () => {
  it('cancels FIFO work that is still queued locally without another provider call', async () => {
    const selectedProvider = { ...provider, models: ['video-model'] };
    const scenes = [
      scene({ id: 'scene_1', visualPrompt: 'first', mediaKind: 'video', durationSeconds: 4 }),
      scene({ id: 'scene_2', visualPrompt: 'second', mediaKind: 'video', durationSeconds: 4 }),
    ];
    const routes = scenes.map(
      (candidate): StudioResolvedSceneRouteSnapshot => ({
        sceneId: candidate.id,
        providerId: selectedProvider.id,
        adapterId: 'weprompt-media-gateway-v1',
        model: 'video-model',
        kind: 'video',
      })
    );
    const first = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => first.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter, {
      scenes,
      routes,
      provider: selectedProvider,
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', 'scene_2'],
      routes,
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () => {
      const current = await harness.store.getProject(harness.project.id);
      expect(current?.jobs.job_1.status).toBe('submitting');
      expect(current?.jobs.job_2.status).toBe('queued_local');
    });
    const current = (await harness.store.getProject(harness.project.id))!;

    const cancelled = await harness.manager.cancelJob({
      projectId: current.id,
      jobId: 'job_2',
      expectedRevision: current.revision,
    });

    expect(cancelled.status).toBe('cancelled');
    expect(submit).toHaveBeenCalledOnce();
    first.reject(Object.assign(new Error('provider failed'), { code: 'unknown' }));
  });

  it('discards a provider success that arrives after confirmed queued cancellation', async () => {
    const selectedProvider = { ...provider, models: ['video-model'] };
    const videoRoute: StudioResolvedSceneRouteSnapshot = {
      sceneId: 'scene_1',
      providerId: selectedProvider.id,
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
      kind: 'video',
    };
    const pollResult = deferred<ProviderJobSnapshot>();
    const poll = vi.fn(async () => pollResult.promise);
    const cancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_1' }),
      poll,
      cancel,
    };
    const harness = await createHarness(adapter, {
      scenes: [scene({ mediaKind: 'video', durationSeconds: 5 })],
      routes: [videoRoute],
      provider: selectedProvider,
      sleep: async () => undefined,
    });
    const outputPath = path.join(harness.rootDir, 'late.mp4');
    await writeFile(outputPath, mp4);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());
    const beforeCancel = (await harness.store.getProject(harness.project.id))!;

    await harness.manager.cancelJob({
      projectId: beforeCancel.id,
      jobId: 'job_1',
      expectedRevision: beforeCancel.revision,
    });
    const afterCancel = (await harness.store.getProject(beforeCancel.id))!;
    const repeated = await harness.manager.cancelJob({
      projectId: beforeCancel.id,
      jobId: 'job_1',
      expectedRevision: afterCancel.revision,
    });
    pollResult.resolve({
      status: 'succeeded',
      outputs: [
        {
          mediaKind: 'video',
          role: 'primary',
          source: { kind: 'file', path: outputPath },
          mimeType: 'video/mp4',
        },
      ],
    });

    expect(repeated.status).toBe('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_1.status).toBe('cancelled');
      expect(project?.assets).toEqual({});
      expect(project?.scenes.scene_1.selectedAssetId).toBeNull();
    });
  });

  it('returns a typed refusal for running work without calling provider cancellation', async () => {
    const selectedProvider = { ...provider, models: ['video-model'] };
    const videoRoute: StudioResolvedSceneRouteSnapshot = {
      sceneId: 'scene_1',
      providerId: selectedProvider.id,
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
      kind: 'video',
    };
    const laterPoll = deferred<ProviderJobSnapshot>();
    let polls = 0;
    const cancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_1' }),
      poll: async () => {
        polls += 1;
        return polls === 1 ? { status: 'running' } : laterPoll.promise;
      },
      cancel,
    };
    const harness = await createHarness(adapter, {
      scenes: [scene({ mediaKind: 'video', durationSeconds: 5 })],
      routes: [videoRoute],
      provider: selectedProvider,
      sleep: async () => undefined,
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('running')
    );
    const current = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.cancelJob({
        projectId: current.id,
        jobId: 'job_1',
        expectedRevision: current.revision,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(cancel).not.toHaveBeenCalled();
    laterPoll.resolve({ status: 'failed', error: { code: 'unknown' } });
  });

  it('records confirmed cancellation when polling advances queued work during the cancel call', async () => {
    const selectedProvider = { ...provider, models: ['video-model'] };
    const videoRoute: StudioResolvedSceneRouteSnapshot = {
      sceneId: 'scene_1',
      providerId: selectedProvider.id,
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
      kind: 'video',
    };
    const firstSleep = deferred<void>();
    const cancellation = deferred<{ kind: 'cancelled' }>();
    const laterPoll = deferred<ProviderJobSnapshot>();
    let polls = 0;
    const cancel = vi.fn(async () => cancellation.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_1' }),
      poll: async () => {
        polls += 1;
        return polls === 1 ? { status: 'running' } : laterPoll.promise;
      },
      cancel,
    };
    const harness = await createHarness(adapter, {
      scenes: [scene({ mediaKind: 'video', durationSeconds: 5 })],
      routes: [videoRoute],
      provider: selectedProvider,
      sleep: async () => firstSleep.promise,
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('queued_remote')
    );
    const queued = (await harness.store.getProject(harness.project.id))!;
    const cancellationResult = harness.manager.cancelJob({
      projectId: queued.id,
      jobId: 'job_1',
      expectedRevision: queued.revision,
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    firstSleep.resolve();
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('running')
    );
    cancellation.resolve({ kind: 'cancelled' });

    await expect(cancellationResult).resolves.toMatchObject({ status: 'cancelled' });
    laterPoll.resolve({ status: 'failed', error: { code: 'unknown' } });
  });

  it('waits for the full remote cancellation transaction during disposal', async () => {
    const cancellation = deferred<{ kind: 'cancelled' }>();
    const cancel = vi.fn(async () => cancellation.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter);
    const queued = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'queued_remote',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        idempotencyKey: 'key_1',
        providerJobId: 'remote_1',
        outputAssetIds: [],
        error: null,
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'generating';
      return next;
    });
    const cancelResult = harness.manager.cancelJob({
      projectId: queued.id,
      jobId: 'job_1',
      expectedRevision: queued.revision,
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    let disposed = false;
    const disposal = harness.manager.dispose().then(() => {
      disposed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(false);

    cancellation.resolve({ kind: 'cancelled' });

    await expect(cancelResult).resolves.toMatchObject({ status: 'cancelled' });
    await disposal;
    expect(disposed).toBe(true);
    expect((await harness.store.getProject(queued.id))?.jobs.job_1.status).toBe('cancelled');
  });
});

describe('StudioJobManager retries', () => {
  it('retries with the immutable failed-job provider after the project default changes', async () => {
    const changedSelection = { ...route, model: 'image-b' };
    const adapter: GenerationProviderAdapter = {
      id: route.adapterId,
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(async () => ({ kind: 'complete' as const, outputs: [] })),
    };
    const harness = await createHarness(adapter, {
      routes: [route, changedSelection],
      provider: { ...provider, models: [route.model, changedSelection.model] },
      jobIds: ['job_2'],
      idempotencyKeys: ['key_2'],
    });
    const failed = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: selectionFor(route),
        idempotencyKey: 'key_1',
        providerJobId: null,
        outputAssetIds: [],
        error: {
          code: 'no_output',
          messageKey: 'conversation.creativeStudio.jobs.errors.noOutput',
        },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'blocked';
      next.routing.image = selectionFor(changedSelection);
      return next;
    });

    const retry = await harness.manager.retryJob({
      projectId: failed.id,
      jobId: 'job_1',
      expectedRevision: failed.revision,
    });

    expect(retry.provider.model).toBe(route.model);
    expect((await harness.store.getProject(failed.id))?.routing.image).toEqual(selectionFor(changedSelection));
  });

  it('returns unsupported when a successful provider output has no durable remote task to re-download', async () => {
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(),
      poll: vi.fn(),
    };
    const harness = await createHarness(adapter);
    const failed = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        idempotencyKey: 'key_1',
        providerJobId: null,
        outputAssetIds: [],
        error: {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

    await expect(
      harness.manager.retryDownload({
        projectId: failed.id,
        jobId: 'job_1',
        expectedRevision: failed.revision,
      })
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(adapter.poll).not.toHaveBeenCalled();
    expect(adapter.submit).not.toHaveBeenCalled();
  });

  it('never treats a durable remote task without polling support as a confirmed provider failure', async () => {
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_unpollable' }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: 'remote_unpollable',
        error: { code: 'unsupported' },
      })
    );
    const paused = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.retryJob({
        projectId: paused.id,
        jobId: 'job_1',
        expectedRevision: paused.revision,
      })
    ).resolves.toMatchObject({
      id: 'job_1',
      status: 'queued_remote',
      providerJobId: 'remote_unpollable',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        error: { code: 'unsupported' },
      })
    );
    expect(submit).toHaveBeenCalledOnce();
  });

  it('creates a new paid attempt only after a confirmed provider failure snapshot', async () => {
    let submissionCount = 0;
    const submit = vi.fn(async () => {
      submissionCount += 1;
      return { kind: 'remote' as const, providerJobId: `remote_${submissionCount}` };
    });
    const poll = vi.fn(
      async (): Promise<ProviderJobSnapshot> => ({
        status: 'failed',
        error: { code: 'no_output' },
      })
    );
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, {
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
      sleep: async () => undefined,
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'failed',
        error: { code: 'no_output' },
      })
    );
    const confirmedFailure = (await harness.store.getProject(harness.project.id))!;

    const retry = await harness.manager.retryJob({
      projectId: confirmedFailure.id,
      jobId: 'job_1',
      expectedRevision: confirmedFailure.revision,
    });

    expect(retry).toMatchObject({
      id: 'job_2',
      idempotencyKey: 'key_2',
      retryOfJobId: 'job_1',
      retryReason: 'provider_failure',
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_2.status).toBe('failed')
    );
    const retriedProject = (await harness.store.getProject(harness.project.id))!;
    expect(retriedProject.jobs.job_1).toMatchObject({
      status: 'failed',
      error: { code: 'no_output' },
    });
    await expect(
      harness.manager.retryJob({
        projectId: retriedProject.id,
        jobId: 'job_1',
        expectedRevision: retriedProject.revision,
      })
    ).rejects.toMatchObject({ code: 'busy' });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('requires and audits duplicate-charge acknowledgement before retrying an unknown submission', async () => {
    const secondSubmission = deferred<ProviderSubmitResult>();
    let submissions = 0;
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => {
        submissions += 1;
        if (submissions === 1) throw new Error('transport interrupted after request write');
        return secondSubmission.promise;
      },
    };
    const harness = await createHarness(adapter, {
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('needs_attention')
    );
    const unknown = (await harness.store.getProject(harness.project.id))!;
    expect(submissions).toBe(1);

    await expect(
      harness.manager.submitScenes({
        projectId: unknown.id,
        expectedRevision: unknown.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });
    expect(submissions).toBe(1);

    await expect(
      harness.manager.retryJob({
        projectId: unknown.id,
        jobId: 'job_1',
        expectedRevision: unknown.revision,
      })
    ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });
    expect(submissions).toBe(1);

    const retry = await harness.manager.retryJob({
      projectId: unknown.id,
      jobId: 'job_1',
      expectedRevision: unknown.revision,
      acknowledgePossibleDuplicateCharge: true,
    });

    expect(retry).toMatchObject({
      id: 'job_2',
      idempotencyKey: 'key_2',
      retryOfJobId: 'job_1',
      retryReason: 'submission_unknown',
      duplicateChargeAcknowledged: true,
    });
    expect(retry.duplicateChargeAcknowledgedAt).not.toBeNull();
    expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
      status: 'failed',
      error: { code: 'submission_unknown' },
    });
    await waitFor(() => expect(submissions).toBe(2));
    secondSubmission.reject(Object.assign(new Error('provider rejected'), { code: 'no_output' }));
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_2.status).toBe('failed')
    );
  });

  it.each([
    ['provider_unavailable', 'provider_unavailable'],
    ['timeout', 'timeout'],
    ['invalid_response', 'unknown'],
    [null, 'unknown'],
  ] as const)('re-polls the same durable remote task after %s poll uncertainty', async (thrownCode, storedCode) => {
    let outputPath = '';
    let pollCount = 0;
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_uncertain' }));
    const poll = vi.fn(async (): Promise<ProviderJobSnapshot> => {
      pollCount += 1;
      if (pollCount === 1) {
        const error = new Error('poll transport lost');
        throw thrownCode === null ? error : Object.assign(error, { code: thrownCode });
      }
      return {
        status: 'succeeded',
        outputs: [
          {
            mediaKind: 'image',
            role: 'primary',
            source: { kind: 'file', path: outputPath },
            mimeType: 'image/png',
          },
        ],
      };
    });
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    outputPath = path.join(harness.rootDir, 'repolled.png');
    await writeFile(outputPath, png);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: 'remote_uncertain',
        error: { code: storedCode },
      })
    );
    const uncertain = (await harness.store.getProject(harness.project.id))!;

    const resumed = await harness.manager.retryJob({
      projectId: uncertain.id,
      jobId: 'job_1',
      expectedRevision: uncertain.revision,
    });

    expect(resumed).toMatchObject({
      id: 'job_1',
      status: 'queued_remote',
      providerJobId: 'remote_uncertain',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('hands an immediate retry to a successor poll before the uncertain run releases its controller', async () => {
    let outputPath = '';
    let pollCount = 0;
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_handoff' }));
    const poll = vi.fn(async (): Promise<ProviderJobSnapshot> => {
      pollCount += 1;
      if (pollCount === 1) {
        throw Object.assign(new Error('poll transport lost'), { code: 'provider_unavailable' });
      }
      return {
        status: 'succeeded',
        outputs: [
          {
            mediaKind: 'image',
            role: 'primary',
            source: { kind: 'file', path: outputPath },
            mimeType: 'image/png',
          },
        ],
      };
    });
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    outputPath = path.join(harness.rootDir, 'handoff.png');
    await writeFile(outputPath, png);
    const updateProject = harness.store.updateProject.bind(harness.store);
    let heldAttentionTransition = false;
    let retryPromise: ReturnType<StudioJobManager['retryJob']> | null = null;
    vi.spyOn(harness.store, 'updateProject').mockImplementation(async (projectId, mutate, expectedRevision) => {
      const updated = await updateProject(projectId, mutate, expectedRevision);
      const job = updated.jobs.job_1;
      if (!heldAttentionTransition && job?.status === 'needs_attention' && job.providerJobId === 'remote_handoff') {
        heldAttentionTransition = true;
        retryPromise = harness.manager.retryJob({
          projectId: updated.id,
          jobId: job.id,
          expectedRevision: updated.revision,
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return updated;
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(retryPromise).not.toBeNull());

    await expect(retryPromise!).resolves.toMatchObject({
      id: 'job_1',
      status: 'queued_remote',
      providerJobId: 'remote_handoff',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('re-polls and persists a failed download without submitting generation again', async () => {
    let outputPath = '';
    const submit = vi.fn();
    const poll = vi.fn(async () => ({
      status: 'succeeded' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png' as const,
        },
      ],
    }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter);
    outputPath = path.join(harness.rootDir, 'download-retry.png');
    await writeFile(outputPath, png);
    const seeded = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        idempotencyKey: 'key_1',
        providerJobId: 'remote_1',
        outputAssetIds: [],
        error: {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

    const completed = await harness.manager.retryDownload({
      projectId: seeded.id,
      jobId: 'job_1',
      expectedRevision: seeded.revision,
    });

    expect(completed.status).toBe('succeeded');
    expect(submit).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledWith(
      'remote_1',
      expect.objectContaining({ use_model: 'image-model' }),
      expect.anything()
    );
    expect((await harness.store.getProject(seeded.id))?.scenes.scene_1.selectedAssetId).toBe(
      completed.outputAssetIds[0]
    );
  });
});

describe('StudioJobManager recovery', () => {
  it('does not reconcile live queued or submitting work owned by the current manager', async () => {
    const selectedProvider: IProvider = {
      ...provider,
      models: ['video-model'],
    };
    const scenes = [
      scene({
        id: 'scene_1',
        mediaKind: 'video',
        durationSeconds: 4,
        visualPrompt: 'First video',
      }),
      scene({
        id: 'scene_2',
        mediaKind: 'video',
        durationSeconds: 4,
        visualPrompt: 'Second video',
      }),
    ];
    const routes: StudioResolvedSceneRouteSnapshot[] = scenes.map((candidate) => ({
      sceneId: candidate.id,
      providerId: selectedProvider.id,
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
      kind: 'video',
    }));
    const submissions = [deferred<ProviderSubmitResult>(), deferred<ProviderSubmitResult>()];
    const submit = vi.fn(async () => submissions[submit.mock.calls.length - 1]!.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter, {
      scenes,
      routes,
      provider: selectedProvider,
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', 'scene_2'],
      routes,
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());

    await harness.manager.resumePendingJobs();

    expect((await harness.store.getProject(harness.project.id))?.jobs).toMatchObject({
      job_1: { status: 'submitting', error: null },
      job_2: { status: 'queued_local', error: null },
    });
    submissions[0]!.reject(Object.assign(new Error('first provider failure'), { code: 'no_output' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    submissions[1]!.reject(Object.assign(new Error('second provider failure'), { code: 'no_output' }));
    await waitFor(async () =>
      expect(
        Object.values((await harness.store.getProject(harness.project.id))?.jobs ?? {}).every(
          (job) => job.status === 'failed'
        )
      ).toBe(true)
    );
  });

  it('never auto-submits and resumes only jobs with a known available remote identity', async () => {
    let outputPath = '';
    const submit = vi.fn();
    const poll = vi.fn(async () => ({
      status: 'succeeded' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png' as const,
        },
      ],
    }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    outputPath = path.join(harness.rootDir, 'recovered.png');
    await writeFile(outputPath, png);
    const timestamp = harness.project.createdAt;
    const baseJob = {
      projectId: harness.project.id,
      sceneId: 'scene_1',
      provider: {
        providerId: provider.id,
        adapterId: 'weprompt-image-v1' as const,
        model: 'image-model',
      },
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs = {
        queued_job: {
          ...baseJob,
          id: 'queued_job',
          status: 'queued_local',
          idempotencyKey: 'key_queued',
          providerJobId: null,
        },
        submitting_job: {
          ...baseJob,
          id: 'submitting_job',
          status: 'submitting',
          idempotencyKey: 'key_submitting',
          providerJobId: null,
        },
        remote_job: {
          ...baseJob,
          id: 'remote_job',
          status: 'queued_remote',
          idempotencyKey: 'key_remote',
          providerJobId: 'remote_known',
        },
        missing_job: {
          ...baseJob,
          id: 'missing_job',
          status: 'queued_remote',
          provider: { ...baseJob.provider, providerId: 'provider_missing' },
          idempotencyKey: 'key_missing',
          providerJobId: 'remote_missing',
        },
      };
      next.scenes.scene_1.jobIds = ['queued_job', 'submitting_job', 'remote_job', 'missing_job'];
      next.scenes.scene_1.reviewState = 'generating';
      return next;
    });

    await harness.manager.resumePendingJobs();

    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.queued_job).toMatchObject({ status: 'failed', error: { code: 'unknown' } });
      expect(project?.jobs.submitting_job).toMatchObject({
        status: 'needs_attention',
        error: { code: 'submission_unknown' },
      });
      expect(project?.jobs.remote_job.status).toBe('succeeded');
      expect(project?.jobs.missing_job).toMatchObject({
        status: 'needs_attention',
        error: { code: 'provider_unavailable' },
      });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledOnce();
  });

  it('resumes a durable provider-unavailable job after its binding returns', async () => {
    let outputPath = '';
    const submit = vi.fn();
    const poll = vi.fn(async () => ({
      status: 'succeeded' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png' as const,
        },
      ],
    }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    outputPath = path.join(harness.rootDir, 'returned-provider.png');
    await writeFile(outputPath, png);
    const seeded = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      const baseJob = {
        projectId: project.id,
        sceneId: 'scene_1',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        outputAssetIds: [],
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.jobs = {
        recoverable_job: {
          ...baseJob,
          id: 'recoverable_job',
          status: 'needs_attention',
          idempotencyKey: 'key_recoverable',
          providerJobId: 'remote_recoverable',
          error: {
            code: 'provider_unavailable',
            messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
          },
        },
        unknown_job: {
          ...baseJob,
          id: 'unknown_job',
          status: 'needs_attention',
          idempotencyKey: 'key_unknown',
          providerJobId: null,
          error: {
            code: 'submission_unknown',
            messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
          },
        },
      };
      next.scenes.scene_1.jobIds = ['recoverable_job', 'unknown_job'];
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

    await harness.manager.resumePendingJobs();

    await waitFor(async () => {
      const project = await harness.store.getProject(seeded.id);
      expect(project?.jobs.recoverable_job.status).toBe('succeeded');
      expect(project?.jobs.unknown_job).toMatchObject({
        status: 'needs_attention',
        providerJobId: null,
        error: { code: 'submission_unknown' },
      });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledOnce();
  });
});

describe('StudioJobManager disposal fencing', () => {
  it('awaits an admitted submit and prevents persistence or provider calls after disposal begins', async () => {
    const catalogStarted = deferred<void>();
    const catalogGate = deferred<StudioGenerationRouteCatalog>();
    const submit = vi.fn();
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter, {
      catalog: async () => {
        catalogStarted.resolve(undefined);
        return catalogGate.promise;
      },
    });
    const submission = harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await catalogStarted.promise;

    const disposal = harness.manager.dispose();
    catalogGate.resolve(catalog());

    await expect(submission).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(disposal).resolves.toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
  });

  it('prevents a delayed cancellation from starting provider I/O after disposal begins', async () => {
    const cancel = vi.fn();
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter);
    const queued = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'queued_remote',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        idempotencyKey: 'key_1',
        providerJobId: 'remote_1',
        outputAssetIds: [],
        error: null,
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'generating';
      return next;
    });
    const projectRead = deferred<StudioProject | null>();
    const readStarted = deferred<void>();
    vi.spyOn(harness.store, 'getProject').mockImplementationOnce(async () => {
      readStarted.resolve(undefined);
      return projectRead.promise;
    });
    const cancellation = harness.manager.cancelJob({
      projectId: queued.id,
      jobId: 'job_1',
      expectedRevision: queued.revision,
    });
    await readStarted.promise;

    const disposal = harness.manager.dispose();
    projectRead.resolve(queued);

    await expect(cancellation).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(disposal).resolves.toBeUndefined();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('StudioJobManager video poster outputs', () => {
  const videoProvider: IProvider = {
    ...provider,
    name: 'Video provider',
    models: ['video-model'],
  };
  const videoRoute: StudioResolvedSceneRouteSnapshot = {
    sceneId: 'scene_1',
    providerId: videoProvider.id,
    adapterId: 'weprompt-media-gateway-v1',
    model: 'video-model',
    kind: 'video',
  };
  const videoScene = (): StudioScene => scene({ mediaKind: 'video', durationSeconds: 5 });

  it('persists a single provider poster beside the selected primary video', async () => {
    let primaryPath = '';
    let posterPath = '';
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({
        kind: 'complete',
        outputs: [
          {
            mediaKind: 'video',
            role: 'primary',
            source: { kind: 'file', path: primaryPath },
            mimeType: 'video/mp4',
          },
          {
            mediaKind: 'image',
            role: 'poster',
            source: { kind: 'file', path: posterPath },
            mimeType: 'image/png',
          },
        ],
      }),
    };
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
    });
    primaryPath = path.join(harness.rootDir, 'primary.mp4');
    posterPath = path.join(harness.rootDir, 'poster.png');
    await Promise.all([writeFile(primaryPath, mp4), writeFile(posterPath, png)]);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.outputAssetIds).toHaveLength(2)
    );
    const project = (await harness.store.getProject(harness.project.id))!;
    const [primaryAssetId, posterAssetId] = project.jobs.job_1.outputAssetIds;
    expect(project.jobs.job_1.status).toBe('succeeded');
    expect(project.scenes.scene_1).toMatchObject({
      assetIds: [primaryAssetId, posterAssetId],
      selectedAssetId: primaryAssetId,
      reviewState: 'complete',
    });
    expect(project.assets[primaryAssetId!]).toMatchObject({
      mediaKind: 'video',
      managedAsset: { collection: 'assets' },
    });
    expect(project.assets[posterAssetId!]).toMatchObject({
      mediaKind: 'image',
      managedAsset: { collection: 'thumbnails' },
    });
    expect(JSON.stringify(project)).not.toContain(primaryPath);
    expect(JSON.stringify(project)).not.toContain(posterPath);
  });

  it('releases the video generation slot after primary success while an optional poster is still persisting', async () => {
    let firstPrimaryPath = '';
    let secondPrimaryPath = '';
    let posterPath = '';
    let submission = 0;
    const posterStarted = deferred<void>();
    const releasePoster = deferred<void>();
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(async () => {
        submission += 1;
        return {
          kind: 'complete' as const,
          outputs:
            submission === 1
              ? [
                  {
                    mediaKind: 'video' as const,
                    role: 'primary' as const,
                    source: { kind: 'file' as const, path: firstPrimaryPath },
                    mimeType: 'video/mp4',
                  },
                  {
                    mediaKind: 'image' as const,
                    role: 'poster' as const,
                    source: { kind: 'file' as const, path: posterPath },
                    mimeType: 'image/png',
                  },
                ]
              : [
                  {
                    mediaKind: 'video' as const,
                    role: 'primary' as const,
                    source: { kind: 'file' as const, path: secondPrimaryPath },
                    mimeType: 'video/mp4',
                  },
                ],
        };
      }),
    };
    const secondScene = videoScene();
    secondScene.id = 'scene_2';
    secondScene.title = 'Closing';
    const secondRoute = { ...videoRoute, sceneId: secondScene.id };
    const harness = await createHarness(adapter, {
      scenes: [videoScene(), secondScene],
      routes: [videoRoute, secondRoute],
      provider: videoProvider,
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
      decorateMediaStore: (mediaStore) => ({
        ...mediaStore,
        persistProviderPosterForJob: async (input) => {
          posterStarted.resolve(undefined);
          await releasePoster.promise;
          return mediaStore.persistProviderPosterForJob(input);
        },
      }),
    });
    firstPrimaryPath = path.join(harness.rootDir, 'primary-one.mp4');
    secondPrimaryPath = path.join(harness.rootDir, 'primary-two.mp4');
    posterPath = path.join(harness.rootDir, 'slow-poster.png');
    await Promise.all([
      writeFile(firstPrimaryPath, mp4),
      writeFile(secondPrimaryPath, mp4),
      writeFile(posterPath, png),
    ]);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', 'scene_2'],
      routes: [videoRoute, secondRoute],
      catalogVersion: 'catalog_1',
    });

    await posterStarted.promise;
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_1.status).toBe('succeeded');
      expect(adapter.submit).toHaveBeenCalledTimes(2);
      expect(project?.jobs.job_2.status).toBe('succeeded');
    });

    releasePoster.resolve(undefined);
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.outputAssetIds).toHaveLength(2)
    );
  });

  it('keeps a successful primary video when the provider omits its poster', async () => {
    let primaryPath = '';
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({
        kind: 'complete',
        outputs: [
          {
            mediaKind: 'video',
            role: 'primary',
            source: { kind: 'file', path: primaryPath },
            mimeType: 'video/mp4',
          },
        ],
      }),
    };
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
    });
    primaryPath = path.join(harness.rootDir, 'primary-only.mp4');
    await writeFile(primaryPath, mp4);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    const project = (await harness.store.getProject(harness.project.id))!;
    expect(project.jobs.job_1.outputAssetIds).toHaveLength(1);
    expect(project.scenes.scene_1.selectedAssetId).toBe(project.jobs.job_1.outputAssetIds[0]);
  });

  it('keeps a successful primary video when poster persistence fails', async () => {
    let primaryPath = '';
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({
        kind: 'complete',
        outputs: [
          {
            mediaKind: 'video',
            role: 'primary',
            source: { kind: 'file', path: primaryPath },
            mimeType: 'video/mp4',
          },
          {
            mediaKind: 'image',
            role: 'poster',
            source: { kind: 'file', path: path.join(path.dirname(primaryPath), 'missing-poster.png') },
            mimeType: 'image/png',
          },
        ],
      }),
    };
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
    });
    primaryPath = path.join(harness.rootDir, 'primary-with-missing-poster.mp4');
    await writeFile(primaryPath, mp4);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    const project = (await harness.store.getProject(harness.project.id))!;
    expect(project.jobs.job_1).toMatchObject({ status: 'succeeded', error: null });
    expect(project.jobs.job_1.outputAssetIds).toHaveLength(1);
    expect(project.scenes.scene_1.selectedAssetId).toBe(project.jobs.job_1.outputAssetIds[0]);
  });
});

describe('StudioJobManager provider failures', () => {
  it.each(['auth', 'quota', 'rate_limited', 'no_output', 'unsupported'] as const)(
    'persists only the sanitized %s provider error',
    async (code) => {
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: (request) => ({
          ok: true,
          normalized: {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
          },
        }),
        submit: async () => {
          throw Object.assign(new Error('secret provider response body'), { code });
        },
      };
      const harness = await createHarness(adapter);

      await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      });

      await waitFor(async () =>
        expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
          status: 'failed',
          error: { code },
        })
      );
      expect(JSON.stringify(await harness.store.getProject(harness.project.id))).not.toContain(
        'secret provider response body'
      );
    }
  );

  it.each(['timeout', 'provider_unavailable', 'submission_unknown', 'unknown'] as const)(
    'treats submit-time %s as ambiguous and requires duplicate-charge acknowledgement',
    async (code) => {
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: (request) => ({
          ok: true,
          normalized: {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
          },
        }),
        submit: async () => {
          throw Object.assign(new Error('ambiguous submit'), { code });
        },
      };
      const harness = await createHarness(adapter);
      await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      });
      await waitFor(async () =>
        expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
          status: 'needs_attention',
          error: { code: 'submission_unknown' },
        })
      );
      const current = (await harness.store.getProject(harness.project.id))!;

      await expect(
        harness.manager.retryJob({
          projectId: current.id,
          jobId: 'job_1',
          expectedRevision: current.revision,
        })
      ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });
    }
  );

  it('marks provider success with unusable local output as download_failed', async () => {
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({
        kind: 'complete',
        outputs: [
          {
            mediaKind: 'image',
            role: 'primary',
            source: { kind: 'file', path: '/definitely/missing/studio-output.png' },
            mimeType: 'image/png',
          },
        ],
      }),
    };
    const harness = await createHarness(adapter);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'failed',
        error: { code: 'download_failed' },
        outputAssetIds: [],
      })
    );
  });
});
