/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { StudioProject, StudioScene, StudioSceneRouteSnapshot } from '@/common/types/project/creativeStudioTypes';
import { createStudioE2EFakeBundle } from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import { createStudioJobManager, type StudioJobManager } from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import { afterEach, describe, expect, it } from 'vitest';

const scene: StudioScene = {
  id: 'scene_1',
  title: 'Opening',
  purpose: 'Introduce the product',
  visualPrompt: 'A paper airplane crossing a sunrise',
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
  if (attemptsRemaining <= 1) throw new Error('Timed out waiting for Creative Studio integration state');
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  return waitFor(read, attemptsRemaining - 1);
};

type PendingSleep = {
  delayMs: number;
  release(): void;
};

class ControlledPollClock {
  readonly observedDelays: number[] = [];
  private readonly pending: PendingSleep[] = [];
  private autoRelease = false;

  readonly sleep = (delayMs: number, signal?: AbortSignal): Promise<void> => {
    this.observedDelays.push(delayMs);
    if (this.autoRelease) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = (): void => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        finish(error);
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
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

type Harness = {
  rootDir: string;
  project: StudioProject;
  route: StudioSceneRouteSnapshot;
  manager: StudioJobManager;
  clock: ControlledPollClock;
  store: ReturnType<typeof createCreativeStudioStore>;
  mediaStore: ReturnType<typeof createStudioMediaStore>;
  fake: ReturnType<typeof createStudioE2EFakeBundle>;
};

const activeHarnesses: Harness[] = [];

const createHarness = async (): Promise<Harness> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-generation-integration-'));
  const fake = createStudioE2EFakeBundle({ rootDir });
  const store = createCreativeStudioStore({ rootDir });
  await store.saveConnection(fake.connections[0]!);
  const created = await store.createProject({
    name: 'Launch film',
    brief: 'A concise launch story',
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '720p',
  });
  const project = await store.updateProject(created.id, (current) => ({
    ...current,
    sceneOrder: [scene.id],
    scenes: { [scene.id]: structuredClone(scene) },
  }));
  const listProviders = async () => [fake.provider];
  const providerResolver = createStudioProviderResolver({
    listProviders,
    getClientSettings: async () => ({}),
    getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
    listConnections: () => store.listConnections(),
  });
  const catalog = await providerResolver.listRoutes({ routing: project.routing });
  const videoRoute = catalog.automatic.find((candidate) => candidate.kind === 'video');
  if (!videoRoute) throw new Error('E2E fake video route was not resolved');
  const route: StudioSceneRouteSnapshot = {
    sceneId: scene.id,
    providerId: videoRoute.providerId,
    adapterId: videoRoute.adapterId,
    model: videoRoute.model,
    kind: videoRoute.kind,
  };
  const mediaStore = createStudioMediaStore({ store });
  const clock = new ControlledPollClock();
  const manager = createStudioJobManager({
    store,
    mediaStore,
    providerResolver,
    adapters: fake.adapters,
    listProviders,
    createJobId: () => 'job_lifecycle',
    createIdempotencyKey: () => 'idempotency_lifecycle',
    sleep: clock.sleep,
    jitterMs: (baseMs) => baseMs,
  });
  const harness = { rootDir, project, route, manager, clock, store, mediaStore, fake };
  activeHarnesses.push(harness);
  return harness;
};

const forbiddenDtoKeys = new Set([
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
]);

const collectForbiddenDtoKeys = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) collectForbiddenDtoKeys(item, found);
    return found;
  }
  if (typeof value !== 'object' || value === null) return found;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replaceAll(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (forbiddenDtoKeys.has(normalized)) found.push(key);
    collectForbiddenDtoKeys(nested, found);
  }
  return found;
};

afterEach(async () => {
  await Promise.all(
    activeHarnesses.splice(0).map(async (harness) => {
      harness.clock.releaseAll();
      await harness.manager.dispose().catch((): undefined => undefined);
      await harness.fake.dispose().catch((): undefined => undefined);
      await rm(harness.rootDir, { recursive: true, force: true });
    })
  );
});

describe('Creative Studio generation lifecycle integration', () => {
  it('moves a remote video through queued and running states before selecting a managed output', async () => {
    const harness = await createHarness();
    const catalog = await createStudioProviderResolver({
      listProviders: async () => [harness.fake.provider],
      getClientSettings: async () => ({}),
      getPlanningReadiness: async () => ({ setting: { mode: 'auto' }, health: 'ready' }),
      listConnections: () => harness.store.listConnections(),
    }).listRoutes({ routing: harness.project.routing });

    const submitted = await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: [scene.id],
      routes: [harness.route],
      catalogVersion: catalog.catalogVersion,
    });

    expect(submitted).toMatchObject([{ id: 'job_lifecycle', status: 'queued_local', providerJobId: null }]);
    const queued = await waitFor(async () => {
      const job = (await harness.store.getProject(harness.project.id))?.jobs.job_lifecycle;
      return job?.status === 'queued_remote' ? job : null;
    });
    expect(queued.providerJobId).toBe('e2e_job_1');

    const firstPoll = await harness.clock.take(2_000);
    firstPoll.release();
    const secondPoll = await harness.clock.take(4_000);
    secondPoll.release();
    const thirdPoll = await harness.clock.take(8_000);
    const running = await waitFor(async () => {
      const job = (await harness.store.getProject(harness.project.id))?.jobs.job_lifecycle;
      return job?.status === 'running' ? job : null;
    });
    expect(running.progress).toBe(50);
    thirdPoll.release();

    const completed = await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      return project &&
        ['succeeded', 'failed', 'cancelled', 'needs_attention'].includes(project.jobs.job_lifecycle.status)
        ? project
        : null;
    });
    const completedJob = completed.jobs.job_lifecycle;
    expect(completedJob).toMatchObject({ status: 'succeeded', error: null });
    const selectedAssetId = completed.scenes.scene_1.selectedAssetId;
    expect({
      outputAssetIds: completedJob.outputAssetIds,
      selectedAssetId,
      assetIds: completed.scenes.scene_1.assetIds,
      mediaKind: selectedAssetId ? completed.assets[selectedAssetId]?.mediaKind : null,
      collection: selectedAssetId ? completed.assets[selectedAssetId]?.managedAsset.collection : null,
    }).toEqual({
      outputAssetIds: [selectedAssetId],
      selectedAssetId,
      assetIds: [selectedAssetId],
      mediaKind: 'video',
      collection: 'assets',
    });
    const resolved = selectedAssetId ? await harness.mediaStore.resolveAsset(completed.id, selectedAssetId) : null;
    expect(resolved?.asset.id).toBe(selectedAssetId);
    expect(collectForbiddenDtoKeys(completed)).toEqual([]);
    const serialized = JSON.stringify(completed);
    expect(serialized).not.toContain(harness.rootDir);
    expect(serialized).not.toContain(harness.fake.provider.api_key);
    expect(serialized).not.toContain(harness.fake.provider.base_url);
  });

  it('rejects a stale route catalog without persisting or submitting a job', async () => {
    const harness = await createHarness();

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: [scene.id],
        routes: [harness.route],
        catalogVersion: 'stale_catalog',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
    expect(harness.clock.observedDelays).toEqual([]);
  });
});
