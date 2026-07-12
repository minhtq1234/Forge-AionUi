/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ctx.value,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@icon-park/react', () => ({
  FileText: () => <span aria-hidden='true' />,
  Close: () => <span aria-hidden='true' />,
}));

// Stub the Office viewer so the with-tab branch renders without pulling the
// heavy office pipeline — the test only cares that PreviewPanel itself renders
// (its hook order) across the empty <-> document transition.
vi.mock('@/renderer/pages/conversation/Preview/components/viewers/OfficeDocViewer', () => ({
  default: () => <div data-testid='office-doc-preview' />,
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
    fs: {
      writeFile: { invoke: vi.fn() },
      readFile: { invoke: vi.fn() },
      getFileMetadata: { invoke: vi.fn() },
      getImageBase64: { invoke: vi.fn() },
    },
    fileStream: {
      contentUpdate: { on: vi.fn(() => vi.fn()) },
    },
    preview: {
      open: { on: vi.fn(() => vi.fn()) },
    },
  },
}));
vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromPath: vi.fn(),
  downloadTextContent: vi.fn(),
}));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
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
    undoDepth: 0,
    inspection: null,
    status: 'ready',
    scriptRequest: null,
    handleSelectionChange: vi.fn(),
    apply: vi.fn(),
    undo: vi.fn(),
    openInDesktopApp: vi.fn(),
    moveSelection: vi.fn(),
  }),
  OfficeArtifactToolbar: () => <div data-testid='office-artifact-toolbar' />,
}));

import PreviewPanel from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel';

const baseCallbacks = () => ({
  closeTab: vi.fn(),
  switchTab: vi.fn(),
  closePreview: vi.fn(),
  updateContent: vi.fn(),
  saveContent: vi.fn(),
  addToSendBox: vi.fn(),
  addDomSnippet: vi.fn(),
});

const emptyContext = () => ({ isOpen: true, tabs: [], activeTabId: null, activeTab: null, ...baseCallbacks() });

const wordTab = {
  id: 'tab-1',
  title: 'report.docx',
  content: '',
  content_type: 'word',
  metadata: { file_path: '/workspace/report.docx', workspace: '/workspace', file_name: 'report.docx' },
  isDirty: false,
};

const docContext = () => ({
  isOpen: true,
  tabs: [wordTab],
  activeTabId: 'tab-1',
  activeTab: wordTab,
  ...baseCallbacks(),
});

describe('PreviewPanel hook order across empty <-> document transitions', () => {
  afterEach(() => {
    ctx.value = {};
  });

  it('does not crash when an empty pane transitions to an open document', () => {
    // Regression for the Rules-of-Hooks crash: the empty render used to run
    // fewer hooks than the with-document render (early return above four
    // useCallbacks), so opening a doc threw "Rendered more hooks…".
    ctx.value = emptyContext();
    const { rerender } = render(<PreviewPanel />);
    expect(screen.getByText('conversation.artifact.emptyTitle')).toBeInTheDocument();

    ctx.value = docContext();
    expect(() => rerender(<PreviewPanel />)).not.toThrow();

    expect(screen.getByTestId('office-doc-preview')).toBeInTheDocument();
    expect(screen.queryByText('conversation.artifact.emptyTitle')).not.toBeInTheDocument();
  });

  it('does not crash on the reverse document -> empty transition', () => {
    ctx.value = docContext();
    const { rerender } = render(<PreviewPanel />);
    expect(screen.getByTestId('office-doc-preview')).toBeInTheDocument();

    ctx.value = emptyContext();
    expect(() => rerender(<PreviewPanel />)).not.toThrow();

    expect(screen.getByText('conversation.artifact.emptyTitle')).toBeInTheDocument();
  });
});
