/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import ChatWorkspace from '@/renderer/pages/conversation/Workspace';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  compactContext: vi.fn(),
  emit: vi.fn(),
  ensureNodeSelected: vi.fn(),
  getConversationOrNull: vi.fn(),
  handoffConversationContext: vi.fn(),
  handlePreviewFile: vi.fn(),
  onSearch: vi.fn(),
  refreshChanges: vi.fn(),
  setContextMenu: vi.fn(),
  setSearchText: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  navigate: vi.fn(),
  openPreview: vi.fn(),
  pinConversationContext: vi.fn(),
  readFile: vi.fn(),
  writeRendererLogInvoke: vi.fn(),
  useContextCompaction: vi.fn(() => ({ compact: mocks.compactContext, isCompacting: false })),
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

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getWorkspace: { invoke: vi.fn() },
    },
    fs: {
      readFile: { invoke: mocks.readFile },
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

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    openPreview: mocks.openPreview,
  }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: mocks.getConversationOrNull,
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: mocks.emit },
  useAddEventListener: vi.fn((event: string, listener: (payload: unknown) => void) => {
    mocks.listeners.set(event, listener);
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

vi.mock('@/renderer/pages/conversation/contextHandoff/ContextHandoffPanel', () => ({
  default: ({
    conversationId,
    onPreviewOpen,
    workspace,
  }: {
    conversationId: string;
    onPreviewOpen?: () => void;
    workspace: string;
  }) => (
    <div data-testid='context-handoff-panel'>
      {conversationId}:{workspace}
      <button onClick={onPreviewOpen}>open context preview</button>
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/contextHandoff/useContextCompaction', () => ({
  useContextCompaction: mocks.useContextCompaction,
  handoffConversationContext: mocks.handoffConversationContext,
  pinConversationContext: mocks.pinConversationContext,
}));

describe('ChatWorkspace preview selection', () => {
  beforeEach(() => {
    titlebarProjectSlot = document.createElement('div');
    titlebarProjectSlot.id = 'app-titlebar-project-slot';
    document.body.append(titlebarProjectSlot);
    workspaceTreeCollapsed = false;
    workspaceSnapshotInfo = { branch: 'main' };
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.compactContext.mockResolvedValue({
      fileName: 'Context.md',
      filePath: '/workspace/Context.md',
      markdown: '# Context',
      source: 'llm',
    });
    mocks.getConversationOrNull.mockResolvedValue(null);
    mocks.handoffConversationContext.mockResolvedValue({
      conversation: { id: 'conversation-2' },
      markdown: '# Context',
    });
    mocks.pinConversationContext.mockResolvedValue({ pin: { id: 'pin-1' }, compaction: null });
    mocks.readFile.mockResolvedValue('# Context');
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
    expect(document.querySelector('.chat-workspace .workspace-project-trigger')).toBeNull();

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
    // Single-click opens a persistent (pinned) tab so opening several files
    // accumulates several tabs, instead of replacing a single shared preview tab.
    expect(mocks.handlePreviewFile).toHaveBeenCalledWith(selectedFile, true);
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

  it('renders context management in the project panel for Aionrs workspaces', () => {
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' eventPrefix='aionrs' />);

    expect(mocks.useContextCompaction).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      workspace: '/workspace',
      enabled: true,
    });

    expect(screen.queryByTestId('context-handoff-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /conversation.workspace.projectMenu.trigger/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /conversation.contextHandoff.sectionTitle/ }));

    expect(screen.getByTestId('context-handoff-panel')).toHaveTextContent('conversation-1:/workspace');
  });

  it('dismisses the Project menu after Context.md opens in Preview', async () => {
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' eventPrefix='aionrs' />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /conversation.workspace.projectMenu.trigger/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /conversation.contextHandoff.sectionTitle/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'open context preview' }));
    });

    expect(
      screen.queryByRole('menuitem', { name: /conversation.contextHandoff.sectionTitle/ })
    ).not.toBeInTheDocument();
  });

  it('routes native context commands through the always-mounted context controller', async () => {
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' eventPrefix='aionrs' />);

    const listener = mocks.listeners.get('aionrs.context-command');
    expect(listener).toBeDefined();

    await act(async () => {
      listener?.({ conversationId: 'conversation-1', command: { action: 'compact' } });
    });

    await waitFor(() => expect(mocks.compactContext).toHaveBeenCalledWith('manual'));
  });

  it('ignores context commands intended for another conversation', async () => {
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' eventPrefix='aionrs' />);

    await act(async () => {
      mocks.listeners.get('aionrs.context-command')?.({
        conversationId: 'conversation-2',
        command: { action: 'compact' },
      });
    });

    expect(mocks.compactContext).not.toHaveBeenCalled();
  });

  it('opens an existing Context.md in the editable Preview surface', async () => {
    mocks.getConversationOrNull.mockResolvedValue({
      id: 'conversation-1',
      type: 'aionrs',
      extra: {
        workspace: '/workspace',
        context_handoff: {
          context_file_path: '/workspace/Context.md',
          context_file_name: 'Context.md',
        },
      },
    });
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' eventPrefix='aionrs' />);

    await act(async () => {
      mocks.listeners.get('aionrs.context-command')?.({
        conversationId: 'conversation-1',
        command: { action: 'open' },
      });
    });

    await waitFor(() =>
      expect(mocks.openPreview).toHaveBeenCalledWith(
        '# Context',
        'markdown',
        expect.objectContaining({
          editable: true,
          file_name: 'Context.md',
          file_path: '/workspace/Context.md',
        })
      )
    );
    expect(mocks.compactContext).not.toHaveBeenCalled();
  });

  it('routes pin commands through protected pin persistence and compaction', async () => {
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' eventPrefix='aionrs' />);

    await act(async () => {
      mocks.listeners.get('aionrs.context-command')?.({
        conversationId: 'conversation-1',
        command: { action: 'pin', text: 'Keep the UI compact.' },
      });
    });

    await waitFor(() =>
      expect(mocks.pinConversationContext).toHaveBeenCalledWith(
        {
          conversationId: 'conversation-1',
          workspace: '/workspace',
          text: 'Keep the UI compact.',
        },
        expect.objectContaining({ compactContext: expect.any(Function) })
      )
    );
    expect(mocks.messageSuccess).toHaveBeenCalledWith('conversation.contextHandoff.command.pinSuccess');
  });

  it('deduplicates handoff commands and navigates only after creation succeeds', async () => {
    let resolveHandoff: ((value: { conversation: { id: string }; markdown: string }) => void) | undefined;
    mocks.handoffConversationContext.mockReturnValue(
      new Promise((resolve) => {
        resolveHandoff = resolve;
      })
    );
    render(<ChatWorkspace conversation_id='conversation-1' workspace='/workspace' eventPrefix='aionrs' />);
    const listener = mocks.listeners.get('aionrs.context-command');
    const payload = { conversationId: 'conversation-1', command: { action: 'handoff' as const } };

    act(() => {
      listener?.(payload);
      listener?.(payload);
    });

    expect(mocks.handoffConversationContext).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      resolveHandoff?.({ conversation: { id: 'conversation-2' }, markdown: '# Context' });
      await Promise.resolve();
    });

    expect(mocks.emit).toHaveBeenCalledWith('chat.history.refresh');
    expect(mocks.navigate).toHaveBeenCalledWith('/conversation/conversation-2');
  });
});
