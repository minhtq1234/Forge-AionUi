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
import { CreativeStudioMediaError } from '@process/services/creative-studio/mediaStore';

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
  chooseAndImportReferenceProvider: vi.fn(),
  chooseAndExportAssetsProvider: vi.fn(),
  submitScenesProvider: vi.fn(),
  cancelJobProvider: vi.fn(),
  retryJobProvider: vi.fn(),
  retryDownloadProvider: vi.fn(),
  listConnectionCandidatesProvider: vi.fn(),
  listConnectionsProvider: vi.fn(),
  validateConnectionProvider: vi.fn(),
  saveConnectionProvider: vi.fn(),
  removeConnectionProvider: vi.fn(),
  listRoutesProvider: vi.fn(),
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
      chooseAndImportReference: { provider: mocks.chooseAndImportReferenceProvider },
      chooseAndExportAssets: { provider: mocks.chooseAndExportAssetsProvider },
      submitScenes: { provider: mocks.submitScenesProvider },
      cancelJob: { provider: mocks.cancelJobProvider },
      retryJob: { provider: mocks.retryJobProvider },
      retryDownload: { provider: mocks.retryDownloadProvider },
      listConnectionCandidates: { provider: mocks.listConnectionCandidatesProvider },
      listConnections: { provider: mocks.listConnectionsProvider },
      validateConnection: { provider: mocks.validateConnectionProvider },
      saveConnection: { provider: mocks.saveConnectionProvider },
      removeConnection: { provider: mocks.removeConnectionProvider },
      listRoutes: { provider: mocks.listRoutesProvider },
      projectUpdated: { emit: mocks.projectUpdatedEmit },
    },
  },
}));

