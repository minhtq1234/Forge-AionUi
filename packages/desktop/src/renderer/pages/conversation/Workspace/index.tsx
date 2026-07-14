/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useAbortUploadsOnConversationChange } from '@/renderer/hooks/file/useAbortUploadsOnConversationChange';
import ContextHandoffPanel from '@/renderer/pages/conversation/contextHandoff/ContextHandoffPanel';
import { resolveContextFile } from '@/renderer/pages/conversation/contextHandoff/contextFile';
import { getConversationContextHandoffExtra } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
import {
  handoffConversationContext,
  pinConversationContext,
  useContextCompaction,
} from '@/renderer/pages/conversation/contextHandoff/useContextCompaction';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { getWorkspaceDisplayName as getDisplayName } from '@/renderer/utils/workspace/workspace';
import { Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import FileChangeList from './components/FileChangeList';
import PasteConfirmModal from './components/PasteConfirmModal';
import WorkspaceContextMenu from './components/WorkspaceContextMenu';
import WorkspaceDialogs from './components/WorkspaceDialogs';
import WorkspaceProjectFilesFlyout from './components/WorkspaceProjectFilesFlyout';
import WorkspaceProjectMenu from './components/WorkspaceProjectMenu';
import { useFileChanges } from './hooks/useFileChanges';
import { useWorkspaceDragImport } from './hooks/useWorkspaceDragImport';
import { useWorkspaceEvents } from './hooks/useWorkspaceEvents';
import { useWorkspaceFileOps } from './hooks/useWorkspaceFileOps';
import { useWorkspaceModals } from './hooks/useWorkspaceModals';
import { useWorkspacePaste } from './hooks/useWorkspacePaste';
import { useWorkspaceSearch } from './hooks/useWorkspaceSearch';
import { useWorkspaceTree } from './hooks/useWorkspaceTree';
import type { WorkspaceProps, WorkspaceTab } from './types';
import { computeContextMenuPosition, flattenSingleRoot, getTargetFolderPath } from './utils/treeHelpers';
import './workspace.css';

const formatProjectContextBudgetLabel = (ratio: number | null): string => {
  if (ratio === null) return '--';
  const percent = ratio * 100;
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
};

const getProjectContextBudgetLabel = (conversation: TChatConversation | null): string => {
  if (!conversation || !('last_token_usage' in conversation.extra) || !('last_context_limit' in conversation.extra)) {
    return '--';
  }
  const totalTokens = conversation.extra.last_token_usage?.total_tokens;
  const contextLimit = conversation.extra.last_context_limit;
  if (typeof totalTokens !== 'number' || totalTokens <= 0 || typeof contextLimit !== 'number' || contextLimit <= 0) {
    return '--';
  }
  return formatProjectContextBudgetLabel(totalTokens / contextLimit);
};

const ChatWorkspace: React.FC<WorkspaceProps> = ({
  conversation_id,
  workspace,
  isTemporaryWorkspace: isTemporaryWorkspaceProp,
  eventPrefix = 'acp',
  messageApi: externalMessageApi,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openPreview } = usePreviewContext();
  const conversationContext = useConversationContextSafe();
  const loadedSkills = conversationContext?.loadedSkills ?? [];
  const loadedMcpStatuses =
    conversationContext?.loadedMcpStatuses ??
    (conversationContext?.loadedMcpServers ?? []).map((name) => ({
      id: name,
      name,
      status: 'loaded' as const,
    }));
  const showContextSection = eventPrefix === 'aionrs';
  const contextCompaction = useContextCompaction({
    conversationId: conversation_id,
    workspace,
    enabled: showContextSection,
  });
  const contextCommandInFlightRef = useRef(false);

  // Message API setup
  const [internalMessageApi, messageContext] = Message.useMessage();
  const messageApi = externalMessageApi ?? internalMessageApi;
  const shouldRenderLocalMessageContext = !externalMessageApi;

  // Project menu state and file changes
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [activeProjectPanel, setActiveProjectPanel] = useState<WorkspaceTab | null>(null);
  const [projectMenuSlot, setProjectMenuSlot] = useState<HTMLElement | null>(null);
  const [contextBudgetLabel, setContextBudgetLabel] = useState('--');
  const fileChangesHook = useFileChanges({ workspace });

  // Bind workspace uploads to the conversation lifecycle: switching the
  // workspace conversation or unmounting the panel cancels in-flight uploads.
  useAbortUploadsOnConversationChange(conversation_id, 'workspace');

  // Initialize all hooks
  const treeHook = useWorkspaceTree({ workspace, conversation_id, eventPrefix });
  const modalsHook = useWorkspaceModals();
  const pasteHook = useWorkspacePaste({
    conversation_id: conversation_id,
    workspace,
    messageApi,
    t,
    files: treeHook.files,
    selected: treeHook.selected,
    selectedNodeRef: treeHook.selectedNodeRef,
    refreshWorkspace: treeHook.refreshWorkspace,
    pasteConfirm: modalsHook.pasteConfirm,
    setPasteConfirm: modalsHook.setPasteConfirm,
    closePasteConfirm: modalsHook.closePasteConfirm,
  });

  const dragImportHook = useWorkspaceDragImport({
    messageApi,
    t,
    onFilesDropped: pasteHook.handleFilesToAdd,
    conversation_id: conversation_id,
  });

  const searchHook = useWorkspaceSearch({ workspace, loadWorkspace: treeHook.loadWorkspace });

  const fileOpsHook = useWorkspaceFileOps({
    workspace,
    eventPrefix,
    messageApi,
    t,
    setSelected: treeHook.setSelected,
    selectedKeysRef: treeHook.selectedKeysRef,
    selectedNodeRef: treeHook.selectedNodeRef,
    ensureNodeSelected: treeHook.ensureNodeSelected,
    refreshWorkspace: treeHook.refreshWorkspace,
    renameModal: modalsHook.renameModal,
    deleteModal: modalsHook.deleteModal,
    renameLoading: modalsHook.renameLoading,
    setRenameLoading: modalsHook.setRenameLoading,
    closeRenameModal: modalsHook.closeRenameModal,
    closeDeleteModal: modalsHook.closeDeleteModal,
    closeContextMenu: modalsHook.closeContextMenu,
    setRenameModal: modalsHook.setRenameModal,
    setDeleteModal: modalsHook.setDeleteModal,
    openPreview,
  });

  // Setup events
  useWorkspaceEvents({
    conversation_id,
    eventPrefix,
    refreshWorkspace: treeHook.refreshWorkspace,
    clearSelection: treeHook.clearSelection,
    setFiles: treeHook.setFiles,
    setSelected: treeHook.setSelected,
    setExpandedKeys: treeHook.setExpandedKeys,
    setTreeKey: treeHook.setTreeKey,
    selectedNodeRef: treeHook.selectedNodeRef,
    selectedKeysRef: treeHook.selectedKeysRef,
    closeContextMenu: modalsHook.closeContextMenu,
    setContextMenu: modalsHook.setContextMenu,
    closeRenameModal: modalsHook.closeRenameModal,
    closeDeleteModal: modalsHook.closeDeleteModal,
  });

  // Hide the transport root when it has one visible workspace child.
  const treeData = flattenSingleRoot(treeHook.files);

  // Authoritative source: `conversation.extra.is_temporary_workspace` is
  // derived by the backend on every response (see
  // aionui-conversation::convert::row_to_response). We never inspect the
  // directory path shape — the backend's temp-workspace layout is not a
  // public contract. Default to false when the prop is unavailable (e.g.
  // tests that render the panel outside a conversation).
  const isTemporaryWorkspace = isTemporaryWorkspaceProp ?? false;
  const isChangesPanelActive = projectMenuOpen && activeProjectPanel === 'changes';

  // Get workspace display name using shared utility
  const workspaceDisplayName = useMemo(
    () => getDisplayName(workspace, isTemporaryWorkspace, t),
    [workspace, isTemporaryWorkspace, t]
  );

  let contextMenuStyle: React.CSSProperties | undefined;
  if (modalsHook.contextMenu.visible) {
    contextMenuStyle = computeContextMenuPosition(modalsHook.contextMenu.x, modalsHook.contextMenu.y);
  }

  const openNodeContextMenu = useCallback(
    (node: IDirOrFile, x: number, y: number) => {
      treeHook.ensureNodeSelected(node);
      modalsHook.setContextMenu({ visible: true, x, y, node });
    },
    [modalsHook.setContextMenu, treeHook.ensureNodeSelected]
  );

  const handleOpenChangeDiff = useCallback(
    (diffContent: string, file_name: string, file_path: string) => {
      openPreview(diffContent, 'diff', {
        file_name,
        file_path,
        workspace,
      });
    },
    [openPreview, workspace]
  );

  const handleProjectMenuToggle = useCallback(() => {
    setProjectMenuOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        setActiveProjectPanel(null);
      }
      return nextOpen;
    });
  }, []);

  const handleProjectPanelSelect = useCallback((panel: WorkspaceTab) => {
    setProjectMenuOpen(true);
    setActiveProjectPanel((current) => (current === panel ? null : panel));
  }, []);

  const handleProjectMenuClose = useCallback(() => {
    setProjectMenuOpen(false);
    setActiveProjectPanel(null);
  }, []);

  // Auto-refresh changes when opening the Changes flyout.
  useEffect(() => {
    if (isChangesPanelActive && fileChangesHook.snapshotInfo) {
      fileChangesHook.refreshChanges();
    }
  }, [isChangesPanelActive, fileChangesHook.refreshChanges, fileChangesHook.snapshotInfo]);

  useEffect(() => {
    if (!showContextSection && activeProjectPanel === 'context') {
      setActiveProjectPanel(null);
    }
  }, [activeProjectPanel, showContextSection]);

  const refreshProjectContextBudget = useCallback(async () => {
    if (!showContextSection) {
      setContextBudgetLabel('--');
      return;
    }
    try {
      setContextBudgetLabel(getProjectContextBudgetLabel(await getConversationOrNull(conversation_id)));
    } catch (error) {
      console.error('[Workspace] Failed to load project context budget:', error);
      setContextBudgetLabel('--');
    }
  }, [conversation_id, showContextSection]);

  useEffect(() => {
    void refreshProjectContextBudget();
  }, [refreshProjectContextBudget]);

  useAddEventListener(
    'aionrs.context-usage.refresh',
    (updatedConversationId) => {
      if (updatedConversationId === conversation_id) {
        void refreshProjectContextBudget();
      }
    },
    [conversation_id, refreshProjectContextBudget]
  );

  const compactFromContextAction = useCallback(
    (input: Parameters<typeof contextCompaction.compact>) => contextCompaction.compact(input[0], input[1], input[2]),
    [contextCompaction]
  );

  const openContextFromCommand = useCallback(async () => {
    const conversation = await getConversationOrNull(conversation_id);
    if (conversation?.type !== 'aionrs') return;

    const contextState = getConversationContextHandoffExtra(conversation);
    const resolved = resolveContextFile(workspace);
    let filePath = contextState.context_file_path || resolved.filePath;
    let fileName = contextState.context_file_name || resolved.fileName;
    let markdown = contextState.context_file_path
      ? await ipcBridge.fs.readFile.invoke({ path: filePath, workspace })
      : null;

    if (markdown === null) {
      const compacted = await contextCompaction.compact('manual');
      if (!compacted) return;
      filePath = compacted.filePath;
      fileName = compacted.fileName;
      markdown = compacted.markdown;
    }

    openPreview(markdown, 'markdown', {
      title: fileName,
      file_name: fileName,
      file_path: filePath,
      workspace,
      editable: true,
    });
  }, [contextCompaction, conversation_id, openPreview, workspace]);

  useAddEventListener(
    'aionrs.context-command',
    ({ conversationId, command }) => {
      if (!showContextSection || conversationId !== conversation_id || contextCommandInFlightRef.current) return;
      contextCommandInFlightRef.current = true;

      void (async () => {
        if (command.action === 'open') {
          await openContextFromCommand();
          return;
        }
        if (command.action === 'compact') {
          const result = await contextCompaction.compact('manual');
          if (result?.source === 'rules') {
            messageApi.warning?.(t('conversation.contextHandoff.command.fallbackComplete'));
          } else if (result) {
            messageApi.success(t('conversation.contextHandoff.command.compactSuccess'));
          }
          return;
        }
        if (command.action === 'pin') {
          await pinConversationContext(
            { conversationId, workspace, text: command.text },
            {
              compactContext: ({ trigger, targetTurnId, budgetStatus }) =>
                compactFromContextAction([trigger, targetTurnId, budgetStatus]),
            }
          );
          messageApi.success(t('conversation.contextHandoff.command.pinSuccess'));
          return;
        }

        const result = await handoffConversationContext(
          { conversationId, workspace },
          {
            compactContext: ({ trigger, targetTurnId, budgetStatus }) =>
              compactFromContextAction([trigger, targetTurnId, budgetStatus]),
          }
        );
        emitter.emit('chat.history.refresh');
        void navigate(`/conversation/${result.conversation.id}`);
      })()
        .catch((error) => {
          console.error('[ContextHandoff] Context command failed:', error);
          messageApi.error(t('conversation.contextHandoff.command.failed'));
        })
        .finally(() => {
          contextCommandInFlightRef.current = false;
        });
    },
    [
      compactFromContextAction,
      contextCompaction,
      conversation_id,
      messageApi,
      navigate,
      openContextFromCommand,
      showContextSection,
      t,
      workspace,
    ]
  );

  useEffect(() => {
    const findSlot = () => document.getElementById('app-titlebar-project-slot');
    setProjectMenuSlot(findSlot());

    const observer = new MutationObserver(() => {
      const nextSlot = findSlot();
      setProjectMenuSlot((current) => (current === nextSlot ? current : nextSlot));
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  const handleProjectFilesToggleFolder = useCallback(
    (node: IDirOrFile) => {
      const nodeKey = node.relativePath;
      const isExpanded = treeHook.expandedKeys.includes(nodeKey);
      treeHook.setExpandedKeys((current) =>
        current.includes(nodeKey) ? current.filter((key) => key !== nodeKey) : [...current, nodeKey]
      );

      if (isExpanded || node.children !== undefined) return;

      void ipcBridge.conversation.getWorkspace
        .invoke({ conversation_id, workspace, path: node.fullPath })
        .then((res) => {
          const newChildren = res[0]?.children;
          if (!newChildren) return;
          treeHook.setFiles((current) => {
            const assignChildren = (nodes: IDirOrFile[]): IDirOrFile[] =>
              nodes.map((candidate) => {
                if (candidate.relativePath === nodeKey) return { ...candidate, children: newChildren };
                if (candidate.children) return { ...candidate, children: assignChildren(candidate.children) };
                return candidate;
              });
            return assignChildren(current);
          });
        })
        .catch((error) => {
          console.error('[Workspace] Project files folder load failed:', error);
        });
    },
    [conversation_id, treeHook.expandedKeys, treeHook.setExpandedKeys, treeHook.setFiles, workspace]
  );

  // 单击文件树中的文件：以固定（常驻）tab 打开，多个文件可同时累积多个 tab
  // Clicking a file in the tree opens it as a pinned (persistent) tab — opening
  // several files accumulates several tabs rather than replacing a single shared
  // provisional slot. The provisional/italic preview slot is reserved for
  // transient chat file-links (see useLocalFilePreview, which still passes
  // `{ preview: true }`).
  const handleProjectFileOpen = useCallback(
    (node: IDirOrFile) => {
      const wasSelected = treeHook.selectedKeysRef.current.includes(node.relativePath);
      treeHook.ensureNodeSelected(node);
      void ipcBridge.application?.writeRendererLog.invoke({
        level: 'debug',
        tag: 'Workspace',
        message: 'workspace_file_preview_requested',
        data: {
          fileName: node.name,
          wasSelected,
          hasKey: Boolean(node.relativePath),
        },
      });
      void fileOpsHook.handlePreviewFile(node, true);
      handleProjectMenuClose();
    },
    [fileOpsHook.handlePreviewFile, handleProjectMenuClose, treeHook.ensureNodeSelected, treeHook.selectedKeysRef]
  );

  const handleProjectFileContextMenu = useCallback(
    (node: IDirOrFile, x: number, y: number) => {
      openNodeContextMenu(node, x, y);
    },
    [openNodeContextMenu]
  );

  const handleProjectSearchChange = useCallback(
    (value: string) => {
      searchHook.setSearchText(value);
      searchHook.onSearch(value);
    },
    [searchHook.onSearch, searchHook.setSearchText]
  );

  // Get target folder path for paste confirm modal
  const targetFolderPathForModal = getTargetFolderPath(
    treeHook.selectedNodeRef.current,
    treeHook.selected,
    treeHook.files,
    workspace
  );

  const filesPanel = (
    <WorkspaceProjectFilesFlyout
      t={t}
      workspaceDisplayName={workspaceDisplayName}
      files={treeData}
      expandedKeys={treeHook.expandedKeys}
      onToggleFolder={handleProjectFilesToggleFolder}
      onOpenFile={handleProjectFileOpen}
      onOpenContextMenu={handleProjectFileContextMenu}
      searchText={searchHook.searchText}
      onSearchTextChange={handleProjectSearchChange}
    />
  );

  const changesPanel = isChangesPanelActive ? (
    <div className='workspace-section-scroll'>
      <FileChangeList
        t={t}
        workspace={workspace}
        staged={fileChangesHook.staged}
        unstaged={fileChangesHook.unstaged}
        loading={fileChangesHook.loading}
        snapshotInfo={fileChangesHook.snapshotInfo}
        onRefresh={fileChangesHook.refreshChanges}
        onOpenDiff={handleOpenChangeDiff}
        onStageFile={fileChangesHook.stageFile}
        onStageAll={fileChangesHook.stageAll}
        onUnstageFile={fileChangesHook.unstageFile}
        onUnstageAll={fileChangesHook.unstageAll}
        onDiscardFile={fileChangesHook.discardFile}
        onResetFile={fileChangesHook.resetFile}
      />
    </div>
  ) : null;

  const contextPanel = showContextSection ? (
    <ContextHandoffPanel
      conversationId={conversation_id}
      workspace={workspace}
      loadedSkills={loadedSkills}
      loadedMcpStatuses={loadedMcpStatuses}
      onCreateContext={() => contextCompaction.compact('manual')}
      onPreviewOpen={handleProjectMenuClose}
      isCompacting={contextCompaction.isCompacting}
    />
  ) : undefined;

  const projectMenu = (
    <WorkspaceProjectMenu
      t={t}
      open={projectMenuOpen}
      activePanel={activeProjectPanel}
      changeCount={fileChangesHook.changeCount}
      contextBudgetLabel={contextBudgetLabel}
      showContext={showContextSection}
      onToggle={handleProjectMenuToggle}
      onSelectPanel={handleProjectPanelSelect}
      filesPanel={filesPanel}
      changesPanel={changesPanel}
      contextPanel={contextPanel}
    />
  );

  return (
    <>
      {shouldRenderLocalMessageContext && messageContext}
      <div
        className='chat-workspace size-full flex flex-col relative'
        tabIndex={0}
        onFocus={pasteHook.onFocusPaste}
        onClick={pasteHook.onFocusPaste}
        {...dragImportHook.dragHandlers}
        style={
          dragImportHook.isDragging
            ? {
                border: '1px dashed rgb(var(--primary-6))',
                borderRadius: '18px',
                backgroundColor: 'rgba(var(--primary-1), 0.25)',
                transition: 'all 0.2s ease',
              }
            : undefined
        }
      >
        {dragImportHook.isDragging && (
          <div className='absolute inset-0 pointer-events-none z-30 flex items-center justify-center px-32px'>
            <div
              className='w-full max-w-480px text-center text-white rounded-16px px-32px py-28px'
              style={{
                background: 'rgba(6, 11, 25, 0.85)',
                border: '1px dashed rgb(var(--primary-6))',
                boxShadow: '0 20px 60px rgba(15, 23, 42, 0.45)',
              }}
            >
              <div className='text-18px font-semibold mb-8px'>
                {t('conversation.workspace.dragOverlayTitle', {
                  defaultValue: 'Drop to import',
                })}
              </div>
              <div className='text-14px opacity-90 mb-4px'>
                {t('conversation.workspace.dragOverlayDesc', {
                  defaultValue: 'Drag files or folders here to copy them into this workspace.',
                })}
              </div>
              <div className='text-12px opacity-70'>
                {t('conversation.workspace.dragOverlayHint', {
                  defaultValue: 'Tip: drop anywhere to import into the selected folder.',
                })}
              </div>
            </div>
          </div>
        )}

        {/* Paste Confirm Modal */}
        <PasteConfirmModal
          pasteConfirm={modalsHook.pasteConfirm}
          setPasteConfirm={modalsHook.setPasteConfirm}
          closePasteConfirm={modalsHook.closePasteConfirm}
          handlePasteConfirm={pasteHook.handlePasteConfirm}
          targetFolderPath={targetFolderPathForModal}
          t={t}
        />

        {/* Rename + Delete Modals */}
        <WorkspaceDialogs
          t={t}
          renameModal={modalsHook.renameModal}
          setRenameModal={modalsHook.setRenameModal}
          closeRenameModal={modalsHook.closeRenameModal}
          handleRenameConfirm={fileOpsHook.handleRenameConfirm}
          renameLoading={modalsHook.renameLoading}
          deleteModal={modalsHook.deleteModal}
          closeDeleteModal={modalsHook.closeDeleteModal}
          handleDeleteConfirm={fileOpsHook.handleDeleteConfirm}
        />

        <WorkspaceContextMenu
          visible={modalsHook.contextMenu.visible}
          style={contextMenuStyle}
          node={modalsHook.contextMenu.node}
          t={t}
          handleAddToChat={fileOpsHook.handleAddToChat}
          handleOpenNode={fileOpsHook.handleOpenNode}
          handleRevealNode={fileOpsHook.handleRevealNode}
          handlePreviewFile={fileOpsHook.handlePreviewFile}
          handleDownloadFile={fileOpsHook.handleDownloadFile}
          handleDeleteNode={fileOpsHook.handleDeleteNode}
          openRenameModal={fileOpsHook.openRenameModal}
          closeContextMenu={modalsHook.closeContextMenu}
        />

        {projectMenuSlot ? createPortal(projectMenu, projectMenuSlot) : projectMenu}
      </div>
    </>
  );
};

export default ChatWorkspace;
