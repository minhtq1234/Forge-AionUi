/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// The LRU hook is imported directly from its module (not the barrel) so the
// PreviewPanel barrel mock below never intercepts it — the real hook runs both
// in the direct unit test and inside the integration render.
import {
  useWarmOfficeTabs,
  WARM_OFFICE_TAB_LIMIT,
} from '@/renderer/pages/conversation/Preview/hooks/useWarmOfficeTabs';

describe('useWarmOfficeTabs LRU', () => {
  it('exposes a warm limit of 3', () => {
    expect(WARM_OFFICE_TAB_LIMIT).toBe(3);
  });

  it('keeps at most WARM_OFFICE_TAB_LIMIT ids, most-recently-active first', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const { result, rerender } = renderHook(({ active }: { active: string }) => useWarmOfficeTabs(active, ids), {
      initialProps: { active: 'a' },
    });

    // Initial: a active, then the remaining tabs in listed order.
    expect(result.current.size).toBeLessThanOrEqual(WARM_OFFICE_TAB_LIMIT);
    expect(result.current.has('a')).toBe(true);

    const seenSequence: Set<string>[] = [result.current];
    for (const active of ['b', 'c', 'd']) {
      rerender({ active });
      // (a) never exceed the cap.
      expect(result.current.size).toBeLessThanOrEqual(WARM_OFFICE_TAB_LIMIT);
      // (d) the active tab is always warm.
      expect(result.current.has(active)).toBe(true);
      seenSequence.push(result.current);
    }

    // After activating a -> b -> c -> d, the three most-recently-active are
    // d, c, b; a (least recently active) has been evicted. (b) + (c)
    const warm = result.current;
    expect([...warm].toSorted()).toEqual(['b', 'c', 'd']);
    expect(warm.has('a')).toBe(false);
  });

  it('mounts a reactivated cold tab and evicts the least-recently-active warm tab', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const { result, rerender } = renderHook(({ active }: { active: string }) => useWarmOfficeTabs(active, ids), {
      initialProps: { active: 'a' },
    });
    // Drive recency: a, b, c => warm {c, b, a}; d is cold.
    rerender({ active: 'b' });
    rerender({ active: 'c' });
    expect([...result.current].toSorted()).toEqual(['a', 'b', 'c']);
    expect(result.current.has('d')).toBe(false);

    // Activating the cold tab d mounts it and evicts a (LRU of {c, b, a}).
    rerender({ active: 'd' });
    expect(result.current.has('d')).toBe(true);
    expect(result.current.has('a')).toBe(false);
    expect([...result.current].toSorted()).toEqual(['b', 'c', 'd']);
  });

  it('drops a closed tab out of the warm set', () => {
    const { result, rerender } = renderHook(
      ({ active, ids }: { active: string; ids: string[] }) => useWarmOfficeTabs(active, ids),
      { initialProps: { active: 'a', ids: ['a', 'b', 'c'] } }
    );
    expect([...result.current].toSorted()).toEqual(['a', 'b', 'c']);

    // Close tab b (drops from the id list); it must leave the warm set.
    rerender({ active: 'a', ids: ['a', 'c'] });
    expect(result.current.has('b')).toBe(false);
    expect([...result.current].toSorted()).toEqual(['a', 'c']);
  });

  it('is deterministic and idempotent across duplicate renders with identical inputs', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const { result, rerender } = renderHook(({ active }: { active: string }) => useWarmOfficeTabs(active, ids), {
      initialProps: { active: 'd' },
    });
    const first = [...result.current];
    rerender({ active: 'd' });
    rerender({ active: 'd' });
    expect([...result.current]).toEqual(first);
  });
});

// --- PreviewPanel integration -------------------------------------------------

const mocks = vi.hoisted(() => ({
  desktop: true,
  previewContext: { current: {} as Record<string, unknown> },
  wordMounts: { current: {} as Record<string, number> },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    officeArtifact: {
      getState: { invoke: vi.fn() },
      inspect: { invoke: vi.fn() },
      apply: { invoke: vi.fn() },
      undo: { invoke: vi.fn() },
    },
    shell: {
      openFile: { invoke: vi.fn() },
      showItemInFolder: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromPath: vi.fn(),
  downloadTextContent: vi.fn(),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => mocks.desktop,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ id: 'conversation-1' }),
}));

vi.mock('@/renderer/hooks/ui/useResizableSplit', () => ({
  useResizableSplit: () => ({ splitRatio: 50, createDragHandle: () => null }),
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => mocks.previewContext.current,
}));

