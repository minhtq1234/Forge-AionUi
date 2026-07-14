/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import { PreviewProvider, usePreviewContext } from '@/renderer/pages/conversation/Preview';
import ChatWorkspace from '@/renderer/pages/conversation/Workspace';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureNodeSelected: vi.fn(),
  getConversationOrNull: vi.fn(),
  onSearch: vi.fn(),
  refreshChanges: vi.fn(),
  setContextMenu: vi.fn(),
  setSearchText: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  navigate: vi.fn(),
  readFile: vi.fn(),
  writeRendererLogInvoke: vi.fn(),
  useContextCompaction: vi.fn(() => ({ compact: vi.fn(), isCompacting: false })),
}));

let titlebarProjectSlot: HTMLDivElement | null = null;

const fileA: IDirOrFile = {
  name: 'a.md',
  relativePath: 'a.md',
  fullPath: '/workspace/a.md',
  isDir: false,
  isFile: true,
};

const fileB: IDirOrFile = {
  name: 'b.md',
  relativePath: 'b.md',
  fullPath: '/workspace/b.md',
  isDir: false,
  isFile: true,
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

// Real PreviewContext + real useWorkspaceFileOps are intentionally NOT mocked here:
// this test exercises the actual wiring from a Project-flyout click through to the
// PreviewContext tabs array, which is exactly where the "cannot open multiple docs"
// bug lived.
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getWorkspace: { invoke: vi.fn().mockResolvedValue([]) },
    },
    fs: {
      readFile: { invoke: mocks.readFile },
      getImageBase64: { invoke: vi.fn() },
      writeFile: { invoke: vi.fn() },
      getFileMetadata: { invoke: vi.fn().mockResolvedValue(null) },
    },
    application: {
      writeRendererLog: { invoke: mocks.writeRendererLogInvoke },
    },
    fileStream: {
      contentUpdate: { on: vi.fn(() => vi.fn()) },
    },
    preview: {
      open: { on: vi.fn(() => vi.fn()) },
    },
  },
}));

vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    className,
    onClick,
    onContextMenu,
    role,
    ...props
  }: React.PropsWithChildren<{
    className?: string;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
    role?: string;
  }>) => (
    <button className={className} onClick={onClick} onContextMenu={onContextMenu} role={role} {...props}>
      {children}
    </button>
  ),
  Collapse: Object.assign(
    ({ children }: { children: React.ReactNode }) => <div data-testid='workspace-sections'>{children}</div>,
    {
      Item: ({ header, name, children }: { header: React.ReactNode; name: string; children: React.ReactNode }) => (
        <section data-testid={`workspace-section-${name}`}>
          <div>{header}</div>
          {children}
        </section>
      ),
    }
  ),
  Empty: () => <div data-testid='empty' />,
  Input: ({
    className,
    onChange,
    placeholder,
    value,
  }: {
    className?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    value?: string;
  }) => (
    <input
      className={className}
      onChange={(event) => onChange?.(event.currentTarget.value)}
      placeholder={placeholder}
      value={value}
    />
  ),
  Message: {
    useMessage: () => [
      {
        error: mocks.messageError,
        success: mocks.messageSuccess,
        warning: mocks.messageWarning,
        info: vi.fn(),
      },
      null,
    ],
  },
}));

