/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import StudioPage from '@renderer/pages/studio/StudioPage';
import { useStudioProject } from '@renderer/pages/studio/hooks';

const bridge = vi.hoisted(() => ({
  getProject: { invoke: vi.fn() },
  listRoutes: { invoke: vi.fn() },
  updateScene: { invoke: vi.fn() },
  reorderScenes: { invoke: vi.fn() },
  proposeStoryboard: { invoke: vi.fn() },
  projectUpdated: { on: vi.fn() },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const ok = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });
const failure = <T,>(): StudioCommandResult<T> => ({
  ok: false,
  error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
});
const stale = <T,>(): StudioCommandResult<T> => ({
  ok: false,
  error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' },
});

const project = (id = 'project-1', overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 2,
  id,
  name: id === 'project-1' ? 'Launch film' : 'Second film',
  brief: 'A short launch video',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '720p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { image: null, video: null },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene-1',
  title: 'Opening',
  purpose: 'Introduce the story',
  visualPrompt: 'A bright studio',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'draft',
  ...overrides,
});

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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const renderRoute = (path = '/studio/project-1') => {
  const router = createMemoryRouter([{ path: '/studio/:id', element: <StudioPage /> }], { initialEntries: [path] });
  return { router, view: render(<RouterProvider router={router} />) };
};

const ProjectHookHarness: React.FC = () => {
  const { project: currentProject, refetch } = useStudioProject('project-1');

  return (
    <>
      <span>{currentProject?.name}</span>
      <button type='button' onClick={() => void refetch()}>
        Refetch project
      </button>
    </>
  );
};

