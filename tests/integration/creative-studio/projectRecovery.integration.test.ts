/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import type { StudioProject, StudioScene, StudioSceneRouteSnapshot } from '@/common/types/project/creativeStudioTypes';
import {
  createStudioE2EFakeBundle,
  createStudioE2EFakeRemoteState,
  type StudioE2EFakeBundle,
  type StudioE2EFakeRemoteState,
} from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import { createCreativeStudioService } from '@process/services/creative-studio/creativeStudioService';
import { createStudioJobManager, type StudioJobManager } from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import {
  createStudioProviderResolver,
  type StudioGenerationRouteCatalog,
  type StudioProviderResolver,
} from '@process/services/creative-studio/providerResolver';
import {
  createCreativeStudioRuntime,
  type CreativeStudioRuntime,
  type CreativeStudioRuntimeFactories,
} from '@process/services/creative-studio/runtime';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import { afterEach, describe, expect, it } from 'vitest';

const scene: StudioScene = {
  id: 'scene_recovery',
  title: 'Recovery scene',
  purpose: 'Prove durable generation recovery',
  visualPrompt: 'A sunrise reflected in a glass city',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
};

const waitFor = async <T>(read: () => Promise<T | null>, attemptsRemaining = 200): Promise<T> => {
  const value = await read();
  if (value !== null) return value;
  if (attemptsRemaining <= 1) throw new Error('Timed out waiting for Creative Studio recovery state');
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  return waitFor(read, attemptsRemaining - 1);
};

type PendingSleep = {
  delayMs: number;
  release(): void;
};

class ControlledPollClock {
  private readonly pending: PendingSleep[] = [];
  private autoRelease = false;

  readonly sleep = (delayMs: number, signal: AbortSignal): Promise<void> => {
    if (this.autoRelease) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = (): void => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        finish(error);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.push({ delayMs, release: () => finish() });
    });
  };

  async take(expectedDelayMs: number): Promise<PendingSleep> {
    const pending = await waitFor(async () => this.pending.shift() ?? null);
    expect(pending.delayMs).toBe(expectedDelayMs);
    return pending;
  }

  releaseAll(): void {
    this.autoRelease = true;
    for (const pending of this.pending.splice(0)) pending.release();
  }
}

type RecoveryHarness = {
  rootDir: string;
  fake: ReturnType<typeof createStudioE2EFakeBundle>;
  project: StudioProject;
  route: StudioSceneRouteSnapshot;
  catalog: StudioGenerationRouteCatalog;
  manager: StudioJobManager;
  clock: ControlledPollClock;
};

const harnesses: RecoveryHarness[] = [];
const extraManagers = new Set<{ manager: StudioJobManager; clock: ControlledPollClock }>();

const resolverFor = (
  store: ReturnType<typeof createCreativeStudioStore>,
  providers: () => Promise<IProvider[]>
): StudioProviderResolver =>
  createStudioProviderResolver({
    listProviders: providers,
    listConnections: () => store.listConnections(),
  });

