/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OfficeArtifactSelection } from '@/common/types/office/artifactEditor';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const mocks = vi.hoisted(() => ({
  desktop: true,
  previewContext: { current: {} as Record<string, unknown> },
  editorOptions: { current: null as Record<string, unknown> | null },
  toolbarProps: { current: null as Record<string, unknown> | null },
  wordViewerProps: { current: null as Record<string, unknown> | null },
  excelViewerProps: { current: null as Record<string, unknown> | null },
  getState: vi.fn(),
  inspect: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
  openFile: vi.fn(),
  showItemInFolder: vi.fn(),
  downloadFileFromPath: vi.fn(),
  handleSelectionChange: vi.fn(),
  applyEdit: vi.fn(),
  undoEdit: vi.fn(),
  askForge: vi.fn(),
  openInDesktopApp: vi.fn(),
  moveSelection: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    officeArtifact: {
      getState: { invoke: mocks.getState },
      inspect: { invoke: mocks.inspect },
      apply: { invoke: mocks.apply },
      undo: { invoke: mocks.undo },
    },
    shell: {
      openFile: { invoke: mocks.openFile },
      showItemInFolder: { invoke: mocks.showItemInFolder },
    },
  },
}));

vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromPath: mocks.downloadFileFromPath,
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

vi.mock('@/renderer/styles/colors', () => ({
  iconColors: { secondary: 'currentColor' },
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
  useOfficeArtifactEditor: (options: Record<string, unknown>) => {
    mocks.editorOptions.current = options;
    return {
      version: 'v1',
      undoDepth: 1,
      inspection: null,
      status: 'ready',
      scriptRequest: { id: 7, script: 'move-selection' },
      handleSelectionChange: mocks.handleSelectionChange,
      apply: mocks.applyEdit,
      undo: mocks.undoEdit,
      askForge: mocks.askForge,
      openInDesktopApp: mocks.openInDesktopApp,
      moveSelection: mocks.moveSelection,
    };
  },
  OfficeArtifactToolbar: (props: Record<string, unknown>) => {
    mocks.toolbarProps.current = props;
    return <div data-testid='office-artifact-toolbar' />;
  },
}));

vi.mock('@/renderer/pages/conversation/Preview/components/viewers/OfficeDocViewer', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.wordViewerProps.current = props;
    return <div data-testid='word-viewer' />;
  },
}));

vi.mock('@/renderer/pages/conversation/Preview/components/viewers/ExcelViewer', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.excelViewerProps.current = props;
    return <div data-testid='excel-viewer' />;
  },
}));

