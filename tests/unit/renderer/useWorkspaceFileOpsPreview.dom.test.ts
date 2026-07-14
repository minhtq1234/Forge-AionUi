/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import { useWorkspaceFileOps } from '@/renderer/pages/conversation/Workspace/hooks/useWorkspaceFileOps';

const readFile = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      readFile: { invoke: (...args: unknown[]) => readFile(...args) },
      getImageBase64: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/file/workspaceFs', () => ({
  removeWorkspaceEntry: vi.fn(),
  renameWorkspaceEntry: vi.fn(),
}));

vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromPath: vi.fn(),
}));

const buildOptions = (openPreview: (...args: unknown[]) => void) => ({
  workspace: '/workspace',
  eventPrefix: 'acp' as const,
  messageApi: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  t: (key: string) => key,
  setSelected: vi.fn(),
  selectedKeysRef: { current: [] },
  selectedNodeRef: { current: null },
  ensureNodeSelected: vi.fn(),
  refreshWorkspace: vi.fn(),
  renameModal: { visible: false, value: '', target: null },
  deleteModal: { visible: false, target: null, loading: false },
  renameLoading: false,
  setRenameLoading: vi.fn(),
  closeRenameModal: vi.fn(),
  closeDeleteModal: vi.fn(),
  closeContextMenu: vi.fn(),
  setRenameModal: vi.fn(),
  setDeleteModal: vi.fn(),
  openPreview,
});

describe('useWorkspaceFileOps handlePreviewFile pin intent', () => {
  const node: IDirOrFile = {
    name: 'notes.md',
    fullPath: '/workspace/notes.md',
    relativePath: 'notes.md',
    isDir: false,
    isFile: true,
  };

  beforeEach(() => {
    readFile.mockReset();
    readFile.mockResolvedValue('# hello');
  });

  it('opens with the provisional preview option by default', async () => {
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(buildOptions(openPreview)));

    await act(async () => {
      await result.current.handlePreviewFile(node);
    });

    expect(openPreview).toHaveBeenCalledWith(
      '# hello',
      'markdown',
      expect.objectContaining({ file_path: '/workspace/notes.md' }),
      { preview: true }
    );
  });

  it('opens with a pinned intent (no options) when called with pinned=true', async () => {
    const openPreview = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileOps(buildOptions(openPreview)));

    await act(async () => {
      await result.current.handlePreviewFile(node, true);
    });

    expect(openPreview).toHaveBeenCalledWith(
      '# hello',
      'markdown',
      expect.objectContaining({ file_path: '/workspace/notes.md' })
    );
    expect(openPreview).toHaveBeenCalledTimes(1);
    // Called with exactly 3 arguments — no trailing options object.
    expect(openPreview.mock.calls[0]).toHaveLength(3);
  });
});
