/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAsset,
  StudioCommandResult,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import StudioPage from '@renderer/pages/studio/StudioPage';

const bridge = vi.hoisted(() => ({
  getProject: { invoke: vi.fn() },
  listRoutes: { invoke: vi.fn() },
  updateScene: { invoke: vi.fn() },
  reorderScenes: { invoke: vi.fn() },
  proposeStoryboard: { invoke: vi.fn() },
  chooseAndImportReference: { invoke: vi.fn() },
  chooseAndExportAssets: { invoke: vi.fn() },
  submitScenes: { invoke: vi.fn() },
  cancelJob: { invoke: vi.fn() },
  retryJob: { invoke: vi.fn() },
  retryDownload: { invoke: vi.fn() },
  selectAsset: { invoke: vi.fn() },
  listConnectionCandidates: { invoke: vi.fn() },
  listConnections: { invoke: vi.fn() },
  validateConnection: { invoke: vi.fn() },
  saveConnection: { invoke: vi.fn() },
  removeConnection: { invoke: vi.fn() },
  projectUpdated: { on: vi.fn() },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${Object.values(values).join(',')}`,
  }),
}));

const ok = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });

const scene = (id: string, selectedAssetId: string | null): StudioScene => ({
  id,
  title: id === 'scene-1' ? 'Opening' : 'Closing',
  purpose: 'Tell the story',
  visualPrompt: 'A cinematic frame',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId,
  assetIds: selectedAssetId === null ? [] : [selectedAssetId],
  jobIds: [],
  reviewState: selectedAssetId === null ? 'ready' : 'complete',
});

const asset = (id: string, sceneId: string): StudioAsset => ({
  id,
  projectId: 'project-1',
  sceneId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 128,
  sha256: id.padEnd(64, 'a').slice(0, 64),
  createdAt: '2026-07-30T00:00:00.000Z',
});

const project = (withSelectedAssets = true): StudioRendererProject => {
  const first = scene('scene-1', withSelectedAssets ? 'asset-1' : null);
  const second = scene('scene-2', withSelectedAssets ? 'asset-2' : null);
  return {
    schemaVersion: 1,
    revision: 2,
    id: 'project-1',
    name: 'Launch film',
    brief: 'A short launch video',
    aspectRatio: '16:9',
    targetDurationSeconds: 10,
    resolution: '720p',
    sceneOrder: [first.id, second.id],
    scenes: { [first.id]: first, [second.id]: second },
    assets: withSelectedAssets
      ? {
          'asset-1': asset('asset-1', first.id),
          'asset-2': asset('asset-2', second.id),
        }
      : {},
    jobs: {},
    routing: { storyboard: null, image: null, video: null },
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
};

const routes = (): StudioRouteCatalog => ({
  planning: {
    health: 'ready',
    resolvedModel: { providerId: 'provider-1', model: 'operations-model' },
  },
  automatic: [],
  providerModels: [],
  suggestions: {
    image: { reason: 'no_compatible_route', route: null },
    video: { reason: 'no_compatible_route', route: null },
  },
  catalogVersion: 'catalog-1',
});

const renderProject = () => {
  const router = createMemoryRouter([{ path: '/studio/:id', element: <StudioPage /> }], {
    initialEntries: ['/studio/project-1'],
  });
  return render(<RouterProvider router={router} />);
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('Studio asset export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.getProject.invoke.mockResolvedValue(ok(project()));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    bridge.updateScene.invoke.mockResolvedValue(ok(project()));
    bridge.reorderScenes.invoke.mockResolvedValue(ok(project()));
    bridge.proposeStoryboard.invoke.mockResolvedValue(ok(project()));
    bridge.chooseAndImportReference.invoke.mockResolvedValue(ok({ status: 'cancelled' }));
    bridge.chooseAndExportAssets.invoke.mockResolvedValue(
      ok({
        status: 'exported',
        folderName: 'Launch-film-20260730-151500',
        exported: [
          { assetId: 'asset-1', fileName: 'scene-01.png' },
          { assetId: 'asset-2', fileName: 'scene-02.png' },
        ],
        missingSceneIds: [],
      })
    );
    bridge.submitScenes.invoke.mockResolvedValue(ok([]));
    bridge.cancelJob.invoke.mockResolvedValue(ok(null));
    bridge.retryJob.invoke.mockResolvedValue(ok(null));
    bridge.retryDownload.invoke.mockResolvedValue(ok(null));
    bridge.selectAsset.invoke.mockResolvedValue(ok(project()));
    bridge.listConnectionCandidates.invoke.mockResolvedValue(ok([]));
    bridge.listConnections.invoke.mockResolvedValue(ok([]));
    bridge.validateConnection.invoke.mockResolvedValue(ok(null));
    bridge.saveConnection.invoke.mockResolvedValue(ok(null));
    bridge.removeConnection.invoke.mockResolvedValue(ok(false));
    bridge.projectUpdated.on.mockReturnValue(() => {});
  });

  it('opens the native destination chooser with IDs only and reports the returned folder name', async () => {
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.export.action',
      })
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('conversation.creativeStudio.export.body');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.export.confirm',
      })
    );

    await waitFor(() =>
      expect(bridge.chooseAndExportAssets.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        includeReferences: false,
      })
    );
    expect(JSON.stringify(bridge.chooseAndExportAssets.invoke.mock.calls[0]?.[0])).not.toMatch(
      /path|directory|destination|file:|https?:|data:/i
    );
    expect(
      await screen.findByText('conversation.creativeStudio.export.successBody:Launch-film-20260730-151500')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Export video/i)).not.toBeInTheDocument();
  });

  it('exports imported references only when the user opts in', async () => {
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.export.action',
      })
    );
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'conversation.creativeStudio.export.includeReferences',
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.export.confirm',
      })
    );

    await waitFor(() =>
      expect(bridge.chooseAndExportAssets.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        includeReferences: true,
      })
    );
  });

  it('reports a collision-safe folder name and every scene missing from a partial export', async () => {
    bridge.chooseAndExportAssets.invoke.mockResolvedValueOnce(
      ok({
        status: 'exported',
        folderName: 'Launch-film-20260730-151500-2',
        exported: [{ assetId: 'asset-1', fileName: 'scene-01.png' }],
        missingSceneIds: ['scene-2'],
      })
    );
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.export.action',
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.export.confirm',
      })
    );

    expect(
      await screen.findByRole('dialog', {
        name: 'conversation.creativeStudio.export.partialTitle',
      })
    ).toHaveTextContent('conversation.creativeStudio.export.partialBody:Launch-film-20260730-151500-2');
    expect(screen.getByText('Launch-film-20260730-151500-2')).toBeInTheDocument();
    expect(screen.getByText(/conversation\.creativeStudio\.export\.missingScenes:.*scene-2/)).toBeInTheDocument();
  });

  it('treats native chooser cancellation as a harmless closed flow', async () => {
    bridge.chooseAndExportAssets.invoke.mockResolvedValueOnce(ok({ status: 'cancelled' }));
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.export.action',
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.export.confirm',
      })
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('conversation.creativeStudio.export.successTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.export.failed')).not.toBeInTheDocument();
  });

  it('explains that no selected scene assets are ready and does not open the native chooser', async () => {
    bridge.getProject.invoke.mockResolvedValue(ok(project(false)));
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.export.action',
      })
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('conversation.creativeStudio.export.noSelectedAssets');
    const confirm = screen.getByRole('button', {
      name: 'conversation.creativeStudio.export.confirm',
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(bridge.chooseAndExportAssets.invoke).not.toHaveBeenCalled();
  });

  it('keeps the export review open and surfaces a typed bridge rejection', async () => {
    bridge.chooseAndExportAssets.invoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'storage_error',
        messageKey: 'conversation.creativeStudio.errors.storage',
      },
    });
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.export.action',
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.export.confirm',
      })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.export.failed');
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.storage');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cannot export stale canonical data while a scene edit is unsaved or still saving', async () => {
    const save = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(save.promise);
    renderProject();

    const prompt = await screen.findByLabelText('conversation.creativeStudio.inspector.visualPromptLabel');
    const exportAction = screen.getByRole('button', {
      name: 'conversation.creativeStudio.export.action',
    });
    fireEvent.change(prompt, { target: { value: 'A newly edited cinematic frame' } });

    expect(exportAction).toBeDisabled();
    fireEvent.blur(prompt);
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    expect(exportAction).toBeDisabled();
    fireEvent.click(exportAction);
    expect(bridge.chooseAndExportAssets.invoke).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve(ok(project()));
      await save.promise;
    });
    await waitFor(() => expect(exportAction).toBeEnabled());
  });
});