const createHarness = async (): Promise<RecoveryHarness> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-recovery-integration-'));
  const fake = createStudioE2EFakeBundle({ rootDir });
  const store = createCreativeStudioStore({ rootDir });
  await store.saveConnection(fake.connections[0]!);
  const created = await store.createProject({
    name: 'Durable film',
    brief: 'A restart-safe launch story',
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '720p',
  });
  let project = await store.updateProject(created.id, (current) => ({
    ...current,
    sceneOrder: [scene.id],
    scenes: { [scene.id]: structuredClone(scene) },
  }));
  const listProviders = async () => [fake.provider];
  const providerResolver = resolverFor(store, listProviders);
  const catalog = await providerResolver.listGenerationRoutes();
  const videoRoute = catalog.routes.find((candidate) => candidate.kind === 'video');
  if (!videoRoute) throw new Error('E2E fake video route was not resolved');
  const route: StudioSceneRouteSnapshot = {
    sceneId: scene.id,
    providerId: videoRoute.providerId,
    adapterId: videoRoute.adapterId,
    model: videoRoute.model,
    kind: videoRoute.kind,
  };
  project = await store.updateProject(project.id, (current) => ({
    ...current,
    routing: {
      ...current.routing,
      video: { providerId: route.providerId, adapterId: route.adapterId, model: route.model },
    },
  }));
  const clock = new ControlledPollClock();
  const manager = createStudioJobManager({
    store,
    mediaStore: createStudioMediaStore({ store }),
    providerResolver,
    adapters: fake.adapters,
    listProviders,
    createJobId: () => 'job_recovery',
    createIdempotencyKey: () => 'idempotency_recovery',
    sleep: clock.sleep,
    jitterMs: (baseMs) => baseMs,
  });
  const harness = { rootDir, fake, project, route, catalog, manager, clock };
  harnesses.push(harness);
  return harness;
};

const submitAndStopWithRemoteIdentity = async (harness: RecoveryHarness): Promise<{ providerJobId: string }> => {
  await harness.manager.submitScenes({
    projectId: harness.project.id,
    expectedRevision: harness.project.revision,
    sceneIds: [scene.id],
    routes: [harness.route],
    catalogVersion: harness.catalog.generationCatalogVersion,
  });
  const persisted = await waitFor(async () => {
    const project = await createCreativeStudioStore({ rootDir: harness.rootDir }).getProject(harness.project.id);
    const job = project?.jobs.job_recovery;
    return project && job?.status === 'queued_remote' && job.providerJobId ? { project, job } : null;
  });
  await harness.clock.take(2_000);
  const dispose = harness.manager.dispose();
  harness.clock.releaseAll();
  await dispose;
  return { providerJobId: persisted.job.providerJobId! };
};

const noProviders = async (): Promise<IProvider[]> => [];

type FreshRuntimeHarness = {
  runtime: CreativeStudioRuntime;
  clock: ControlledPollClock;
  bundle: StudioE2EFakeBundle;
};

const createFreshRuntimeHarness = (
  rootDir: string,
  remoteState: StudioE2EFakeRemoteState,
  jobId: string
): FreshRuntimeHarness => {
  const clock = new ControlledPollClock();
  let bundle: StudioE2EFakeBundle | null = null;
  const factories: CreativeStudioRuntimeFactories = {
    createStore: ({ rootDir: runtimeRoot }) => createCreativeStudioStore({ rootDir: runtimeRoot }),
    createMediaStore: ({ store }) => createStudioMediaStore({ store }),
    createAdapters: () => new Map(),
    createPlanner: () => ({
      listModels: async () => [],
      draft: async () => {
        throw new Error('Storyboard drafting was not expected during recovery');
      },
      dispose: async () => {},
    }),
    createProviderResolver: createStudioProviderResolver,
    createJobManager: (input) =>
      createStudioJobManager({
        ...input,
        createJobId: () => jobId,
        createIdempotencyKey: () => `idempotency_${jobId}`,
        sleep: clock.sleep,
        jitterMs: (baseMs) => baseMs,
      }),
    createService: createCreativeStudioService,
    createE2EFakeBundle: ({ rootDir: runtimeRoot }) => {
      bundle = createStudioE2EFakeBundle({ rootDir: runtimeRoot, remoteState });
      return bundle;
    },
  };
  const runtime = createCreativeStudioRuntime({
    rootDir,
    environment: { AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' },
    isPackaged: false,
    factories,
    listProviders: async () => [],
    onProjectUpdated: () => {},
    protocol: {
      install: () => ({ dispose: async () => {} }),
      uninstall: async (installation) => installation?.dispose(),
    },
  });
  if (bundle === null) throw new Error('Fresh runtime did not install its E2E fake bundle');
  return { runtime, clock, bundle };
};

const rendererSafeKeys = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) rendererSafeKeys(item, found);
    return found;
  }
  if (typeof value !== 'object' || value === null) return found;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replaceAll(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (
      [
        'path',
        'filepath',
        'sourcepath',
        'destinationpath',
        'url',
        'signedurl',
        'apikey',
        'credential',
        'credentials',
        'authorization',
        'bytes',
        'base64',
        'secret',
      ].includes(normalized)
    ) {
      found.push(key);
    }
    rendererSafeKeys(nested, found);
  }
  return found;
};

