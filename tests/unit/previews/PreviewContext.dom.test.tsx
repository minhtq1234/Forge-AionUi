/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { ipcBridge } from '@/common';
import { PreviewProvider, usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { WORKSPACE_EXPAND_EVENT } from '@/renderer/utils/workspace/workspaceEvents';

vi.mock('@/common', () => ({
  ipcBridge: {
    fileStream: {
      contentUpdate: { on: vi.fn(() => vi.fn()) },
    },
    preview: {
      open: { on: vi.fn(() => vi.fn()) },
    },
    fs: {
      writeFile: { invoke: vi.fn() },
      getFileMetadata: { invoke: vi.fn() },
      readFile: { invoke: vi.fn() },
      getImageBase64: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}));

describe('PreviewContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <PreviewProvider>{children}</PreviewProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('initializes with closed state', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBe(null);
  });

  it('opens preview and creates tab', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('# Hello', 'markdown', { title: 'test.md' });
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].content).toBe('# Hello');
    expect(result.current.tabs[0].content_type).toBe('markdown');
  });

  it('dispatches a workspace-expand event when opening a preview', () => {
    const handler = vi.fn();
    window.addEventListener(WORKSPACE_EXPAND_EVENT, handler);
    try {
      const { result } = renderHook(() => usePreviewContext(), { wrapper });
      act(() => {
        result.current.openPreview('# Hi', 'markdown', { title: 'reveal.md' });
      });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(WORKSPACE_EXPAND_EVENT, handler);
    }
  });

  it('closes preview and clears all tabs', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('content', 'code');
    });
    act(() => {
      result.current.closePreview();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.tabs).toEqual([]);
  });

  it('provides all context API methods', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    expect(typeof result.current.openPreview).toBe('function');
    expect(typeof result.current.closePreview).toBe('function');
    expect(typeof result.current.updateContent).toBe('function');
    expect(typeof result.current.findPreviewTab).toBe('function');
  });

  it('updates content and marks tab as dirty', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('original', 'code');
    });
    expect(result.current.activeTab?.isDirty).toBe(false);
    act(() => {
      result.current.updateContent('modified');
    });
    expect(result.current.activeTab?.content).toBe('modified');
    expect(result.current.activeTab?.isDirty).toBe(true);
  });

  it('refreshes an Office preview after its file changes without reading binary content', async () => {
    vi.useFakeTimers();
    const filePath = '/workspace/reports/forecast.docx';
    vi.mocked(ipcBridge.fs.getFileMetadata.invoke)
      .mockResolvedValueOnce({
        name: 'forecast.docx',
        path: filePath,
        size: 128,
        type: 'file',
        lastModified: 1,
      })
      .mockResolvedValueOnce({
        name: 'forecast.docx',
        path: filePath,
        size: 128,
        type: 'file',
        lastModified: 2,
      });
    vi.mocked(ipcBridge.fs.readFile.invoke).mockResolvedValue(null);

    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('', 'word', { file_path: filePath, workspace: '/workspace' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.activeTab?.officePreviewRevision).toBe(1);
    expect(ipcBridge.fs.readFile.invoke).not.toHaveBeenCalled();
  });
});