// The barrel mock intentionally omits useWarmOfficeTabs — PreviewPanel imports
// that hook from its own module, so the real LRU logic drives the render.
vi.mock('@/renderer/pages/conversation/Preview/hooks', () => ({
  useThemeDetection: () => 'light',
  useTabOverflow: () => ({
    tabsContainerRef: { current: null },
    tabFadeState: { left: false, right: false },
  }),
  useScrollSync: () => ({ handleEditorScroll: vi.fn(), handlePreviewScroll: vi.fn() }),
  usePreviewKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Preview/components/ArtifactEditor', () => ({
  useOfficeArtifactEditor: () => ({
    version: 'v1',
    undoDepth: 1,
    inspection: null,
    status: 'ready',
    scriptRequest: { id: 7, script: 'move-selection' },
    handleSelectionChange: vi.fn(),
    apply: vi.fn(),
    undo: vi.fn(),
    openInDesktopApp: vi.fn(),
    moveSelection: vi.fn(),
  }),
  OfficeArtifactToolbar: () => <div data-testid='office-artifact-toolbar' />,
}));

vi.mock('@/renderer/pages/conversation/Preview/components/viewers/OfficeDocViewer', async () => {
  const ReactModule = await import('react');
  return {
    default: ({ file_path }: { file_path?: string }) => {
      const key = file_path ?? '';
      ReactModule.useEffect(() => {
        mocks.wordMounts.current[key] = (mocks.wordMounts.current[key] ?? 0) + 1;
      }, []);
      return <div data-testid={`office-viewer-${key}`} />;
    },
  };
});

vi.mock('@/renderer/pages/conversation/Preview/components/viewers/ExcelViewer', () => ({
  default: () => <div data-testid='excel-viewer' />,
}));

vi.mock('@/renderer/pages/conversation/Preview/components/viewers/PptViewer', () => ({
  default: () => <div data-testid='ppt-viewer' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import PreviewPanel from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel';

const createWordTab = (id: string, filePath: string) => ({
  id,
  title: filePath.split('/').pop() ?? id,
  content: '',
  content_type: 'word' as const,
  officePreviewRevision: 1,
  metadata: {
    file_name: filePath.split('/').pop(),
    file_path: filePath,
    workspace: '/workspace',
  },
});

const tabA = createWordTab('word-a', '/workspace/a.docx');
const tabB = createWordTab('word-b', '/workspace/b.docx');
const tabC = createWordTab('word-c', '/workspace/c.docx');
const tabD = createWordTab('word-d', '/workspace/d.docx');
const allTabs = [tabA, tabB, tabC, tabD];

const setContext = (activeTabId: string) => {
  mocks.previewContext.current = {
    isOpen: true,
    tabs: allTabs,
    activeTabId,
    activeTab: allTabs.find((tab) => tab.id === activeTabId) ?? null,
    closeTab: vi.fn(),
    switchTab: vi.fn(),
    pinTab: vi.fn(),
    closePreview: vi.fn(),
    updateContent: vi.fn(),
    saveContent: vi.fn(),
    addDomSnippet: vi.fn(),
  };
};

const mountedContainerIds = (): string[] =>
  allTabs.map((tab) => tab.id).filter((id) => screen.queryByTestId(`office-viewer-container-${id}`) !== null);

describe('PreviewPanel warm office LRU', () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.wordMounts.current = {};
    vi.clearAllMocks();
  });

  it('mounts at most WARM_OFFICE_TAB_LIMIT office viewers and always keeps the active one warm', () => {
    // Drive an explicit activation order a -> b -> c so recency is
    // unambiguous: a was activated longest ago, c most recently. word-d stays
    // cold the whole time.
    setContext('word-a');
    const view = render(<PreviewPanel />);
    for (const active of ['word-b', 'word-c']) {
      setContext(active);
      view.rerender(<PreviewPanel />);
    }

    // (a) At most 3 office viewers mounted; (d) the active one is among them.
    let mounted = mountedContainerIds();
    expect(mounted.length).toBeLessThanOrEqual(WARM_OFFICE_TAB_LIMIT);
    expect(mounted).toContain('word-c');
    // The 4th tab (never activated) is cold — not mounted.
    expect(mounted).not.toContain('word-d');

    // Activate the cold tab (word-d): it mounts, and the least-recently-active
    // of the previous warm set {c, b, a} — namely word-a — is evicted. (c)
    setContext('word-d');
    view.rerender(<PreviewPanel />);

    mounted = mountedContainerIds();
    expect(mounted.length).toBeLessThanOrEqual(WARM_OFFICE_TAB_LIMIT);
    expect(mounted).toContain('word-d');
    // word-a was the least-recently-active warm tab, so it is now cold.
    expect(mounted).not.toContain('word-a');
  });
});
