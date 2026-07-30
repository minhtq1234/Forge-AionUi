/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioProject } from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store';

const mocks = vi.hoisted(() => ({
  listProjectsProvider: vi.fn(),
  createProjectProvider: vi.fn(),
  getProjectProvider: vi.fn(),
  proposeStoryboardProvider: vi.fn(),
  updateProjectProvider: vi.fn(),
  deleteProjectProvider: vi.fn(),
  updateSceneProvider: vi.fn(),
  reorderScenesProvider: vi.fn(),
  selectAssetProvider: vi.fn(),
  projectUpdatedEmit: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: {
      listProjects: { provider: mocks.listProjectsProvider },
      createProject: { provider: mocks.createProjectProvider },
      getProject: { provider: mocks.getProjectProvider },
      proposeStoryboard: { provider: mocks.proposeStoryboardProvider },
      updateProject: { provider: mocks.updateProjectProvider },
      deleteProject: { provider: mocks.deleteProjectProvider },
      updateScene: { provider: mocks.updateSceneProvider },
      reorderScenes: { provider: mocks.reorderScenesProvider },
      selectAsset: { provider: mocks.selectAssetProvider },
      projectUpdated: { emit: mocks.projectUpdatedEmit },
    },
  },
}));

import {
  buildCreativeStudioServiceDeps,
  initCreativeStudioBridge,
  type CreativeStudioBridgeDependencies,
} from '@process/bridge/creativeStudioBridge';
import { CreativeStudioServiceError } from '@process/services/creative-studio/creativeStudioService';