afterEach(async () => {
  await Promise.all(
    [...extraManagers].map(async (entry) => {
      entry.clock.releaseAll();
      await entry.manager.dispose().catch((): undefined => undefined);
    })
  );
  extraManagers.clear();
  await Promise.all(
    harnesses.splice(0).map(async (harness) => {
      harness.clock.releaseAll();
      await harness.manager.dispose().catch((): undefined => undefined);
      await harness.fake.dispose().catch((): undefined => undefined);
      await rm(harness.rootDir, { recursive: true, force: true });
    })
  );
});

describe('Creative Studio project recovery integration', () => {
  it('re-polls a durable remote job in a fresh instance and restores its selected managed asset', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-runtime-recovery-integration-'));
    const remoteState = createStudioE2EFakeRemoteState();
    const runtimes: FreshRuntimeHarness[] = [];
    try {
      const beforeRestart = createFreshRuntimeHarness(rootDir, remoteState, 'job_runtime_recovery');
      runtimes.push(beforeRestart);
      await beforeRestart.runtime.start();
      const created = await beforeRestart.runtime.service.createProject({
        name: 'Durable runtime film',
        brief: 'A full runtime restart-safe launch story',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      const project = await beforeRestart.runtime.store.updateProject(created.id, (current) => ({
        ...current,
        sceneOrder: [scene.id],
        scenes: { [scene.id]: structuredClone(scene) },
      }));
      const catalog = await beforeRestart.runtime.service.listRoutes({ projectId: project.id });
      const videoRoute = catalog.video.options.find((candidate) => candidate.kind === 'video');
      if (!videoRoute) throw new Error('Fresh runtime did not resolve its E2E fake video route');
      const selectedProject = await beforeRestart.runtime.service.updateModelSelection({
        projectId: project.id,
        expectedRevision: project.revision,
        role: 'video',
        selection: {
          providerId: videoRoute.providerId,
          adapterId: videoRoute.adapterId,
          model: videoRoute.model,
        },
      });
      await beforeRestart.runtime.service.submitScenes({
        projectId: selectedProject.id,
        expectedRevision: selectedProject.revision,
        sceneIds: [scene.id],
        routes: [
          {
            sceneId: scene.id,
            providerId: videoRoute.providerId,
            adapterId: videoRoute.adapterId,
            model: videoRoute.model,
            kind: videoRoute.kind,
          },
        ],
        catalogVersion: catalog.catalogVersion,
      });
      const persisted = await waitFor(async () => {
        const current = await beforeRestart.runtime.store.getProject(project.id);
        const job = current?.jobs.job_runtime_recovery;
        return job?.status === 'queued_remote' && job.providerJobId ? job : null;
      });
      await beforeRestart.clock.take(2_000);
      const providerJobId = persisted.providerJobId!;
      beforeRestart.clock.releaseAll();
      await beforeRestart.runtime.dispose();

      const afterRestart = createFreshRuntimeHarness(rootDir, remoteState, 'unused_recovery_job_id');
      runtimes.push(afterRestart);
      expect(afterRestart.runtime).not.toBe(beforeRestart.runtime);
      expect(afterRestart.runtime.store).not.toBe(beforeRestart.runtime.store);
      expect(afterRestart.runtime.mediaStore).not.toBe(beforeRestart.runtime.mediaStore);
      expect(afterRestart.runtime.adapterRegistry).not.toBe(beforeRestart.runtime.adapterRegistry);
      expect(afterRestart.runtime.providerResolver).not.toBe(beforeRestart.runtime.providerResolver);
      expect(afterRestart.runtime.jobManager).not.toBe(beforeRestart.runtime.jobManager);
      expect(afterRestart.runtime.service).not.toBe(beforeRestart.runtime.service);

      await afterRestart.runtime.start();
      await afterRestart.runtime.onBackendReady();
      (await afterRestart.clock.take(2_000)).release();
      (await afterRestart.clock.take(4_000)).release();
      const finalPoll = await afterRestart.clock.take(8_000);
      const running = await waitFor(async () => {
        const job = (await afterRestart.runtime.store.getProject(project.id))?.jobs.job_runtime_recovery;
        return job?.status === 'running' ? job : null;
      });
      expect(running).toMatchObject({ providerJobId, progress: 50 });
      finalPoll.release();

      const recovered = await waitFor(async () => {
        const current = await afterRestart.runtime.store.getProject(project.id);
        return current?.jobs.job_runtime_recovery.status === 'succeeded' ? current : null;
      });
      const recoveredJob = recovered.jobs.job_runtime_recovery;
      const selectedAssetId = recovered.scenes.scene_recovery.selectedAssetId;
      expect({
        providerJobId: recoveredJob.providerJobId,
        outputAssetIds: recoveredJob.outputAssetIds,
        selectedAssetId,
        selectedAssetMediaKind: selectedAssetId ? recovered.assets[selectedAssetId]?.mediaKind : null,
        projectId: recovered.id,
      }).toEqual({
        providerJobId,
        outputAssetIds: [selectedAssetId],
        selectedAssetId,
        selectedAssetMediaKind: 'video',
        projectId: project.id,
      });
      const resolved = selectedAssetId
        ? await afterRestart.runtime.mediaStore.resolveAsset(recovered.id, selectedAssetId)
        : null;
      expect(resolved?.asset.managedAsset.collection).toBe('assets');
      const rendererProject = await afterRestart.runtime.service.getProject(project.id);
      expect(rendererProject?.jobs.job_runtime_recovery).not.toHaveProperty('providerJobId');
      expect(rendererProject?.jobs.job_runtime_recovery).not.toHaveProperty('idempotencyKey');
      expect(rendererSafeKeys(recovered)).toEqual([]);
      const serialized = JSON.stringify(recovered);
      expect(serialized).not.toContain(rootDir);
      expect(serialized).not.toContain(afterRestart.bundle.provider.api_key);
      expect(serialized).not.toContain(afterRestart.bundle.provider.base_url);
    } finally {
      for (const harness of runtimes) harness.clock.releaseAll();
      await Promise.all(runtimes.map((harness) => harness.runtime.dispose().catch((): undefined => undefined)));
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('preserves the remote identity and requires attention when its provider disappears after restart', async () => {
    const harness = await createHarness();
    const beforeRestart = await submitAndStopWithRemoteIdentity(harness);
    const store = createCreativeStudioStore({ rootDir: harness.rootDir });
    const clock = new ControlledPollClock();
    const manager = createStudioJobManager({
      store,
      mediaStore: createStudioMediaStore({ store }),
      providerResolver: resolverFor(store, noProviders),
      adapters: harness.fake.adapters,
      listProviders: noProviders,
      sleep: clock.sleep,
      jitterMs: (baseMs) => baseMs,
    });
    extraManagers.add({ manager, clock });

    await manager.resumePendingJobs();

    const recovered = await waitFor(async () => {
      const project = await store.getProject(harness.project.id);
      return project?.jobs.job_recovery.status === 'needs_attention' ? project : null;
    });
    expect(recovered.jobs.job_recovery).toMatchObject({
      providerJobId: beforeRestart.providerJobId,
      status: 'needs_attention',
      error: { code: 'provider_unavailable' },
    });
    expect(recovered.scenes.scene_recovery.jobIds).toEqual(['job_recovery']);
  });
});
