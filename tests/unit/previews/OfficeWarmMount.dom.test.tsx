/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const mocks = vi.hoisted(() => ({
  desktop: true,
  previewContext: { current: {} as Record<string, unknown> },
  // Module-level mount counter keyed by the office viewer's file_path. A remount
  // (unmount + mount) bumps the count; a plain re-render or visibility toggle
  // must not.
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

// Word viewer stub: renders a stable testid per file_path and counts mounts so
// the test can prove a tab switch does not remount an already-open viewer.
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

const setContext = (activeTabId: string) => {
  const tabs = [tabA, tabB];
  mocks.previewContext.current = {
    isOpen: true,
    tabs,
    activeTabId,
    activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
    closeTab: vi.fn(),
    switchTab: vi.fn(),
    pinTab: vi.fn(),
    closePreview: vi.fn(),
    updateContent: vi.fn(),
    saveContent: vi.fn(),
    addDomSnippet: vi.fn(),
  };
};

const containerFor = (tabId: string): HTMLElement => screen.getByTestId(`office-viewer-container-${tabId}`);

describe('PreviewPanel warm-mounted office viewers', () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.wordMounts.current = {};
    vi.clearAllMocks();
  });

  it('keeps every open office viewer mounted and shows only the active one', () => {
    setContext('word-a');
    render(<PreviewPanel />);

    // (a) Both office viewers are mounted in the DOM at once.
    expect(screen.getByTestId('office-viewer-/workspace/a.docx')).toBeInTheDocument();
    expect(screen.getByTestId('office-viewer-/workspace/b.docx')).toBeInTheDocument();

    // (b) Exactly one is visible; the inactive one is display:none.
    expect(containerFor('word-a').style.display).not.toBe('none');
    expect(containerFor('word-b').style.display).toBe('none');
  });

  it('does not remount office viewers when switching the active tab', () => {
    setContext('word-a');
    const view = render(<PreviewPanel />);

    expect(mocks.wordMounts.current['/workspace/a.docx']).toBe(1);
    expect(mocks.wordMounts.current['/workspace/b.docx']).toBe(1);

    // Switch active tab A -> B (context swap + rerender, mirroring how the app
    // updates the preview context on switchTab).
    setContext('word-b');
    view.rerender(<PreviewPanel />);

    // (c) No remount: mount counts are unchanged...
    expect(mocks.wordMounts.current['/workspace/a.docx']).toBe(1);
    expect(mocks.wordMounts.current['/workspace/b.docx']).toBe(1);

    // ...and visibility flipped.
    expect(containerFor('word-a').style.display).toBe('none');
    expect(containerFor('word-b').style.display).not.toBe('none');
  });
});
