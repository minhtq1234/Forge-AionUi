/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import ChatWorkspace from '@/renderer/pages/conversation/Workspace';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureNodeSelected: vi.fn(),
  handlePreviewFile: vi.fn(),
  onSearch: vi.fn(),
  refreshChanges: vi.fn(),
  setContextMenu: vi.fn(),
  setSearchText: vi.fn(),
  writeRendererLogInvoke: vi.fn(),
}));
let titlebarProjectSlot: HTMLDivElement | null = null;
let workspaceTreeCollapsed = false;
let workspaceSnapshotInfo: { branch: string } | null = null;

const selectedFile: IDirOrFile = {
  name: 'financial-plan.xlsx',
  relativePath: 'financial-plan.xlsx',
  fullPath: '/workspace/financial-plan.xlsx',
  isDir: false,
  isFile: true,
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getWorkspace: { invoke: vi.fn() },
    },
    application: {
      writeRendererLog: { invoke: mocks.writeRendererLogInvoke },
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
    useMessage: () => [{ error: vi.fn(), success: vi.fn(), info: vi.fn() }, null],
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

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    openPreview: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useWorkspaceCollapse', () => ({
  useWorkspaceCollapse: () => ({
    isWorkspaceCollapsed: workspaceTreeCollapsed,
    setIsWorkspaceCollapsed: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useWorkspaceTree', () => ({
  useWorkspaceTree: () => ({
    files: [{ name: 'workspace', relativePath: '', fullPath: '/workspace', isFile: false, children: [selectedFile] }],
    loading: false,
    treeKey: 1,
    expandedKeys: [],
    selected: [selectedFile.relativePath],
    selectedKeysRef: { current: [selectedFile.relativePath] },
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

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useWorkspaceFileOps', () => ({
  useWorkspaceFileOps: () => ({
    handlePreviewFile: mocks.handlePreviewFile,
    handleAddToChat: vi.fn(),
    handleDownloadFile: vi.fn(),
    handleOpenNode: vi.fn(),
    handleRevealNode: vi.fn(),
    handleRenameNode: vi.fn(),
    handleDeleteNode: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Workspace/hooks/useFileChanges', () => ({
  useFileChanges: () => ({
    staged: [],
    unstaged: [],
    loading: false,
    snapshotInfo: workspaceSnapshotInfo,
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

vi.mock('@/renderer/pages/conversation/Workspace/components/WorkspaceToolbar', () => ({
  default: () => <div data-testid='workspace-toolbar' />,
}));

vi.mock('@/renderer/pages/conversation/Workspace/components/WorkspaceTabBar', () => ({
  default: () => <div data-testid='workspace-tabbar' />,
}));

vi.mock('@/renderer/pages/conversation/Workspace/components/WorkspaceContextMenu', () => ({
  default: ({ visible, node }: { visible: boolean; node: IDirOrFile | null }) =>
    visible ? <div data-testid='workspace-context-menu'>{node?.name}</div> : null,
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

vi.mock('@/renderer/pages/conversation/Workspace/components/FileTypeIcon', () => ({
  default: () => <span data-testid='file-type-icon' />,
}));

describe('ChatWorkspace preview selection', () => {
  beforeEach(() => {
    titlebarProjectSlot = document.createElement('div');
    titlebarProjectSlot.id = 'app-titlebar-project-slot';
    document.body.append(titlebarProjectSlot);
    workspaceTreeCollapsed = false;
    workspaceSnapshotInfo = { branch: 'main' };
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    titlebarProjectSlot?.remove();
    titlebarProjectSlot = null;
  });

  it('opens an artifact from the titlebar Project Files flyout', () => {
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' />);

    const projectTrigger = screen.getByRole('button', { name: /conversation.workspace.projectMenu.trigger/ });
    expect(titlebarProjectSlot?.contains(projectTrigger)).toBe(true);

    fireEvent.click(projectTrigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /conversation.workspace.changes.filesTab/ }));
    fireEvent.click(screen.getByRole('button', { name: selectedFile.name }));

    expect(mocks.ensureNodeSelected).toHaveBeenCalledWith(selectedFile);
    expect(mocks.writeRendererLogInvoke).toHaveBeenCalledWith({
      level: 'debug',
      tag: 'Workspace',
      message: 'workspace_file_preview_requested',
      data: {
        fileName: selectedFile.name,
        wasSelected: true,
        hasKey: true,
      },
    });
    expect(mocks.handlePreviewFile).toHaveBeenCalledWith(selectedFile);
    expect(screen.queryByRole('menuitem', { name: /conversation.workspace.changes.filesTab/ })).not.toBeInTheDocument();
  });

  it('keeps existing file actions available from the Files flyout', () => {
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' />);

    fireEvent.click(screen.getByRole('button', { name: /conversation.workspace.projectMenu.trigger/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /conversation.workspace.changes.filesTab/ }));
    fireEvent.contextMenu(screen.getByRole('button', { name: selectedFile.name }), { clientX: 120, clientY: 80 });

    expect(mocks.setContextMenu).toHaveBeenCalledWith({
      visible: true,
      x: 120,
      y: 80,
      node: selectedFile,
    });
  });

  it('refreshes file changes when the Changes flyout opens', () => {
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' />);

    fireEvent.click(screen.getByRole('button', { name: /conversation.workspace.projectMenu.trigger/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /conversation.workspace.changes.tab/ }));

    expect(mocks.refreshChanges).toHaveBeenCalledTimes(1);
  });

  it('refreshes Changes after snapshot initialization finishes', () => {
    workspaceSnapshotInfo = null;
    const { rerender } = render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' />);

    fireEvent.click(screen.getByRole('button', { name: /conversation.workspace.projectMenu.trigger/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /conversation.workspace.changes.tab/ }));
    expect(mocks.refreshChanges).not.toHaveBeenCalled();

    workspaceSnapshotInfo = { branch: 'main' };
    rerender(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' />);

    expect(mocks.refreshChanges).toHaveBeenCalledTimes(1);
  });

  it('shows Changes even when the legacy tree-collapse preference is set', () => {
    workspaceTreeCollapsed = true;
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' />);

    fireEvent.click(screen.getByRole('button', { name: /conversation.workspace.projectMenu.trigger/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /conversation.workspace.changes.tab/ }));

    expect(screen.getByTestId('file-change-list')).toBeInTheDocument();
  });

  it('requests a workspace search for files beyond the loaded tree', () => {
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' />);

    fireEvent.click(screen.getByRole('button', { name: /conversation.workspace.projectMenu.trigger/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /conversation.workspace.changes.filesTab/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'nested.xlsx' } });

    expect(mocks.setSearchText).toHaveBeenCalledWith('nested.xlsx');
    expect(mocks.onSearch).toHaveBeenCalledWith('nested.xlsx');
  });
});
