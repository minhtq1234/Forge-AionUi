/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioProjectSummary,
  StudioRendererProject,
  StudioRouteCatalog,
} from '@/common/types/project/creativeStudioTypes';
import { StudioLibrary } from '@renderer/pages/studio/components';

const bridge = vi.hoisted(() => ({
  listProjects: { invoke: vi.fn() },
  createProject: { invoke: vi.fn() },
  getProject: { invoke: vi.fn() },
  deleteProject: { invoke: vi.fn() },
  listRoutes: { invoke: vi.fn() },
  projectUpdated: { on: vi.fn() },
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key === 'conversation.creativeStudio.library.deleteConfirmBody' ? `${key}:${params?.name}` : key,
  }),
}));

const ok = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });
const failure = <T,>(code: 'busy' | 'storage_error'): StudioCommandResult<T> => ({
  ok: false,
  error: { code, messageKey: `conversation.creativeStudio.errors.${code === 'storage_error' ? 'storage' : code}` },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const summary = (overrides: Partial<StudioProjectSummary> = {}): StudioProjectSummary => ({
  id: 'project-1',
  name: 'Launch film',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '720p',
  sceneCount: 0,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 4,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch video',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '720p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const routes = (health: StudioRouteCatalog['planning']['health'] = 'ready'): StudioRouteCatalog => ({
  planning: { health },
  automatic: [],
  providerModels: [],
  suggestions: {
    image: { reason: 'no_compatible_route', route: null },
    video: { reason: 'no_compatible_route', route: null },
  },
  catalogVersion: 'catalog-1',
});

describe('StudioLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.listProjects.invoke.mockResolvedValue(ok([]));
    bridge.createProject.invoke.mockResolvedValue(ok(project()));
    bridge.getProject.invoke.mockResolvedValue(ok(project()));
    bridge.deleteProject.invoke.mockResolvedValue(ok(true));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    bridge.projectUpdated.on.mockReturnValue(() => {});
  });

  it('shows a loading state before bridge projects resolve', () => {
    bridge.listProjects.invoke.mockReturnValue(new Promise(() => {}));

    render(<StudioLibrary />);

    expect(screen.getByText('conversation.creativeStudio.library.loading')).toBeInTheDocument();
  });

  it('shows an empty state after an empty canonical list', async () => {
    render(<StudioLibrary />);

    expect(await screen.findByText('conversation.creativeStudio.empty.title')).toBeInTheDocument();
  });

  it('renders the canonical project summaries returned by the bridge', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary()]));

    render(<StudioLibrary />);

    expect(await screen.findByText('Launch film')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.library.sceneCount')).toBeInTheDocument();
  });

  it('creates with the canonical returned id and the explicit 720p default', async () => {
    bridge.createProject.invoke.mockResolvedValue(ok(project({ id: 'canonical-project' })));
    render(<StudioLibrary />);

    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.newProject' }));
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.create.nameLabel'), {
      target: { value: 'Canonical launch' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.create.briefLabel'), {
      target: { value: 'A brief for a launch video.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.create.submit' }));

    await waitFor(() =>
      expect(bridge.createProject.invoke).toHaveBeenCalledWith({
        name: 'Canonical launch',
        brief: 'A brief for a launch video.',
        aspectRatio: '16:9',
        targetDurationSeconds: 15,
        resolution: '720p',
      })
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/studio/canonical-project'));
  });

  it('gives the aspect-ratio combobox an explicit accessible name', async () => {
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.newProject' }));

    expect(
      screen.getByRole('combobox', { name: 'conversation.creativeStudio.create.aspectRatioLabel' })
    ).toBeInTheDocument();
  });

  it('keeps invalid duration from reaching the bridge', async () => {
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.newProject' }));
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.create.targetDurationLabel'), {
      target: { value: '61' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.create.submit' }));

    expect(await screen.findByText('conversation.creativeStudio.create.invalidDuration')).toBeInTheDocument();
    expect(bridge.createProject.invoke).not.toHaveBeenCalled();
  });

  it('shows a typed bridge failure without navigating after creation fails', async () => {
    bridge.createProject.invoke.mockResolvedValue(failure<StudioRendererProject>('storage_error'));
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.newProject' }));
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.create.nameLabel'), {
      target: { value: 'Failed project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.create.submit' }));

    expect(
      await within(screen.getByRole('dialog')).findByText('conversation.creativeStudio.errors.storage')
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('fetches the canonical revision before deleting a project', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary()]));
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteProject' }));
    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenCalledWith({ projectId: 'project-1' }));
    expect(
      await screen.findByText('conversation.creativeStudio.library.deleteConfirmBody:Launch film')
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteConfirm' }));

    expect(bridge.deleteProject.invoke).toHaveBeenCalledWith({ projectId: 'project-1', expectedRevision: 4 });
  });

  it('refuses a local deletion when canonical work is active', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary()]));
    bridge.getProject.invoke.mockResolvedValue(
      ok(project({ jobs: { job: { status: 'running' } } } as Partial<StudioRendererProject>))
    );
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteProject' }));

    expect(await screen.findByText('conversation.creativeStudio.library.deleteActiveWork')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.library.deleteConfirm' })
    ).not.toBeInTheDocument();
    expect(bridge.deleteProject.invoke).not.toHaveBeenCalled();
  });

  it('renders a busy result when work starts during deletion', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary()]));
    bridge.deleteProject.invoke.mockResolvedValue(failure<boolean>('busy'));
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteProject' }));
    await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteConfirm' });
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteConfirm' }));

    expect(
      await within(screen.getByRole('dialog')).findByText('conversation.creativeStudio.errors.busy')
    ).toBeInTheDocument();
  });

  it('keeps the latest project list when an older refresh resolves last', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const older = deferred<StudioCommandResult<StudioProjectSummary[]>>();
    const newer = deferred<StudioCommandResult<StudioProjectSummary[]>>();
    bridge.listProjects.invoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render(<StudioLibrary />);

    act(() => onUpdate?.({ projectId: 'project-2' }));
    newer.resolve(ok([summary({ id: 'project-2', name: 'Newest project' })]));
    expect(await screen.findByText('Newest project')).toBeInTheDocument();

    older.resolve(ok([summary({ name: 'Older project' })]));
    await waitFor(() => expect(screen.getByText('Newest project')).toBeInTheDocument());
    expect(screen.queryByText('Older project')).not.toBeInTheDocument();
  });

  it('keeps a modal command error when a background project refresh succeeds', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    bridge.createProject.invoke.mockResolvedValue(failure<StudioRendererProject>('storage_error'));
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.newProject' }));
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.create.nameLabel'), {
      target: { value: 'Failed project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.create.submit' }));
    expect(
      await within(screen.getByRole('dialog')).findByText('conversation.creativeStudio.errors.storage')
    ).toBeInTheDocument();

    await act(async () => onUpdate?.({ projectId: 'project-1' }));

    expect(
      within(screen.getByRole('dialog')).getByText('conversation.creativeStudio.errors.storage')
    ).toBeInTheDocument();
  });

  it('uses only the latest overlapping canonical delete lookup and disables incompatible triggers', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary(), summary({ id: 'project-2', name: 'Second film' })]));
    const first = deferred<StudioCommandResult<StudioRendererProject | null>>();
    const second = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<StudioLibrary />);
    const deleteButtons = await screen.findAllByRole('button', {
      name: 'conversation.creativeStudio.library.deleteProject',
    });

    act(() => {
      deleteButtons[0].click();
      deleteButtons[1].click();
    });
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.library.newProject' })).toBeDisabled();
    expect(deleteButtons[0]).toBeDisabled();
    expect(deleteButtons[1]).toBeDisabled();

    second.resolve(ok(project({ id: 'project-2', name: 'Second film' })));
    expect(
      await screen.findByText('conversation.creativeStudio.library.deleteConfirmBody:Second film')
    ).toBeInTheDocument();

    first.resolve(ok(project()));
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.library.deleteConfirmBody:Second film')).toBeInTheDocument()
    );
    expect(
      screen.queryByText('conversation.creativeStudio.library.deleteConfirmBody:Launch film')
    ).not.toBeInTheDocument();
  });

  it('refreshes the library for a project update and cleans up its subscription', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return unsubscribe;
    });
    const view = render(<StudioLibrary />);
    await screen.findByText('conversation.creativeStudio.empty.title');

    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    expect(bridge.listProjects.invoke).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
