/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PreviewTab } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import {
  sanitizeTabsForPersistence,
  parsePersistedTabs,
} from '@/renderer/pages/conversation/Preview/context/PreviewContext';

const PREVIEW_TABS_KEY = 'aionui_preview_tabs';
const PREVIEW_ACTIVE_TAB_ID_KEY = 'aionui_preview_active_tab_id';

const makeTab = (overrides: Partial<PreviewTab>): PreviewTab => ({
  id: 'tab-1',
  content: '',
  content_type: 'markdown',
  title: 'untitled',
  isDirty: false,
  originalContent: '',
  ...overrides,
});

describe('PreviewTab persistence — file-backed tab types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sanitizeTabsForPersistence', () => {
    it('keeps a word tab with a file_path but drops its content, storing it as a reference', () => {
      const tab = makeTab({
        id: 'word-1',
        content: 'binary-ish content that should never be persisted',
        content_type: 'word',
        title: 'Report.docx',
        metadata: { file_path: '/workspace/Report.docx', file_name: 'Report.docx', workspace: '/workspace' },
        preview: false,
        officePreviewRevision: 3,
      });

      const result = sanitizeTabsForPersistence([tab]);

      expect(result).toHaveLength(1);
      const persisted = result[0];
      expect(persisted.content).toBe('');
      expect(persisted.content_type).toBe('word');
      expect(persisted.title).toBe('Report.docx');
      expect(persisted.metadata?.file_path).toBe('/workspace/Report.docx');
      expect(persisted.officePreviewRevision).toBe(3);
      expect(persisted.isDirty).toBe(false);
    });

    it('drops a file-backed tab that has no metadata.file_path', () => {
      const noMetaTab = makeTab({ id: 'pdf-1', content_type: 'pdf', title: 'no-path.pdf' });
      const emptyPathTab = makeTab({
        id: 'excel-1',
        content_type: 'excel',
        title: 'empty-path.xlsx',
        metadata: { file_path: '' },
      });

      const result = sanitizeTabsForPersistence([noMetaTab, emptyPathTab]);

      expect(result).toEqual([]);
    });

    it('still persists inline text tabs (markdown/html/code/diff) with content, capped at 80k', () => {
      const smallMarkdown = makeTab({ id: 'md-1', content_type: 'markdown', content: '# hello', title: 'a.md' });
      const bigCode = makeTab({
        id: 'code-1',
        content_type: 'code',
        content: 'x'.repeat(80_001),
        title: 'big.ts',
      });

      const result = sanitizeTabsForPersistence([smallMarkdown, bigCode]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('md-1');
      expect(result[0].content).toBe('# hello');
    });

    it('round-trips the preview flag for both a text tab and a file-backed reference tab', () => {
      const previewTextTab = makeTab({
        id: 'md-preview',
        content_type: 'markdown',
        content: 'draft',
        preview: true,
      });
      const previewFileTab = makeTab({
        id: 'word-preview',
        content_type: 'word',
        metadata: { file_path: '/workspace/draft.docx' },
        preview: true,
      });

      const result = sanitizeTabsForPersistence([previewTextTab, previewFileTab]);

      expect(result.find((t) => t.id === 'md-preview')?.preview).toBe(true);
      expect(result.find((t) => t.id === 'word-preview')?.preview).toBe(true);
    });
  });

  describe('parsePersistedTabs', () => {
    it('restores a file-backed reference tab with content reset to an empty string', () => {
      const raw = [
        {
          id: 'word-1',
          content: '',
          content_type: 'word',
          title: 'Report.docx',
          metadata: { file_path: '/workspace/Report.docx', file_name: 'Report.docx', workspace: '/workspace' },
        },
      ];

      const result = parsePersistedTabs(raw);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('word-1');
      expect(result[0].content).toBe('');
      expect(result[0].content_type).toBe('word');
      expect(result[0].metadata?.file_path).toBe('/workspace/Report.docx');
    });
  });
});

describe('loadPersistedState — dropping unresolvable file-backed tabs', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const loadModuleFresh = async () => {
    vi.doMock('@/common', () => ({
      ipcBridge: {
        fileStream: { contentUpdate: { on: vi.fn(() => vi.fn()) } },
        preview: { open: { on: vi.fn(() => vi.fn()) } },
        fs: {
          writeFile: { invoke: vi.fn() },
          getFileMetadata: { invoke: vi.fn() },
          readFile: { invoke: vi.fn() },
          getImageBase64: { invoke: vi.fn() },
        },
      },
    }));
    vi.doMock('@/renderer/utils/emitter', () => ({
      emitter: { on: vi.fn(), off: vi.fn() },
    }));

    const { PreviewProvider, usePreviewContext } =
      await import('@/renderer/pages/conversation/Preview/context/PreviewContext');
    return { PreviewProvider, usePreviewContext };
  };

  it('drops file-backed tabs whose file_path is missing/unresolvable and warns with the dropped count', async () => {
    const storedTabs = [
      {
        id: 'word-broken',
        content: '',
        content_type: 'word',
        title: 'broken.docx',
        metadata: { file_path: '' },
      },
      {
        id: 'md-ok',
        content: '# still here',
        content_type: 'markdown',
        title: 'ok.md',
        metadata: {},
      },
    ];
    localStorage.setItem(PREVIEW_TABS_KEY, JSON.stringify(storedTabs));
    localStorage.setItem(PREVIEW_ACTIVE_TAB_ID_KEY, 'word-broken');

    const { PreviewProvider, usePreviewContext } = await loadModuleFresh();
    const { renderHook } = await import('@testing-library/react');
    const React = await import('react');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(PreviewProvider, null, children);
    const { result } = renderHook(() => usePreviewContext(), { wrapper });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe('md-ok');
    // The dangling activeTabId (pointing at the dropped tab) falls back to the remaining tab.
    expect(result.current.activeTabId).toBe('md-ok');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toEqual(expect.stringContaining('1'));
  });

  it('does not warn when there is nothing to drop', async () => {
    const storedTabs = [
      {
        id: 'word-ok',
        content: '',
        content_type: 'word',
        title: 'ok.docx',
        metadata: { file_path: '/workspace/ok.docx' },
      },
    ];
    localStorage.setItem(PREVIEW_TABS_KEY, JSON.stringify(storedTabs));

    const { PreviewProvider, usePreviewContext } = await loadModuleFresh();
    const { renderHook } = await import('@testing-library/react');
    const React = await import('react');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(PreviewProvider, null, children);
    const { result } = renderHook(() => usePreviewContext(), { wrapper });

    expect(result.current.tabs).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