vi.mock('@icon-park/react', () => ({
  BranchOne: () => <span />,
  Down: () => <span />,
  FileText: () => <span />,
  FolderOpen: () => <span />,
  Right: () => <span />,
  Search: () => <span />,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: mocks.getConversationOrNull,
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  useAddEventListener: vi.fn((event: string, listener: (payload: unknown) => void) => {
    mocks.listeners.set(event, listener);
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useWorkspaceTree', () => ({
  useWorkspaceTree: () => ({
    files: [{ name: 'workspace', relativePath: '', fullPath: '/workspace', isFile: false, children: [fileA, fileB] }],
    loading: false,
    treeKey: 1,
    expandedKeys: [],
    selected: [],
    selectedKeysRef: { current: [] },
    selectedNodeRef: { current: null },
    setFiles: vi.fn(),
    setLoading: vi.fn(),
    setExpandedKeys: vi.fn(),
    setSelected: vi.fn(),
    setTreeKey: vi.fn(),
    refreshWorkspace: vi.fn(),
    loadWorkspace: vi.fn(),
    ensureNodeSelected: mocks.ensureNodeSelected,
    clearSelection: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useFileChanges', () => ({
  useFileChanges: () => ({
    staged: [],
    unstaged: [],
    loading: false,
    snapshotInfo: null,
    changeCount: 0,
    refreshChanges: mocks.refreshChanges,
    stageFile: vi.fn(),
    stageAll: vi.fn(),
    unstageFile: vi.fn(),
    unstageAll: vi.fn(),
    discardFile: vi.fn(),
    resetFile: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useWorkspacePaste', () => ({
  useWorkspacePaste: () => ({
    pasteTargetFolder: null,
    pasteConfirm: { visible: false },
    onFocusPaste: vi.fn(),
    handleFilesToAdd: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useWorkspaceDragImport', () => ({
  useWorkspaceDragImport: () => ({
    isDragging: false,
    dragHandlers: {},
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useWorkspaceSearch', () => ({
  useWorkspaceSearch: () => ({
    showSearch: false,
    searchText: '',
    setShowSearch: vi.fn(),
    setSearchText: mocks.setSearchText,
    onSearch: mocks.onSearch,
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useWorkspaceModals', () => ({
  useWorkspaceModals: () => ({
    contextMenu: { visible: false, x: 0, y: 0, node: null },
    renameModal: { visible: false, value: '', target: null },
    deleteModal: { visible: false, target: null, loading: false },
    pasteConfirm: { visible: false, file_name: '', filesToPaste: [], doNotAsk: false, targetFolder: null },
    renameLoading: false,
    setContextMenu: mocks.setContextMenu,
    setRenameModal: vi.fn(),
    setDeleteModal: vi.fn(),
    setPasteConfirm: vi.fn(),
    setRenameLoading: vi.fn(),
    closeContextMenu: vi.fn(),
    closeRenameModal: vi.fn(),
    closeDeleteModal: vi.fn(),
    closePasteConfirm: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: vi.fn(),
}));

vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Workspace/components/WorkspaceContextMenu', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/conversation/Workspace/components/WorkspaceDialogs', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/conversation/Workspace/components/PasteConfirmModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/conversation/Workspace/components/FileChangeList', () => ({
  default: () => <div data-testid='file-change-list' />,
}));

vi.mock('@/renderer/pages/conversation/contextHandoff/ContextHandoffPanel', () => ({
  default: () => <div data-testid='context-handoff-panel' />,
}));

vi.mock('@/renderer/pages/conversation/contextHandoff/useContextCompaction', () => ({
  useContextCompaction: mocks.useContextCompaction,
  handoffConversationContext: vi.fn(),
  pinConversationContext: vi.fn(),
}));

/** Exposes live PreviewContext tab state via the DOM so the test can assert on it. */
const PreviewInspector: React.FC = () => {
  const { tabs, activeTabId } = usePreviewContext();
  return (
    <div>
      <div data-testid='tab-count'>{tabs.length}</div>
      <ul>
        {tabs.map((tab) => (
          <li
            key={tab.id}
            data-testid='tab'
            data-file-path={tab.metadata?.file_path}
            data-preview={String(!!tab.preview)}
            data-active={String(tab.id === activeTabId)}
          >
            {tab.metadata?.file_path}
          </li>
        ))}
      </ul>
    </div>
  );
};

const openFilesFlyout = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /conversation.workspace.projectMenu.trigger/ }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: /conversation.workspace.changes.filesTab/ }));
  });
};

describe('ChatWorkspace Project Files flyout multi-tab accumulation', () => {
  beforeEach(() => {
    titlebarProjectSlot = document.createElement('div');
    titlebarProjectSlot.id = 'app-titlebar-project-slot';
    document.body.append(titlebarProjectSlot);
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.getConversationOrNull.mockResolvedValue(null);
    mocks.readFile.mockImplementation(({ path }: { path: string }) => {
      if (path === '/workspace/a.md') return Promise.resolve('# File A');
      if (path === '/workspace/b.md') return Promise.resolve('# File B');
      return Promise.resolve('');
    });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    titlebarProjectSlot?.remove();
    titlebarProjectSlot = null;
  });

  it('accumulates a pinned tab per file opened from the Project Files flyout, and dedupes reopens', async () => {
    render(
      <PreviewProvider>
        <PreviewInspector />
        <ChatWorkspace conversation_id='conversation-1' workspace='/workspace' />
      </PreviewProvider>
    );

    await openFilesFlyout();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'a.md' }));
    });
    await waitFor(() => expect(screen.getByTestId('tab-count')).toHaveTextContent('1'));

    // Opening a DIFFERENT file must accumulate a second tab, not replace the first.
    await openFilesFlyout();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'b.md' }));
    });
    await waitFor(() => expect(screen.getByTestId('tab-count')).toHaveTextContent('2'));

    const tabsAfterTwoOpens = screen.getAllByTestId('tab');
    expect(tabsAfterTwoOpens.map((tab) => tab.getAttribute('data-file-path'))).toEqual(
      expect.arrayContaining(['/workspace/a.md', '/workspace/b.md'])
    );
    // Both opened from the flyout as persistent/pinned tabs, never the provisional preview slot.
    tabsAfterTwoOpens.forEach((tab) => expect(tab).toHaveAttribute('data-preview', 'false'));

    // Reopening file A must focus the existing tab (dedupe), not create a third one.
    await openFilesFlyout();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'a.md' }));
    });
    await waitFor(() => expect(screen.getByTestId('tab-count')).toHaveTextContent('2'));

    const aTab = screen.getAllByTestId('tab').find((tab) => tab.getAttribute('data-file-path') === '/workspace/a.md');
    expect(aTab).toHaveAttribute('data-active', 'true');
  });
});
