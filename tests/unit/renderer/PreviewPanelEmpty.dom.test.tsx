/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ctx.value,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// Mock @icon-park/react broadly so any icons PreviewPanel/toolbar use render as stubs.
// (A Proxy-based catch-all is not used here because Vitest's mock export-existence
// check requires enumerable own keys, which a bare Proxy does not provide.)
vi.mock('@icon-park/react', () => ({
  FileText: () => <span aria-hidden='true' />,
  Close: () => <span aria-hidden='true' />,
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
    previewHistory: {
      list: { invoke: vi.fn() },
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
  usePreviewHistory: () => ({
    historyVersions: [],
    historyLoading: false,
    snapshotSaving: false,
    historyError: null,
    historyTarget: null,
    refreshHistory: vi.fn(),
    handleSaveSnapshot: vi.fn(),
    handleSnapshotSelect: vi.fn(),
    messageApi: { error: vi.fn(), success: vi.fn() },
    messageContextHolder: null,
  }),
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
    askForge: vi.fn(),
    openInDesktopApp: vi.fn(),
    moveSelection: vi.fn(),
  }),
  OfficeArtifactToolbar: () => <div data-testid='office-artifact-toolbar' />,
}));

import PreviewPanel from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel';

const emptyContext = (overrides: Record<string, unknown> = {}) => ({
  isOpen: true,
  tabs: [],
  activeTabId: null,
  activeTab: null,
  closeTab: vi.fn(),
  switchTab: vi.fn(),
  closePreview: vi.fn(),
  updateContent: vi.fn(),
  saveContent: vi.fn(),
  addToSendBox: vi.fn(),
  addDomSnippet: vi.fn(),
  ...overrides,
});

describe('PreviewPanel empty state', () => {
  it('shows the artifact empty state when there are no tabs', () => {
    ctx.value = emptyContext();
    render(<PreviewPanel />);
    expect(screen.getByText('conversation.artifact.emptyTitle')).toBeInTheDocument();
  });

  it('renders the empty state even when the preview is closed (isOpen=false)', () => {
    // The pane is always mounted while expanded; visibility is owned by
    // ChatLayout's collapse state, not the preview `isOpen` flag.
    ctx.value = emptyContext({ isOpen: false });
    render(<PreviewPanel />);
    expect(screen.getByText('conversation.artifact.emptyTitle')).toBeInTheDocument();
  });

  it('collapses the pane from the tab-bar close button via onRequestCollapse', async () => {
    const user = userEvent.setup();
    const onRequestCollapse = vi.fn();
    const closePreview = vi.fn();
    ctx.value = emptyContext({ closePreview });

    render(<PreviewPanel onRequestCollapse={onRequestCollapse} />);

    await user.click(screen.getByRole('button', { name: 'preview.collapsePanel' }));
    expect(onRequestCollapse).toHaveBeenCalledOnce();
    // The collapse request must not fall through to closePreview when a handler exists.
    expect(closePreview).not.toHaveBeenCalled();
  });
});
