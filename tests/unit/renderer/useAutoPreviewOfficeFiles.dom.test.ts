/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import { useAutoPreviewOfficeFiles } from '@/renderer/hooks/file/useAutoPreviewOfficeFiles';

const mocks = vi.hoisted(() => ({
  fileAddedHandler: undefined as ((event: { file_path: string; workspace: string }) => void) | undefined,
  findPreviewTab: vi.fn(),
  openPreview: vi.fn(),
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listWorkspaceFiles: { invoke: vi.fn() },
    },
    workspaceOfficeWatch: {
      start: { invoke: vi.fn() },
      stop: { invoke: vi.fn() },
      fileAdded: { on: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/hooks/system/useAutoPreviewOfficeFilesEnabled', () => ({
  useAutoPreviewOfficeFilesEnabled: () => true,
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    findPreviewTab: mocks.findPreviewTab,
    openPreview: mocks.openPreview,
  }),
}));

describe('useAutoPreviewOfficeFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipcBridge.workspaceOfficeWatch.start.invoke).mockResolvedValue(undefined);
    vi.mocked(ipcBridge.workspaceOfficeWatch.stop.invoke).mockResolvedValue(undefined);
    vi.mocked(ipcBridge.workspaceOfficeWatch.fileAdded.on).mockImplementation((handler) => {
      mocks.fileAddedHandler = handler;
      return () => {};
    });
    vi.mocked(ipcBridge.fs.listWorkspaceFiles.invoke).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists workspace files by workspace root', async () => {
    renderHook(() => useAutoPreviewOfficeFiles({ conversation_id: 'conversation-1', workspace: '/Volumes/project' }));

    await waitFor(() => {
      expect(ipcBridge.fs.listWorkspaceFiles.invoke).toHaveBeenCalledWith({
        root: '/Volumes/project',
      });
    });
  });

  it('ignores Forge Office transaction files', async () => {
    vi.useFakeTimers();
    renderHook(() => useAutoPreviewOfficeFiles({ conversation_id: 'conversation-1', workspace: '/Volumes/project' }));
    await act(async () => Promise.resolve());

    act(() => {
      mocks.fileAddedHandler?.({
        file_path: '/Volumes/project/.report.01234567-89ab-4cde-8123-456789abcdef.forge-edit.docx',
        workspace: '/Volumes/project',
      });
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.openPreview).not.toHaveBeenCalled();
  });

  it('does not auto-open baseline events received while the initial file list is loading', async () => {
    vi.useFakeTimers();
    const files = deferred<Array<{ fullPath: string }>>();
    vi.mocked(ipcBridge.fs.listWorkspaceFiles.invoke).mockReturnValue(files.promise);
    renderHook(() => useAutoPreviewOfficeFiles({ conversation_id: 'conversation-1', workspace: '/Volumes/project' }));
    await act(async () => Promise.resolve());

    act(() => {
      mocks.fileAddedHandler?.({ file_path: '/Volumes/project/existing.docx', workspace: '/Volumes/project' });
      files.resolve([{ fullPath: '/Volumes/project/existing.docx' }]);
    });
    await act(async () => Promise.resolve());
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.openPreview).not.toHaveBeenCalled();
  });
});