describe('StudioPage and useStudioProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
    bridge.getProject.invoke.mockResolvedValue(ok(project()));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    bridge.updateScene.invoke.mockImplementation(async () => ok(project()));
    bridge.reorderScenes.invoke.mockImplementation(async () => ok(project()));
    bridge.proposeStoryboard.invoke.mockImplementation(async () => ok(project()));
    bridge.projectUpdated.on.mockReturnValue(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading shell while the canonical project is being fetched', () => {
    bridge.getProject.invoke.mockReturnValue(new Promise(() => {}));
    renderRoute();

    expect(screen.getByText('conversation.creativeStudio.project.loading')).toBeInTheDocument();
  });

  it('renders the durable project shell after a canonical result', async () => {
    renderRoute();

    expect(await screen.findByRole('heading', { level: 1, name: 'Launch film' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.draft.action' })).toBeInTheDocument();
  });

  it('composes the storyboard-first workspace from the canonical project', async () => {
    const opening = scene();
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );

    renderRoute();

    expect(await screen.findByText('conversation.creativeStudio.storyboard.title')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.preview.noAssetTitle')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.inspector.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.draft.action' })).toBeInTheDocument();
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledWith({ projectId: 'project-1' }));
  });

  it('routes an empty-project add conflict to always-visible recovery controls', async () => {
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(project()))
      .mockResolvedValueOnce(ok(project('project-1', { revision: 3 })));
    bridge.updateScene.invoke.mockResolvedValueOnce(stale());
    renderRoute();

    await screen.findByRole('heading', { level: 1, name: 'Launch film' });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.addScene' }));

    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(
      await screen.findByRole(
        'button',
        {
          name: 'conversation.creativeStudio.storyboard.retry',
        },
        { timeout: 5_000 }
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.storyboard.discard',
      })
    ).toBeInTheDocument();
  });

  it('keeps stale scene-save recovery reachable when the canonical refetch removes every scene', async () => {
    const opening = scene();
    bridge.getProject.invoke
      .mockResolvedValueOnce(
        ok(
          project('project-1', {
            sceneOrder: [opening.id],
            scenes: { [opening.id]: opening },
          })
        )
      )
      .mockResolvedValueOnce(ok(project('project-1', { revision: 3 })));
    bridge.updateScene.invoke.mockResolvedValueOnce(stale());
    renderRoute();

    const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(titleInput, { target: { value: 'Updated opening' } });
    fireEvent.blur(titleInput);

    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(
      await screen.findByRole(
        'button',
        {
          name: 'conversation.creativeStudio.storyboard.retry',
        },
        { timeout: 5_000 }
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.storyboard.discard',
      })
    ).toBeInTheDocument();
  });

  it('blocks project navigation until a stale scene draft is explicitly retried or discarded', async () => {
    const opening = scene();
    let projectOneFetches = 0;
    bridge.getProject.invoke.mockImplementation(async ({ projectId }: { projectId: string }) => {
      if (projectId === 'project-2') return ok(project('project-2'));
      projectOneFetches += 1;
      return ok(
        project('project-1', {
          revision: projectOneFetches === 1 ? 2 : 3,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      );
    });
    bridge.updateScene.invoke.mockResolvedValueOnce(stale());
    const { router } = renderRoute();

    const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(titleInput, { target: { value: 'Keep this local title' } });
    fireEvent.blur(titleInput);
    await screen.findByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' }, { timeout: 5_000 });

    await act(async () => router.navigate('/studio/project-2'));

    expect(router.state.location.pathname).toBe('/studio/project-1');
    expect(screen.getByRole('heading', { level: 1, name: 'Launch film' })).toBeInTheDocument();
    expect(bridge.getProject.invoke).not.toHaveBeenCalledWith({ projectId: 'project-2' });

    fireEvent.click(screen.getAllByRole('button', { name: 'conversation.creativeStudio.storyboard.discard' })[0]);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' })
      ).not.toBeInTheDocument()
    );
    await act(async () => router.navigate('/studio/project-2'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Second film' })).toBeInTheDocument();
  });

  it('offers explicit retry and discard before leaving after a typed scene-save failure', async () => {
    const opening = scene();
    bridge.getProject.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(
        project(projectId, {
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.updateScene.invoke.mockResolvedValueOnce(failure());
    const { router } = renderRoute();

    const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(titleInput, { target: { value: 'Unsaved typed failure' } });
    fireEvent.blur(titleInput);

    expect(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.discard' })).toBeInTheDocument();

    await act(async () => router.navigate('/studio/project-2'));
    expect(router.state.location.pathname).toBe('/studio/project-1');

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.discard' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' })
      ).not.toBeInTheDocument()
    );
    await act(async () => router.navigate('/studio/project-2'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Second film' })).toBeInTheDocument();
  });

  it('prioritizes a stale non-save conflict before a queued scene-save issue', async () => {
    const opening = scene();
    const reveal = scene({ id: 'scene-2', title: 'Reveal' });
    const initial = project('project-1', {
      sceneOrder: [opening.id, reveal.id],
      scenes: { [opening.id]: opening, [reveal.id]: reveal },
    });
    const refreshed = project('project-1', {
      revision: 8,
      sceneOrder: [opening.id, reveal.id],
      scenes: { [opening.id]: opening, [reveal.id]: reveal },
    });
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.getProject.invoke.mockResolvedValueOnce(ok(initial)).mockResolvedValueOnce(ok(refreshed));
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    bridge.reorderScenes.invoke.mockResolvedValueOnce(stale()).mockResolvedValueOnce(
      ok(
        project('project-1', {
          revision: 9,
          sceneOrder: [reveal.id, opening.id],
          scenes: { [opening.id]: opening, [reveal.id]: reveal },
        })
      )
    );
    renderRoute();

    const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(titleInput, { target: { value: 'Unresolved opening edit' } });
    fireEvent.blur(titleInput);
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole('button', { name: 'conversation.creativeStudio.scene.accessibleName' })[1]);
    await act(async () => firstSave.resolve(failure()));
    expect(await screen.findByText('conversation.creativeStudio.errors.storage')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'conversation.creativeStudio.storyboard.moveUp: conversation.creativeStudio.scene.accessibleName',
      })[1]
    );
    await waitFor(() => expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('conversation.creativeStudio.errors.staleProject')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' }));
    await waitFor(() => expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(2));

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
  });

  it('shows not found when the bridge succeeds with no canonical project', async () => {
    bridge.getProject.invoke.mockResolvedValue(ok(null));
    renderRoute();

    expect(await screen.findByText('conversation.creativeStudio.project.notFound')).toBeInTheDocument();
  });

  it('shows the typed command error separately from not found', async () => {
    bridge.getProject.invoke.mockResolvedValue(failure());
    renderRoute();

    expect(await screen.findByText('conversation.creativeStudio.errors.storage')).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.project.notFound')).not.toBeInTheDocument();
  });

  it('resets and fetches again when the route project id changes', async () => {
    const { router } = renderRoute('/studio/project-1');
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });
    bridge.getProject.invoke.mockResolvedValue(ok(project('project-2')));

    await act(async () => router.navigate('/studio/project-2'));

    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenLastCalledWith({ projectId: 'project-2' }));
  });

  it('flushes a dirty scene draft before switching to another project route', async () => {
    const opening = scene();
    bridge.getProject.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(
        project(projectId, {
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.updateScene.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          revision: 3,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: { ...opening, title: 'Unsaved project A title' } },
        })
      )
    );
    const { router } = renderRoute('/studio/project-1');
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel'), {
      target: { value: 'Unsaved project A title' },
    });
    await act(async () => router.navigate('/studio/project-2'));

    await waitFor(() =>
      expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
        projectId: 'project-1',
        sceneId: 'scene-1',
        expectedRevision: 2,
        scene: expect.objectContaining({ title: 'Unsaved project A title' }),
      })
    );
  });

  it('refetches only for matching project update events and cleans up', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return unsubscribe;
    });
    const { view } = renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    await act(async () => onUpdate?.({ projectId: 'other-project' }));
    expect(bridge.getProject.invoke).toHaveBeenCalledTimes(1);
    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    expect(bridge.getProject.invoke).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the current project visible while a matching event refetches in the background', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    const pending = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(pending.promise);
    act(() => onUpdate?.({ projectId: 'project-1' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Launch film' })).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.project.loading')).not.toBeInTheDocument();

    pending.resolve(ok(project('project-1', { name: 'Updated film', revision: 3 })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Updated film' })).toBeInTheDocument();
  });

  it('keeps the current project visible when a background refetch returns a typed error', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });
    bridge.getProject.invoke.mockResolvedValueOnce(failure());

    act(() => onUpdate?.({ projectId: 'project-1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.storage');
    expect(screen.getByRole('heading', { level: 1, name: 'Launch film' })).toBeInTheDocument();
  });

  it('ignores an older matching-event response that resolves after a newer canonical fetch', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    const older = deferred<StudioCommandResult<StudioRendererProject | null>>();
    const newer = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    act(() => {
      onUpdate?.({ projectId: 'project-1' });
      onUpdate?.({ projectId: 'project-1' });
    });
    newer.resolve(ok(project('project-1', { name: 'Newest film', revision: 4 })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Newest film' })).toBeInTheDocument();

    older.resolve(ok(project('project-1', { name: 'Older film', revision: 3 })));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Newest film' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { level: 1, name: 'Older film' })).not.toBeInTheDocument();
  });

  it('exposes an explicit background refetch for the storyboard editor', async () => {
    render(<ProjectHookHarness />);
    await screen.findByText('Launch film');
    bridge.getProject.invoke.mockResolvedValueOnce(ok(project('project-1', { name: 'Refetched film', revision: 3 })));

    fireEvent.click(screen.getByRole('button', { name: 'Refetch project' }));

    expect(await screen.findByText('Refetched film')).toBeInTheDocument();
    expect(bridge.getProject.invoke).toHaveBeenCalledTimes(2);
  });
});