vi.mock('@/renderer/pages/conversation/Preview/components/viewers/PptViewer', () => ({
  default: () => <div data-testid='ppt-viewer' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import PreviewPanel from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel';

const wordSelection: OfficeArtifactSelection = {
  kind: 'word',
  path: '/body/p[1]',
  paragraphText: 'Quarterly revenue',
  selectedText: 'Quarterly',
  start: 0,
  end: 9,
};

const createTab = (contentType: 'word' | 'excel' | 'ppt') => ({
  id: `${contentType}-tab`,
  title: `report.${contentType}`,
  content: '',
  content_type: contentType,
  officePreviewRevision: 2,
  metadata: {
    file_name: `report.${contentType}`,
    file_path: `/workspace/report.${contentType}`,
    workspace: '/workspace',
  },
});

const setActiveTab = (contentType: 'word' | 'excel' | 'ppt') => {
  const activeTab = createTab(contentType);
  mocks.previewContext.current = {
    isOpen: true,
    tabs: [activeTab],
    activeTabId: activeTab.id,
    activeTab,
    closeTab: vi.fn(),
    switchTab: vi.fn(),
    closePreview: vi.fn(),
    updateContent: vi.fn(),
    saveContent: vi.fn(),
    addToSendBox: vi.fn(),
    addDomSnippet: vi.fn(),
  };
};

describe('PreviewPanel Office artifact integration', () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.editorOptions.current = null;
    mocks.toolbarProps.current = null;
    mocks.wordViewerProps.current = null;
    mocks.excelViewerProps.current = null;
    vi.clearAllMocks();
    mocks.showItemInFolder.mockResolvedValue(undefined);
    mocks.downloadFileFromPath.mockResolvedValue(undefined);
  });

  it('renders one artifact toolbar and forwards Word guest selection controls', () => {
    setActiveTab('word');
    render(<PreviewPanel />);

    expect(screen.getAllByTestId('office-artifact-toolbar')).toHaveLength(1);
    expect(screen.queryByText('preview.office.externalEdit.editInDefaultApp')).not.toBeInTheDocument();
    expect(mocks.editorOptions.current).toMatchObject({
      enabled: true,
      conversationId: 'conversation-1',
      workspace: '/workspace',
      filePath: '/workspace/report.word',
      fileName: 'report.word',
      addToSendBox: mocks.previewContext.current.addToSendBox,
    });
    expect(mocks.wordViewerProps.current).toMatchObject({
      conversationId: 'conversation-1',
      onSelectionChange: mocks.handleSelectionChange,
      scriptRequest: { id: 7, script: 'move-selection' },
    });

    const onSelectionChange = mocks.wordViewerProps.current?.onSelectionChange as
      | ((selection: OfficeArtifactSelection) => void)
      | undefined;
    onSelectionChange?.(wordSelection);
    expect(mocks.handleSelectionChange).toHaveBeenCalledWith(wordSelection);
  });

  it('removes only the decorative outer radius in full-bleed mode', () => {
    setActiveTab('word');
    const view = render(<PreviewPanel fullBleed />);

    expect(screen.getByTestId('preview-panel-surface')).not.toHaveClass('rounded-[16px]');

    view.rerender(<PreviewPanel />);
    expect(screen.getByTestId('preview-panel-surface')).toHaveClass('rounded-[16px]');
  });

  it('wires artifact actions without restarting Office watch after a successful mutation', async () => {
    setActiveTab('word');
    render(<PreviewPanel />);
    const initialRefreshToken = mocks.wordViewerProps.current?.refreshToken;
    const toolbarProps = mocks.toolbarProps.current;

    expect(toolbarProps).toMatchObject({
      openInDesktopApp: mocks.openInDesktopApp,
      askForge: mocks.askForge,
      apply: mocks.applyEdit,
      undo: mocks.undoEdit,
      moveSelection: mocks.moveSelection,
    });

    await act(async () => {
      (toolbarProps?.download as (() => void) | undefined)?.();
    });
    expect(mocks.downloadFileFromPath).toHaveBeenCalledWith('/workspace/report.word', 'report.word', '/workspace');

    act(() => (toolbarProps?.revealInFolder as (() => void) | undefined)?.());
    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/workspace/report.word');

    act(() => (mocks.editorOptions.current?.onArtifactMutated as (() => void) | undefined)?.());
    expect(mocks.wordViewerProps.current?.refreshToken).toBe(initialRefreshToken);
  });

  it('resynchronizes editor state and refreshes the isolated Office copy for a workspace revision', () => {
    setActiveTab('word');
    const view = render(<PreviewPanel />);
    const initialEditorRevision = mocks.editorOptions.current?.externalRevision;
    const initialRefreshToken = mocks.wordViewerProps.current?.refreshToken;
    const activeTab = mocks.previewContext.current.activeTab as ReturnType<typeof createTab>;
    mocks.previewContext.current = {
      ...mocks.previewContext.current,
      tabs: [{ ...activeTab, officePreviewRevision: 3 }],
      activeTab: { ...activeTab, officePreviewRevision: 3 },
    };

    view.rerender(<PreviewPanel />);

    expect(mocks.editorOptions.current?.externalRevision).not.toBe(initialEditorRevision);
    expect(mocks.wordViewerProps.current?.refreshToken).not.toBe(initialRefreshToken);
  });

  it('resynchronizes editor state when the user manually refreshes the Office preview', async () => {
    setActiveTab('word');
    render(<PreviewPanel />);
    const initialEditorRevision = mocks.editorOptions.current?.externalRevision;
    const initialRefreshToken = mocks.wordViewerProps.current?.refreshToken;

    act(() => (mocks.toolbarProps.current?.refresh as (() => void) | undefined)?.());

    await waitFor(() => expect(mocks.wordViewerProps.current?.refreshToken).not.toBe(initialRefreshToken));
    expect(mocks.editorOptions.current?.externalRevision).not.toBe(initialEditorRevision);
  });

  it.each([
    { contentType: 'ppt' as const, desktop: true },
    { contentType: 'word' as const, desktop: false },
  ])('keeps $contentType read-only when desktop support is $desktop', ({ contentType, desktop }) => {
    mocks.desktop = desktop;
    setActiveTab(contentType);
    render(<PreviewPanel />);

    expect(mocks.editorOptions.current).toMatchObject({ enabled: false });
    expect(screen.queryByTestId('office-artifact-toolbar')).not.toBeInTheDocument();
    if (contentType === 'word') {
      expect(mocks.wordViewerProps.current?.onSelectionChange).toBeUndefined();
      expect(mocks.wordViewerProps.current?.scriptRequest).toBeUndefined();
    }
  });
});