const project: StudioProject = {
  schemaVersion: 1,
  revision: 1,
  id: 'project_1',
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { image: null, video: null },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

type ProviderHandler = (input: unknown) => Promise<unknown>;

describe('initCreativeStudioBridge', () => {
  let dependencies: CreativeStudioBridgeDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies = {
      getService: () => ({
        listProjects: vi.fn(async () => []),
        createProject: vi.fn(async () => project),
        getProject: vi.fn(async () => project),
        proposeStoryboard: vi.fn(async () => project),
        updateProject: vi.fn(async () => project),
        deleteProject: vi.fn(async () => true),
        updateScene: vi.fn(async () => project),
        reorderScenes: vi.fn(async () => project),
        selectAsset: vi.fn(async () => project),
      }),
    };
  });

  it('registers every project command instead of leaving the renderer without a typed provider', () => {
    initCreativeStudioBridge(dependencies);

    expect(mocks.listProjectsProvider).toHaveBeenCalledOnce();
    expect(mocks.createProjectProvider).toHaveBeenCalledOnce();
    expect(mocks.getProjectProvider).toHaveBeenCalledOnce();
    expect(mocks.proposeStoryboardProvider).toHaveBeenCalledOnce();
    expect(mocks.updateProjectProvider).toHaveBeenCalledOnce();
    expect(mocks.deleteProjectProvider).toHaveBeenCalledOnce();
    expect(mocks.updateSceneProvider).toHaveBeenCalledOnce();
    expect(mocks.reorderScenesProvider).toHaveBeenCalledOnce();
    expect(mocks.selectAssetProvider).toHaveBeenCalledOnce();
  });

  it('returns a typed storage result instead of leaking an unexpected service exception', async () => {
    dependencies = {
      getService: () => ({
        listProjects: async () => {
          throw new Error('disk path /private/user/studio leaked');
        },
        createProject: vi.fn(),
        getProject: vi.fn(),
        proposeStoryboard: vi.fn(),
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        updateScene: vi.fn(),
        reorderScenes: vi.fn(),
        selectAsset: vi.fn(),
      }),
    };
    initCreativeStudioBridge(dependencies);
    const handler = mocks.listProjectsProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler(undefined)).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'creativeStudio.errors.storage' },
    });
  });

  it('maps a stale store result instead of exposing its raw message', async () => {
    dependencies = {
      getService: () => ({
        listProjects: vi.fn(async () => []),
        createProject: vi.fn(),
        getProject: vi.fn(),
        proposeStoryboard: vi.fn(),
        updateProject: async () => {
          throw new CreativeStudioStoreError('stale_project', 'raw compare-and-set failure');
        },
        deleteProject: vi.fn(),
        updateScene: vi.fn(),
        reorderScenes: vi.fn(),
        selectAsset: vi.fn(),
      }),
    };
    initCreativeStudioBridge(dependencies);
    const handler = mocks.updateProjectProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler({ projectId: 'project_1', expectedRevision: 1, name: 'Changed' })).resolves.toEqual({
      ok: false,
      error: { code: 'stale_project', messageKey: 'creativeStudio.errors.staleProject' },
    });
  });

  it('forwards an update-scene input once and returns canonical service data', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const handler = mocks.updateSceneProvider.mock.calls[0]?.[0] as ProviderHandler;
    const input = {
      projectId: 'project_1',
      expectedRevision: 1,
      sceneId: 'scene_1',
      scene: { id: 'scene_1' },
    };

    await expect(handler(input)).resolves.toEqual({ ok: true, data: project });
    expect(service.updateScene).toHaveBeenCalledOnce();
    expect(service.updateScene).toHaveBeenCalledWith(input);
  });

  it.each([
    ['planning_unavailable', 'creativeStudio.errors.planningUnavailable'],
    ['storyboard_exists', 'creativeStudio.errors.storyboardExists'],
    ['busy', 'creativeStudio.errors.busy'],
    ['provider_error', 'creativeStudio.errors.provider'],
    ['stale_project', 'creativeStudio.errors.staleProject'],
  ] as const)('returns a redacted %s planning envelope', async (code, messageKey) => {
    dependencies = {
      getService: () => ({
        listProjects: vi.fn(async () => []),
        createProject: vi.fn(),
        getProject: vi.fn(),
        proposeStoryboard: async () => {
          throw code === 'stale_project'
            ? new CreativeStudioStoreError(code, 'raw compare-and-set failure')
            : new CreativeStudioServiceError(code);
        },
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        updateScene: vi.fn(),
        reorderScenes: vi.fn(),
        selectAsset: vi.fn(),
      }),
    };
    initCreativeStudioBridge(dependencies);
    const handler = mocks.proposeStoryboardProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler({ projectId: 'project_1', expectedRevision: 1, replaceExisting: false })).resolves.toEqual({
      ok: false,
      error: { code, messageKey },
    });
  });

  it('delegates every registered provider once instead of bypassing the typed service boundary', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const sceneInput = {
      projectId: 'project_1',
      expectedRevision: 1,
      sceneId: 'scene_1',
      scene: { id: 'scene_1' },
    };
    const handlers: ReadonlyArray<[ReturnType<typeof vi.fn>, unknown]> = [
      [mocks.listProjectsProvider, undefined],
      [
        mocks.createProjectProvider,
        { name: 'Launch film', brief: '', aspectRatio: '16:9', targetDurationSeconds: 12, resolution: '1080p' },
      ],
      [mocks.getProjectProvider, { projectId: 'project_1' }],
      [mocks.proposeStoryboardProvider, { projectId: 'project_1', expectedRevision: 1, replaceExisting: false }],
      [mocks.updateProjectProvider, { projectId: 'project_1', expectedRevision: 1, name: 'Changed' }],
      [mocks.deleteProjectProvider, { projectId: 'project_1', expectedRevision: 1 }],
      [mocks.updateSceneProvider, sceneInput],
      [mocks.reorderScenesProvider, { projectId: 'project_1', expectedRevision: 1, sceneOrder: ['scene_1'] }],
      [
        mocks.selectAssetProvider,
        { projectId: 'project_1', expectedRevision: 1, sceneId: 'scene_1', assetId: 'asset_1' },
      ],
    ];

    await Promise.all(
      handlers.map(([provider, input]) => {
        const handler = provider.mock.calls[0]?.[0] as ProviderHandler;
        return handler(input);
      })
    );

    expect(service.listProjects).toHaveBeenCalledOnce();
    expect(service.createProject).toHaveBeenCalledOnce();
    expect(service.getProject).toHaveBeenCalledOnce();
    expect(service.proposeStoryboard).toHaveBeenCalledOnce();
    expect(service.updateProject).toHaveBeenCalledOnce();
    expect(service.deleteProject).toHaveBeenCalledOnce();
    expect(service.updateScene).toHaveBeenCalledOnce();
    expect(service.reorderScenes).toHaveBeenCalledOnce();
    expect(service.selectAsset).toHaveBeenCalledOnce();
  });

  it('builds a project-id-only event dependency instead of exposing full project data', () => {
    const deps = buildCreativeStudioServiceDeps();

    deps.onProjectUpdated('project_1');

    expect(mocks.projectUpdatedEmit).toHaveBeenCalledWith({ projectId: 'project_1' });
  });
});
