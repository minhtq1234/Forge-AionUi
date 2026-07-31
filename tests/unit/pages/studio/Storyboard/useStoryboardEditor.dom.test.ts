/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioEditableScene,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { useStoryboardEditor } from '@renderer/pages/studio/hooks/useStoryboardEditor';

const bridge = vi.hoisted(() => ({
  listRoutes: { invoke: vi.fn() },
  updateScene: { invoke: vi.fn() },
  reorderScenes: { invoke: vi.fn() },
  proposeStoryboard: { invoke: vi.fn() },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'conversation.creativeStudio.scene.defaultTitle' ? 'Untitled scene' : key),
  }),
}));

const ok = <T>(data: T): StudioCommandResult<T> => ({ ok: true, data });

const failed = <T>(
  code: 'stale_project' | 'provider_error' | 'planning_unavailable' | 'storyboard_exists' | 'storage_error',
  messageKey = `conversation.creativeStudio.errors.${code}`
): StudioCommandResult<T> => ({
  ok: false,
  error: { code, messageKey },
});

const scene = (id: string, overrides: Partial<StudioScene> = {}): StudioScene => ({
  id,
  title: `Scene ${id}`,
  purpose: 'Move the story forward',
  visualPrompt: 'A cinematic wide shot',
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

const project = (
  revision = 2,
  orderedScenes: StudioScene[] = [scene('scene-1'), scene('scene-2')],
  overrides: Partial<StudioRendererProject> = {}
): StudioRendererProject => ({
  schemaVersion: 1,
  revision,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch video',
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '720p',
  sceneOrder: orderedScenes.map(({ id }) => id),
  scenes: Object.fromEntries(orderedScenes.map((item) => [item.id, item])),
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const routes = (
  planning: StudioRouteCatalog['planning'] = {
    health: 'ready',
    resolvedModel: { providerId: 'provider-1', model: 'operations-model' },
  }
): StudioRouteCatalog => ({
  storyboard: {
    status: planning.health === 'ready' ? 'ready' : 'setup_required',
    selected: planning.resolvedModel ?? null,
    options: planning.resolvedModel
      ? [
          {
            ...planning.resolvedModel,
            providerName: 'Provider',
            health: 'available',
          },
        ]
      : [],
  },
  image: { status: 'setup_required', selected: null, options: [] },
  video: { status: 'setup_required', selected: null, options: [] },
  planning,
  automatic: [],
  suggestions: {
    image: { reason: 'no_compatible_route', route: null },
    video: { reason: 'no_compatible_route', route: null },
  },
  catalogVersion: 'catalog-1',
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('useStoryboardEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    bridge.updateScene.invoke.mockImplementation(async () => ok(project(3)));
    bridge.reorderScenes.invoke.mockImplementation(async () => ok(project(3)));
    bridge.proposeStoryboard.invoke.mockImplementation(async () => ok(project(3)));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates the ordered scenes, selection, draft, and duration summary', async () => {
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-1', 'scene-2']);
    expect(result.current.selectedSceneId).toBe('scene-1');
    expect(result.current.sceneDraft?.title).toBe('Scene scene-1');
    expect(result.current.durationTotalSeconds).toBe(10);
    expect(result.current.durationMatchesTarget).toBe(true);
    expect(result.current.hasUnsavedSelectedSceneDraft).toBe(false);
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));
  });

  it('distinguishes the selected scene draft from unrelated dirty scene drafts', async () => {
    vi.useFakeTimers();
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Dirty opening' }));
    expect(result.current.hasUnsavedSelectedSceneDraft).toBe(true);

    act(() => result.current.selectScene('scene-2'));
    expect(result.current.hasUnsavedSelectedSceneDraft).toBe(false);
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);
  });

  it('does not call IPC when no project or selected scene exists', async () => {
    const { result } = renderHook(() => useStoryboardEditor({ project: null, refetch: vi.fn(async () => null) }));

    act(() => result.current.updateSceneDraft({ title: 'Ignored' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
      expect(await result.current.addScene()).toBe(false);
      expect(await result.current.removeScene('missing')).toBe(false);
      expect(await result.current.reorderScenes([])).toBe(false);
      expect(await result.current.proposeStoryboard(false)).toBe(false);
    });

    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(bridge.reorderScenes.invoke).not.toHaveBeenCalled();
    expect(bridge.proposeStoryboard.invoke).not.toHaveBeenCalled();
    expect(bridge.listRoutes.invoke).not.toHaveBeenCalled();
  });

  it('debounces a strict editable-scene command and adopts its canonical response', async () => {
    vi.useFakeTimers();
    const current = project();
    const saved = scene('scene-1', { title: 'A new opening' });
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(project(3, [saved, scene('scene-2')])));
    const { result } = renderHook(() => useStoryboardEditor({ project: current, refetch: vi.fn(async () => current) }));

    act(() => result.current.updateSceneDraft({ title: 'A new opening' }));
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      expectedRevision: 2,
      scene: {
        title: 'A new opening',
        purpose: 'Move the story forward',
        visualPrompt: 'A cinematic wide shot',
        narration: '',
        onScreenText: '',
        mediaKind: 'image',
        durationSeconds: 5,
        referenceAssetId: null,
      } satisfies StudioEditableScene,
    });
    expect(result.current.project?.revision).toBe(3);
    expect(result.current.sceneDraft?.title).toBe('A new opening');
  });

  it('flushes the old scene on selection change and the selected scene on unmount', async () => {
    const initial = project();
    const { result, unmount } = renderHook(() =>
      useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) })
    );

    act(() => {
      result.current.updateSceneDraft({ purpose: 'Changed before switch' });
      result.current.selectScene('scene-2');
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    expect(bridge.updateScene.invoke.mock.calls[0]?.[0]).toMatchObject({
      sceneId: 'scene-1',
      scene: { purpose: 'Changed before switch' },
    });

    act(() => result.current.updateSceneDraft({ narration: 'Changed before close' }));
    unmount();
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2));
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-2',
      scene: { narration: 'Changed before close' },
    });
  });

  it('serializes saves and reads the latest canonical revision when each command executes', async () => {
    const first = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ok(project(4, [scene('scene-1'), scene('scene-2', { title: 'Second edit' })])));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First edit' }));
    let firstFlush!: Promise<boolean>;
    act(() => {
      firstFlush = result.current.flushSceneDraft();
    });
    await act(async () => Promise.resolve());
    act(() => {
      result.current.selectScene('scene-2');
      result.current.updateSceneDraft({ title: 'Second edit' });
    });
    let secondFlush!: Promise<boolean>;
    act(() => {
      secondFlush = result.current.flushSceneDraft();
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve(ok(project(3, [scene('scene-1', { title: 'First edit' }), scene('scene-2')])));
      await firstFlush;
      await secondFlush;
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-2',
      expectedRevision: 3,
    });
    expect(result.current.project?.revision).toBe(4);
  });

  it('rebases a queued local field patch onto newer canonical scene fields', async () => {
    const blocker = deferred<StudioCommandResult<StudioRendererProject>>();
    const canonical = project(3, [scene('scene-1', { narration: 'Remote narration' }), scene('scene-2')]);
    const saved = project(4, [
      scene('scene-1', { title: 'Local title', narration: 'Remote narration' }),
      scene('scene-2'),
    ]);
    bridge.reorderScenes.invoke.mockReturnValueOnce(blocker.promise);
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(saved));
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: project() } }
    );

    let blockingMove!: Promise<boolean>;
    act(() => {
      blockingMove = result.current.moveScene('scene-1', 'down');
    });
    await waitFor(() => expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.updateSceneDraft({ title: 'Local title' }));
    let save!: Promise<boolean>;
    act(() => {
      save = result.current.flushSceneDraft();
    });
    rerender({ value: canonical });

    await act(async () => {
      blocker.resolve(failed('provider_error', 'conversation.creativeStudio.errors.provider'));
      expect(await blockingMove).toBe(false);
      expect(await save).toBe(true);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      expectedRevision: 3,
      scene: expect.objectContaining({
        title: 'Local title',
        narration: 'Remote narration',
      }),
    });
  });

  it('pauses a later scene save behind a stale conflict and resumes it after discard', async () => {
    const first = deferred<StudioCommandResult<StudioRendererProject>>();
    const refreshed = project(8, [
      scene('scene-1', { title: 'Remote opening' }),
      scene('scene-2', { narration: 'Remote narration' }),
    ]);
    const saved = project(9, [
      scene('scene-1', { title: 'Remote opening' }),
      scene('scene-2', { title: 'Local second scene', narration: 'Remote narration' }),
    ]);
    bridge.updateScene.invoke.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok(saved));
    const refetch = vi.fn(async () => refreshed);
    const { result } = renderHook(() => useStoryboardEditor({ project: project(), refetch }));

    act(() => result.current.updateSceneDraft({ title: 'Local opening' }));
    let firstSave!: Promise<boolean>;
    act(() => {
      firstSave = result.current.flushSceneDraft();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.selectScene('scene-2');
      result.current.updateSceneDraft({ title: 'Local second scene' });
    });
    let secondSave!: Promise<boolean>;
    act(() => {
      secondSave = result.current.flushSceneDraft();
    });

    await act(async () => {
      first.resolve(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'));
      expect(await firstSave).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);

    act(() => result.current.discardConflict());
    await act(async () => {
      expect(await secondSave).toBe(true);
    });

    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-2',
      expectedRevision: 8,
      scene: expect.objectContaining({
        title: 'Local second scene',
        narration: 'Remote narration',
      }),
    });
    expect(result.current.conflict).toBeNull();
  });

  it('requires explicit retry before restoring a locally edited scene removed by canonical state', async () => {
    vi.useFakeTimers();
    const removed = project(8, [scene('scene-2')]);
    const restored = project(9, [scene('scene-2'), scene('scene-1', { title: 'Restore me' })]);
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(restored));
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: project() } }
    );

    act(() => result.current.updateSceneDraft({ title: 'Restore me' }));
    rerender({ value: removed });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(result.current.project?.sceneOrder).toEqual(['scene-2']);
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(true);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      expectedRevision: 8,
      scene: expect.objectContaining({ title: 'Restore me' }),
    });
    expect(result.current.project?.sceneOrder).toEqual(['scene-2', 'scene-1']);
  });

  it('drops in-flight results and queued intents after switching to another project', async () => {
    const first = deferred<StudioCommandResult<StudioRendererProject>>();
    const second = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const projectA = project();
    const projectB = project(8, [scene('scene-1'), scene('scene-2')], {
      id: 'project-2',
      name: 'Second project',
    });
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: projectA } }
    );

    act(() => result.current.updateSceneDraft({ title: 'Project A edit' }));
    let save!: Promise<boolean>;
    let queuedAdd!: Promise<boolean>;
    act(() => {
      save = result.current.flushSceneDraft();
      queuedAdd = result.current.addScene();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    rerender({ value: projectB });
    expect(result.current.project?.id).toBe('project-2');

    let projectBAdd!: Promise<boolean>;
    act(() => {
      projectBAdd = result.current.addScene();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2));
    const projectBRequest = bridge.updateScene.invoke.mock.calls[1]?.[0];
    expect(projectBRequest).toMatchObject({ projectId: 'project-2', expectedRevision: 8 });

    await act(async () => {
      second.resolve(
        ok(
          project(
            9,
            [scene('scene-1'), scene('scene-2'), scene(projectBRequest.sceneId, { title: 'Untitled scene' })],
            {
              id: 'project-2',
              name: 'Second project',
            }
          )
        )
      );
      expect(await projectBAdd).toBe(true);
      first.resolve(ok(project(3, [scene('scene-1', { title: 'Project A edit' }), scene('scene-2')])));
      expect(await save).toBe(false);
      expect(await queuedAdd).toBe(false);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(result.current.project?.id).toBe('project-2');
    expect(result.current.project?.revision).toBe(9);
  });

  it('keeps a draft after a typed save failure', async () => {
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('provider_error', 'conversation.creativeStudio.errors.provider')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ visualPrompt: 'Preserve this prompt' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });

    expect(result.current.sceneDraft?.visualPrompt).toBe('Preserve this prompt');
    expect(result.current.error).toMatchObject({
      operation: 'save_scene',
      code: 'provider_error',
      sceneId: 'scene-1',
    });
  });

  it('can explicitly discard the affected local scene draft after a typed save failure', async () => {
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('storage_error', 'conversation.creativeStudio.errors.storage')
    );
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Unsaved local title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);

    act(() => result.current.discardSceneDraftById('scene-1'));

    expect(result.current.hasUnsavedSceneDrafts).toBe(false);
    expect(result.current.sceneDraft?.title).toBe('Scene scene-1');
    expect(result.current.error).toBeNull();
  });

  it('discards only the failed scene while preserving an unrelated dirty scene', async () => {
    vi.useFakeTimers();
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Failed scene A edit' }));
    let saveA!: Promise<boolean>;
    act(() => {
      saveA = result.current.flushSceneDraft();
    });
    await vi.waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.selectScene('scene-2'));
    act(() => result.current.updateSceneDraft({ title: 'Keep scene B edit' }));

    await act(async () => {
      firstSave.resolve(failed('storage_error', 'conversation.creativeStudio.errors.storage'));
      expect(await saveA).toBe(false);
    });
    expect(result.current.saveIssues.map((issue) => issue.sceneId)).toEqual(['scene-1']);

    act(() => result.current.discardSceneDraftById('scene-1'));

    expect(result.current.saveIssues).toEqual([]);
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);
    expect(result.current.orderedScenes.find(({ id }) => id === 'scene-1')?.title).toBe('Scene scene-1');
    expect(result.current.orderedScenes.find(({ id }) => id === 'scene-2')?.title).toBe('Keep scene B edit');
  });

  it('surfaces the remaining scene issue after two scene saves fail independently', async () => {
    vi.useFakeTimers();
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(failed('provider_error', 'conversation.creativeStudio.errors.provider'));
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Failed scene A edit' }));
    let saveA!: Promise<boolean>;
    act(() => {
      saveA = result.current.flushSceneDraft();
    });
    await vi.waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.selectScene('scene-2'));
    act(() => result.current.updateSceneDraft({ title: 'Failed scene B edit' }));
    let saveB!: Promise<boolean>;
    act(() => {
      saveB = result.current.flushSceneDraft();
    });

    await act(async () => {
      firstSave.resolve(failed('storage_error', 'conversation.creativeStudio.errors.storage'));
      expect(await saveA).toBe(false);
      expect(await saveB).toBe(false);
    });
    expect(result.current.saveIssues.map((issue) => issue.sceneId)).toEqual(['scene-1', 'scene-2']);
    expect(result.current.error?.sceneId).toBe('scene-2');

    act(() => result.current.discardSceneDraftById('scene-2'));

    expect(result.current.saveIssues.map((issue) => issue.sceneId)).toEqual(['scene-1']);
    expect(result.current.error?.sceneId).toBe('scene-1');
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);
  });

  it.each([0, 61, 1.5])('rejects invalid scene duration %s without sending IPC', async (durationSeconds) => {
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ durationSeconds }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });

    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(result.current.error).toMatchObject({
      operation: 'save_scene',
      code: 'invalid_payload',
      messageKey: 'conversation.creativeStudio.inspector.invalidDuration',
    });
  });

  it('reflects a local duration draft in the storyboard total before debounce persistence', async () => {
    const { result, unmount } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );
    await waitFor(() => expect(result.current.planningLoading).toBe(false));

    act(() => result.current.updateSceneDraft({ durationSeconds: 6 }));

    expect(result.current.durationTotalSeconds).toBe(11);
    expect(result.current.durationMatchesTarget).toBe(false);
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    act(() => unmount());
  });

  it('refetches on stale save while preserving the draft until explicit retry', async () => {
    const refreshed = project(8, [
      scene('scene-1', { title: 'Canonical title', narration: 'Remote narration' }),
      scene('scene-2'),
    ]);
    const retried = project(9, [
      scene('scene-1', { title: 'My title', narration: 'Remote narration' }),
      scene('scene-2'),
    ]);
    const refetch = vi.fn(async () => refreshed);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(ok(retried));
    const { result } = renderHook(() => useStoryboardEditor({ project: project(), refetch }));

    act(() => result.current.updateSceneDraft({ title: 'My title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });

    expect(refetch).toHaveBeenCalledOnce();
    expect(result.current.project?.revision).toBe(8);
    expect(result.current.sceneDraft?.title).toBe('My title');
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(true);
    });

    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      expectedRevision: 8,
      scene: { title: 'My title', narration: 'Remote narration' },
    });
    expect(result.current.project?.revision).toBe(9);
    expect(result.current.conflict).toBeNull();
  });

  it('replaces a stale save conflict with the typed retry failure and resumes parked scene saves', async () => {
    const refreshed = project(8, [
      scene('scene-1', { title: 'Canonical title' }),
      scene('scene-2', { title: 'Canonical second title' }),
    ]);
    const secondSceneSaved = project(9, [
      scene('scene-1', { title: 'Canonical title' }),
      scene('scene-2', { title: 'My second title' }),
    ]);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(failed('provider_error', 'conversation.creativeStudio.errors.provider'))
      .mockResolvedValueOnce(ok(secondSceneSaved));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'My first title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    act(() => result.current.selectScene('scene-2'));
    act(() => result.current.updateSceneDraft({ title: 'My second title' }));
    let parkedSave!: Promise<boolean>;
    act(() => {
      parkedSave = result.current.flushSceneDraft();
    });
    await act(async () => Promise.resolve());

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(false);
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(3));
    await act(async () => {
      expect(await parkedSave).toBe(true);
    });

    expect(result.current.conflict).toBeNull();
    expect(result.current.saveIssues).toEqual([
      expect.objectContaining({
        operation: 'save_scene',
        code: 'provider_error',
        sceneId: 'scene-1',
      }),
    ]);
    expect(result.current.project?.revision).toBe(9);
  });

  it('retries the latest same-scene edit made while a stale save conflict is visible', async () => {
    const refreshed = project(8, [scene('scene-1', { title: 'Canonical title' }), scene('scene-2')]);
    const retried = project(9, [scene('scene-1', { title: 'Newest local title' }), scene('scene-2')]);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(ok(retried));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First local title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    act(() => result.current.updateSceneDraft({ title: 'Newest local title' }));
    let supersededSave!: Promise<boolean>;
    act(() => {
      supersededSave = result.current.flushSceneDraft();
    });
    await act(async () => Promise.resolve());

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(true);
      expect(await supersededSave).toBe(false);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      expectedRevision: 8,
      scene: { title: 'Newest local title' },
    });
    expect(result.current.project?.revision).toBe(9);
    expect(result.current.conflict).toBeNull();
  });

  it('replaces a stale reorder conflict with the typed retry failure and resumes parked mutations', async () => {
    const refreshed = project(8);
    const removed = project(9, [scene('scene-1')]);
    bridge.reorderScenes.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(failed('storage_error', 'conversation.creativeStudio.errors.storage'));
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(removed));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    await act(async () => {
      expect(await result.current.reorderScenes(['scene-2', 'scene-1'])).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'reorder_scenes' });

    let parkedRemoval!: Promise<boolean>;
    act(() => {
      parkedRemoval = result.current.removeScene('scene-2');
    });
    await act(async () => Promise.resolve());

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(false);
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledOnce());
    await act(async () => {
      expect(await parkedRemoval).toBe(true);
    });

    expect(result.current.conflict).toBeNull();
    expect(result.current.error).toMatchObject({
      operation: 'reorder_scenes',
      code: 'storage_error',
    });
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-1']);
  });

  it('discards a newer same-scene edit without resuming it behind the stale save conflict', async () => {
    const refreshed = project(8, [scene('scene-1', { title: 'Canonical title' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First local title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    act(() => result.current.updateSceneDraft({ title: 'Discard this newer title' }));
    let supersededSave!: Promise<boolean>;
    act(() => {
      supersededSave = result.current.flushSceneDraft();
    });
    await act(async () => Promise.resolve());

    act(() => result.current.discardConflict());
    await act(async () => {
      expect(await supersededSave).toBe(false);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.sceneDraft?.title).toBe('Canonical title');
    expect(result.current.project?.revision).toBe(8);
    expect(result.current.conflict).toBeNull();
  });

  it('discards a conflicted scene draft back to the refetched canonical scene', async () => {
    const refreshed = project(8, [scene('scene-1', { title: 'Canonical title' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Discard me' }));
    await act(async () => {
      await result.current.flushSceneDraft();
    });
    act(() => result.current.discardConflict());

    expect(result.current.conflict).toBeNull();
    expect(result.current.sceneDraft?.title).toBe('Canonical title');
  });

  it('adds a valid UUID scene and refuses a twenty-fifth scene', async () => {
    const initial = project(2, []);
    bridge.updateScene.invoke.mockImplementationOnce(async ({ sceneId, scene: editable }) =>
      ok(
        project(3, [
          { id: sceneId, ...editable, selectedAssetId: null, assetIds: [], jobIds: [], reviewState: 'draft' },
        ])
      )
    );
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: initial } }
    );

    await act(async () => {
      expect(await result.current.addScene()).toBe(true);
    });

    const request = bridge.updateScene.invoke.mock.calls[0]?.[0];
    expect(request.sceneId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(request.scene).toMatchObject({
      title: 'Untitled scene',
      mediaKind: 'image',
      referenceAssetId: null,
    });
    expect(result.current.selectedSceneId).toBe(request.sceneId);

    const fullScenes = Array.from({ length: 24 }, (_, index) => scene(`scene-${index + 1}`));
    rerender({ value: project(4, fullScenes) });
    expect(result.current.canAddScene).toBe(false);
    await act(async () => {
      expect(await result.current.addScene()).toBe(false);
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
  });

  it('removes with scene null and preserves canonical state after a typed rejection', async () => {
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('storage_error', 'conversation.creativeStudio.errors.storage')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    await act(async () => {
      expect(await result.current.removeScene('scene-1')).toBe(false);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      expectedRevision: 2,
      scene: null,
    });
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-1', 'scene-2']);
  });

  it('clears a prior scene-save issue when that scene is successfully removed', async () => {
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('storage_error', 'conversation.creativeStudio.errors.storage'))
      .mockResolvedValueOnce(ok(project(3, [scene('scene-2')])));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Failed edit before remove' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.saveIssues.map((issue) => issue.sceneId)).toEqual(['scene-1']);

    await act(async () => {
      expect(await result.current.removeScene('scene-1')).toBe(true);
    });

    expect(result.current.saveIssues).toEqual([]);
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-2']);
  });

  it('persists an edited scene after its pending removal receives a typed rejection', async () => {
    vi.useFakeTimers();
    const saved = project(3, [scene('scene-1', { title: 'Keep this edit' }), scene('scene-2')]);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('storage_error', 'conversation.creativeStudio.errors.storage'))
      .mockResolvedValueOnce(ok(saved));
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Keep this edit' }));
    await act(async () => {
      expect(await result.current.removeScene('scene-1')).toBe(false);
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-1',
      expectedRevision: 2,
      scene: { title: 'Keep this edit' },
    });
    expect(result.current.hasUnsavedSceneDrafts).toBe(false);
  });

  it('resumes an edited-scene save after discarding its stale removal conflict', async () => {
    vi.useFakeTimers();
    const refreshed = project(8, [scene('scene-1', { title: 'Remote title' }), scene('scene-2')]);
    const saved = project(9, [scene('scene-1', { title: 'Keep this edit' }), scene('scene-2')]);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(ok(saved));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Keep this edit' }));
    await act(async () => {
      expect(await result.current.removeScene('scene-1')).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'remove_scene', sceneId: 'scene-1' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.discardConflict();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-1',
      expectedRevision: 8,
      scene: { title: 'Keep this edit' },
    });
    expect(result.current.project?.revision).toBe(9);
    expect(result.current.conflict).toBeNull();
  });

  it('reorders an exact permutation and rejects invalid and boundary moves without IPC', async () => {
    const reordered = project(3, [scene('scene-2'), scene('scene-1')]);
    bridge.reorderScenes.invoke.mockResolvedValueOnce(ok(reordered));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    await act(async () => {
      expect(await result.current.moveScene('scene-1', 'down')).toBe(true);
    });
    expect(bridge.reorderScenes.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 2,
      sceneOrder: ['scene-2', 'scene-1'],
    });

    await act(async () => {
      expect(await result.current.moveScene('scene-2', 'up')).toBe(false);
      expect(await result.current.reorderScenes(['scene-2', 'missing'])).toBe(false);
    });
    expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(1);
  });

  it('retries a stale reorder with the refetched revision and preserves the intended order', async () => {
    const refreshed = project(8);
    const reordered = project(9, [scene('scene-2'), scene('scene-1')]);
    bridge.reorderScenes.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(ok(reordered));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    await act(async () => {
      expect(await result.current.reorderScenes(['scene-2', 'scene-1'])).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'reorder_scenes' });

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(true);
    });

    expect(bridge.reorderScenes.invoke.mock.calls[1]?.[0]).toEqual({
      projectId: 'project-1',
      expectedRevision: 8,
      sceneOrder: ['scene-2', 'scene-1'],
    });
  });

  it('ignores older parent revisions after adopting a newer mutation response', async () => {
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(project(7)));
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: project(2) } }
    );

    act(() => result.current.updateSceneDraft({ title: 'Newest' }));
    await act(async () => {
      await result.current.flushSceneDraft();
    });
    rerender({ value: project(4) });

    expect(result.current.project?.revision).toBe(7);
  });

  it('keeps only the latest planning-catalog response', async () => {
    const older = deferred<StudioCommandResult<StudioRouteCatalog>>();
    const newer = deferred<StudioCommandResult<StudioRouteCatalog>>();
    bridge.listRoutes.invoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshPlanning();
    });
    await act(async () => {
      newer.resolve(ok(routes({ health: 'setup_required', reasonCode: 'no_eligible_model' })));
      await refresh;
    });
    await act(async () => {
      older.resolve(ok(routes({ health: 'ready', resolvedModel: { providerId: 'old', model: 'old' } })));
      await Promise.resolve();
    });

    expect(result.current.planning?.health).toBe('setup_required');
  });

  it('surfaces planning readiness and typed route errors without changing scenes', async () => {
    bridge.listRoutes.invoke.mockResolvedValueOnce(
      failed('provider_error', 'conversation.creativeStudio.errors.provider')
    );
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    await waitFor(() =>
      expect(result.current.planningErrorMessageKey).toBe('conversation.creativeStudio.errors.provider')
    );
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-1', 'scene-2']);
  });

  it('blocks planning unless ready and adopts a successful explicit replacement', async () => {
    const drafted = project(3, [scene('draft-1', { title: 'Drafted scene' })]);
    bridge.proposeStoryboard.invoke.mockResolvedValueOnce(ok(drafted));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(true);
    });

    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 2,
      replaceExisting: true,
    });
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['draft-1']);
    expect(result.current.selectedSceneId).toBe('draft-1');
  });

  it('requires a resolved planning model even when readiness reports ready', async () => {
    bridge.listRoutes.invoke.mockResolvedValueOnce(ok(routes({ health: 'ready' })));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(false);
    });

    expect(bridge.proposeStoryboard.invoke).not.toHaveBeenCalled();
  });

  it('does not start or park a planner call behind a non-draft conflict', async () => {
    bridge.reorderScenes.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const refreshed = project(8);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));

    await act(async () => {
      expect(await result.current.reorderScenes(['scene-2', 'scene-1'])).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'reorder_scenes' });

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(false);
    });

    expect(result.current.drafting).toBe(false);
    expect(bridge.proposeStoryboard.invoke).not.toHaveBeenCalled();
  });

  it('settles a planner authorization when an earlier queued mutation becomes stale', async () => {
    const reordering = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.reorderScenes.invoke.mockReturnValueOnce(reordering.promise);
    const refreshed = project(8);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));

    let reorderResult!: Promise<boolean>;
    act(() => {
      reorderResult = result.current.reorderScenes(['scene-2', 'scene-1']);
    });
    await waitFor(() => expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(1));

    let plannerResult!: Promise<boolean>;
    act(() => {
      plannerResult = result.current.proposeStoryboard(true);
    });
    expect(result.current.drafting).toBe(true);
    expect(bridge.proposeStoryboard.invoke).not.toHaveBeenCalled();

    await act(async () => {
      reordering.resolve(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'));
      expect(await reorderResult).toBe(false);
    });

    await waitFor(() => expect(result.current.drafting).toBe(false));
    await act(async () => {
      expect(await plannerResult).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'reorder_scenes' });
    expect(bridge.proposeStoryboard.invoke).not.toHaveBeenCalled();
  });

  it('resumes a scene save when a fresh draft confirmation fails without replacing the storyboard', async () => {
    const firstProposal = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.proposeStoryboard.invoke
      .mockReturnValueOnce(firstProposal.promise)
      .mockResolvedValueOnce(failed('provider_error', 'conversation.creativeStudio.errors.provider'));
    const refreshed = project(8);
    bridge.updateScene.invoke.mockResolvedValueOnce(
      ok(project(9, [scene('scene-1', { title: 'Preserved local edit' }), scene('scene-2')]))
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));

    let firstDraft!: Promise<boolean>;
    act(() => {
      firstDraft = result.current.proposeStoryboard(true);
    });
    await waitFor(() => expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.updateSceneDraft({ title: 'Preserved local edit' }));
    let queuedSave!: Promise<boolean>;
    act(() => {
      queuedSave = result.current.flushSceneDraft();
    });
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();

    await act(async () => {
      firstProposal.resolve(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'));
      expect(await firstDraft).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'draft_storyboard' });
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(false);
    });

    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    await act(async () => {
      expect(await queuedSave).toBe(true);
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        sceneId: 'scene-1',
        expectedRevision: 8,
        scene: expect.objectContaining({ title: 'Preserved local edit' }),
      })
    );
    expect(result.current.planningErrorMessageKey).toBe('conversation.creativeStudio.errors.provider');
    expect(result.current.conflict).toBeNull();
  });

  it('invalidates an old-scene save queued behind a successful storyboard replacement', async () => {
    const proposal = deferred<StudioCommandResult<StudioRendererProject>>();
    const drafted = project(3, [scene('draft-1', { title: 'Drafted scene' })]);
    bridge.proposeStoryboard.invoke.mockReturnValueOnce(proposal.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));

    let drafting!: Promise<boolean>;
    act(() => {
      drafting = result.current.proposeStoryboard(true);
    });
    await waitFor(() => expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.updateSceneDraft({ title: 'Old local edit' }));
    let queuedSave!: Promise<boolean>;
    act(() => {
      queuedSave = result.current.flushSceneDraft();
    });
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();

    await act(async () => {
      proposal.resolve(ok(drafted));
      expect(await drafting).toBe(true);
      expect(await queuedSave).toBe(true);
    });

    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['draft-1']);
    expect(result.current.conflict).toBeNull();
  });

  it('allows only one same-tick planning authorization', async () => {
    const proposal = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.proposeStoryboard.invoke.mockReturnValueOnce(proposal.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));

    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = result.current.proposeStoryboard(true);
      duplicate = result.current.proposeStoryboard(true);
    });
    await act(async () => Promise.resolve());
    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      proposal.resolve(ok(project(3)));
      expect(await first).toBe(true);
      expect(await duplicate).toBe(false);
    });
    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh explicit planner confirmation after a charged stale result', async () => {
    const retry = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.proposeStoryboard.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockReturnValueOnce(retry.promise);
    const refreshed = project(8);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'draft_storyboard' });

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'draft_storyboard' });
    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(1);

    let confirmedRetry!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      confirmedRetry = result.current.proposeStoryboard(true);
      duplicate = result.current.proposeStoryboard(true);
    });
    await waitFor(() => expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(2));

    await act(async () => {
      retry.resolve(ok(project(9)));
      expect(await confirmedRetry).toBe(true);
      expect(await duplicate).toBe(false);
    });
    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(2);
  });

  it('preserves the current storyboard for typed planner failures', async () => {
    bridge.proposeStoryboard.invoke.mockResolvedValueOnce(
      failed('storyboard_exists', 'conversation.creativeStudio.errors.storyboardExists')
    );
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));
    await waitFor(() => expect(result.current.planning?.health).toBe('ready'));

    await act(async () => {
      expect(await result.current.proposeStoryboard(false)).toBe(false);
    });

    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-1', 'scene-2']);
    expect(result.current.error).toMatchObject({
      operation: 'draft_storyboard',
      code: 'storyboard_exists',
    });
    expect(result.current.planningErrorMessageKey).toBe('conversation.creativeStudio.errors.storyboardExists');
  });
});