import { initCreativeStudioBridge, type CreativeStudioBridgeDependencies } from '@process/bridge/creativeStudioBridge';
import { CreativeStudioServiceError } from '@process/services/creative-studio/creativeStudioService';
import { StudioJobManagerError } from '@process/services/creative-studio/jobManager';

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
  routing: { storyboard: null, image: null, video: null },
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
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
        submitScenes: vi.fn(async () => []),
        cancelJob: vi.fn(),
        retryJob: vi.fn(),
        retryDownload: vi.fn(),
        listConnectionCandidates: vi.fn(async () => []),
        listConnections: vi.fn(async () => []),
        validateConnection: vi.fn(),
        saveConnection: vi.fn(),
        removeConnection: vi.fn(),
        listRoutes: vi.fn(),
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
    expect(mocks.chooseAndImportReferenceProvider).toHaveBeenCalledOnce();
    expect(mocks.chooseAndExportAssetsProvider).toHaveBeenCalledOnce();
    expect(mocks.submitScenesProvider).toHaveBeenCalledOnce();
    expect(mocks.cancelJobProvider).toHaveBeenCalledOnce();
    expect(mocks.retryJobProvider).toHaveBeenCalledOnce();
    expect(mocks.retryDownloadProvider).toHaveBeenCalledOnce();
    expect(mocks.listConnectionCandidatesProvider).toHaveBeenCalledOnce();
    expect(mocks.listConnectionsProvider).toHaveBeenCalledOnce();
    expect(mocks.validateConnectionProvider).toHaveBeenCalledOnce();
    expect(mocks.saveConnectionProvider).toHaveBeenCalledOnce();
    expect(mocks.removeConnectionProvider).toHaveBeenCalledOnce();
    expect(mocks.listRoutesProvider).toHaveBeenCalledOnce();
  });

  it('delegates generation mutations with their route, revision, and acknowledgement contracts intact', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const submit = mocks.submitScenesProvider.mock.calls[0]?.[0] as ProviderHandler;
    const cancel = mocks.cancelJobProvider.mock.calls[0]?.[0] as ProviderHandler;
    const retry = mocks.retryJobProvider.mock.calls[0]?.[0] as ProviderHandler;
    const retryDownload = mocks.retryDownloadProvider.mock.calls[0]?.[0] as ProviderHandler;
    const submitInput = {
      projectId: 'project_1',
      expectedRevision: 1,
      sceneIds: ['scene_1'],
      catalogVersion: '0123456789abcdef',
      routes: [
        {
          sceneId: 'scene_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'open-sora',
          kind: 'video',
        },
      ],
    };
    const jobInput = { projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 };
    const retryInput = { ...jobInput, acknowledgePossibleDuplicateCharge: true };

    await submit(submitInput);
    await cancel(jobInput);
    await retry(retryInput);
    await retryDownload(jobInput);

    expect(service.submitScenes).toHaveBeenCalledWith(submitInput);
    expect(service.cancelJob).toHaveBeenCalledWith(jobInput);
    expect(service.retryJob).toHaveBeenCalledWith(retryInput);
    expect(service.retryDownload).toHaveBeenCalledWith(jobInput);
  });

  it.each([
    [
      'cancelJob',
      mocks.cancelJobProvider,
      new StudioJobManagerError('cancellation_refused'),
      'cancellation_refused',
      'conversation.creativeStudio.errors.cancellationRefused',
    ],
    [
      'retryJob',
      mocks.retryJobProvider,
      new StudioJobManagerError('duplicate_charge_acknowledgement_required'),
      'duplicate_charge_acknowledgement_required',
      'conversation.creativeStudio.errors.duplicateChargeAcknowledgementRequired',
    ],
    [
      'retryDownload',
      mocks.retryDownloadProvider,
      new StudioJobManagerError('unsupported'),
      'unsupported',
      'conversation.creativeStudio.jobs.errors.unsupported',
    ],
  ] as const)(
    'redacts %s manager failures into a stable typed command envelope',
    async (method, provider, failure, code, messageKey) => {
      const service = {
        ...dependencies.getService(),
        [method]: vi.fn(async () => {
          throw failure;
        }),
      };
      initCreativeStudioBridge({ getService: () => service });
      const handler = provider.mock.calls[0]?.[0] as ProviderHandler;

      await expect(handler({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 1 })).resolves.toEqual({
        ok: false,
        error: { code, messageKey },
      });
    }
  );

  it('delegates connection and route commands through the same redacted command envelope', async () => {
    const service = {
      ...dependencies.getService(),
      listConnectionCandidates: vi.fn(async () => [
        {
          providerId: 'provider_1',
          providerName: 'Gateway',
          models: [{ model: 'open-sora', health: 'available' as const }],
        },
      ]),
      listConnections: vi.fn(async () => [
        {
          schemaVersion: 1 as const,
          id: 'binding_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1' as const,
          model: 'open-sora',
          capabilities: { mediaKinds: ['video' as const], audioModes: ['none'] },
          validatedAt: '2026-07-30T00:00:00.000Z',
        },
      ]),
      validateConnection: vi.fn(async () => {
        throw new CreativeStudioServiceError('provider_error');
      }),
      saveConnection: vi.fn(),
      removeConnection: vi.fn(),
      listRoutes: vi.fn(),
    };
    initCreativeStudioBridge({ getService: () => service });
    const candidates = mocks.listConnectionCandidatesProvider.mock.calls[0]?.[0] as ProviderHandler;
    const connections = mocks.listConnectionsProvider.mock.calls[0]?.[0] as ProviderHandler;
    const validate = mocks.validateConnectionProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(candidates(undefined)).resolves.toEqual({ ok: true, data: await service.listConnectionCandidates() });
    await expect(connections(undefined)).resolves.toEqual({ ok: true, data: await service.listConnections() });
    await expect(
      validate({ providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'open-sora' })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'provider_error', messageKey: 'conversation.creativeStudio.errors.provider' },
    });
  });

  it('returns explicit cancellation outcomes without handing a path to either service operation', async () => {
    const service = dependencies.getService();
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: ['/private/ignored.png'] }));
    const showExportDialog = vi.fn(async () => ({ canceled: true, filePaths: ['/private/ignored-export'] }));
    initCreativeStudioBridge({
      getService: () => service,
      getParentWindow: () => undefined,
      showOpenDialog,
      showExportDialog,
    });
    const importHandler = mocks.chooseAndImportReferenceProvider.mock.calls[0]?.[0] as ProviderHandler;
    const exportHandler = mocks.chooseAndExportAssetsProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(importHandler({ projectId: 'project_1', expectedRevision: 1, sceneId: 'scene_1' })).resolves.toEqual({
      ok: true,
      data: { status: 'cancelled' },
    });
    await expect(exportHandler({ projectId: 'project_1', includeReferences: true })).resolves.toEqual({
      ok: true,
      data: { status: 'cancelled' },
    });
    expect(service.importReferenceFromPath).not.toHaveBeenCalled();
    expect(service.exportAssetsToDirectory).not.toHaveBeenCalled();
  });

  it('keeps selected paths in main while returning only safe import and export DTOs', async () => {
    const importPath = '/private/user/reference.png';
    const exportPath = '/private/user/export-target';
    const asset = {
      id: 'asset_1',
      projectId: 'project_1',
      sceneId: null,
      mediaKind: 'image' as const,
      mimeType: 'image/png',
      managedAsset: { collection: 'imports' as const, fileName: 'asset_1.png' },
      byteSize: 33,
      sha256: 'a'.repeat(64),
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    const service = {
      ...dependencies.getService(),
      importReferenceFromPath: vi.fn(async () => asset),
      exportAssetsToDirectory: vi.fn(async () => ({
        folderName: 'Film-20260730-120000',
        exported: [{ assetId: 'asset_1', fileName: 'scene-01.png' }],
        missingSceneIds: [],
      })),
    };
    initCreativeStudioBridge({
      getService: () => service,
      getParentWindow: () => undefined,
      showOpenDialog: async () => ({ canceled: false, filePaths: [importPath] }),
      showExportDialog: async () => ({ canceled: false, filePaths: [exportPath] }),
    });
    const importHandler = mocks.chooseAndImportReferenceProvider.mock.calls[0]?.[0] as ProviderHandler;
    const exportHandler = mocks.chooseAndExportAssetsProvider.mock.calls[0]?.[0] as ProviderHandler;

    const imported = await importHandler({ projectId: 'project_1', expectedRevision: 1 });
    const exported = await exportHandler({ projectId: 'project_1', includeReferences: false });

    expect(service.importReferenceFromPath).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 1,
      sourcePath: importPath,
    });
    expect(service.exportAssetsToDirectory).toHaveBeenCalledWith({
      projectId: 'project_1',
      includeReferences: false,
      destinationDirectory: exportPath,
    });
    expect(imported).toEqual({ ok: true, data: { status: 'imported', asset } });
    expect(exported).toEqual({
      ok: true,
      data: {
        status: 'exported',
        folderName: 'Film-20260730-120000',
        exported: [{ assetId: 'asset_1', fileName: 'scene-01.png' }],
        missingSceneIds: [],
      },
    });
    expect(JSON.stringify({ imported, exported })).not.toContain('/private/user');
  });

  it.each([
    [
      new CreativeStudioMediaError('invalid_media'),
      'invalid_payload',
      'conversation.creativeStudio.errors.invalidPayload',
    ],
    [new CreativeStudioMediaError('storage_error'), 'storage_error', 'conversation.creativeStudio.errors.storage'],
  ] as const)('maps media failures without leaking their main-process details', async (failure, code, messageKey) => {
    const service = {
      ...dependencies.getService(),
      importReferenceFromPath: vi.fn(async () => {
        throw failure;
      }),
    };
    initCreativeStudioBridge({
      getService: () => service,
      getParentWindow: () => undefined,
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/sensitive.png'] }),
    });
    const handler = mocks.chooseAndImportReferenceProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler({ projectId: 'project_1', expectedRevision: 1 })).resolves.toEqual({
      ok: false,
      error: { code, messageKey },
    });
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
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
      }),
    };
    initCreativeStudioBridge(dependencies);
    const handler = mocks.listProjectsProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler(undefined)).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
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
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
      }),
    };
    initCreativeStudioBridge(dependencies);
    const handler = mocks.updateProjectProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler({ projectId: 'project_1', expectedRevision: 1, name: 'Changed' })).resolves.toEqual({
      ok: false,
      error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' },
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
    ['planning_unavailable', 'conversation.creativeStudio.errors.planningUnavailable'],
    ['storyboard_exists', 'conversation.creativeStudio.errors.storyboardExists'],
    ['busy', 'conversation.creativeStudio.errors.busy'],
    ['provider_error', 'conversation.creativeStudio.errors.provider'],
    ['stale_project', 'conversation.creativeStudio.errors.staleProject'],
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
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
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
});
