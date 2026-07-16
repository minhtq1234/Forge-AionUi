/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import AionModal from '@/renderer/components/base/AionModal';
import DirectorySelectionModal from '@/renderer/components/settings/DirectorySelectionModal';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useCronJobsMap } from '@/renderer/pages/cron';
import { ProjectCreateModal } from '@/renderer/pages/conversation/projects/ProjectCreateModal';
import { buildProjectSidebarGroups } from '@/renderer/pages/conversation/projects/projectGrouping';
import { createProject, updateProject } from '@/renderer/pages/conversation/projects/projectStorage';
import { useProjects } from '@/renderer/pages/conversation/projects/useProjects';
import { emitter } from '@/renderer/utils/emitter';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Dropdown, Empty, Input, Menu, Message, Modal, Tooltip } from '@arco-design/web-react';
import { Delete, FolderOpen, MoreOne, Plus, Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import WorkspaceCollapse from '../components/WorkspaceCollapse';
import ConversationRow from './ConversationRow';
import DragOverlayContent from './DragOverlayContent';
import SortableConversationRow from './SortableConversationRow';
import { useBatchSelection } from './hooks/useBatchSelection';
import { useConversationActions } from './hooks/useConversationActions';
import { useConversations } from './hooks/useConversations';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useExport } from './hooks/useExport';
import type { ConversationRowProps, WorkspaceGroupedHistoryProps } from './types';

const WorkspaceGroupedHistory: React.FC<WorkspaceGroupedHistoryProps> = ({
  onSessionClick,
  collapsed = false,
  tooltipEnabled = false,
  batchMode = false,
  onBatchModeChange,
  onNewChat,
  afterPinnedContent,
}) => {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { getJobStatus, markAsRead, setActiveConversation } = useCronJobsMap();
  const { projects, refreshProjects } = useProjects();
  const [projectCreateVisible, setProjectCreateVisible] = React.useState(false);
  const [projectCreateInitialWorkspace, setProjectCreateInitialWorkspace] = React.useState<string | undefined>();

  const {
    conversations,
    isConversationGenerating,
    getRecentCompletionAt,
    expandedWorkspaces,
    pinnedConversations,
    timelineSections,
    handleToggleWorkspace,
    collapsedSections,
    toggleSection,
  } = useConversations();

  const SectionLabel = useCallback(
    ({ sectionKey, label, trailing }: { sectionKey: string; label: string; trailing?: React.ReactNode }) => {
      const isCollapsed = collapsedSections.has(sectionKey);
      return (
        <div
          className='group/label sider-section-label flex items-center pl-4px pr-12px h-28px select-none sticky top-0 z-10 mt-8px cursor-pointer'
          onClick={() => toggleSection(sectionKey)}
        >
          <span className='text-15px text-t-primary sider-section-title group-hover/label:text-primary transition-colors font-700 leading-none'>
            {label}
          </span>
          <span className='ml-2px flex items-center justify-center opacity-0 group-hover/label:opacity-100 transition-opacity text-t-tertiary shrink-0'>
            <Right
              theme='outline'
              size={12}
              className={classNames('transition-transform duration-150', { 'rotate-90': !isCollapsed })}
            />
          </span>
          {trailing && (
            <div className='ml-auto' onClick={(e) => e.stopPropagation()}>
              {trailing}
            </div>
          )}
        </div>
      );
    },
    [collapsedSections, toggleSection]
  );

  // Sync active conversation ref when route changes (for URL navigation)
  // This doesn't trigger state update, avoiding double render
  useEffect(() => {
    if (id) {
      setActiveConversation(id);
    }
  }, [id, setActiveConversation]);

  const {
    selectedConversationIds,
    setSelectedConversationIds,
    selectedCount,
    allSelected,
    toggleSelectedConversation,
    handleToggleSelectAll,
  } = useBatchSelection(batchMode, conversations);

  const {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleDeleteClick,
    handleBatchDelete,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
    handleRemoveProject,
    removeProjectTarget,
    removeProjectLoading,
    handleRemoveProjectCancel,
    handleRemoveProjectConfirm,
  } = useConversationActions({
    batchMode,
    onSessionClick,
    onBatchModeChange,
    selectedConversationIds,
    setSelectedConversationIds,
    toggleSelectedConversation,
    markAsRead,
  });

  const {
    exportTask,
    exportModalVisible,
    exportTargetPath,
    exportModalLoading,
    showExportDirectorySelector,
    setShowExportDirectorySelector,
    closeExportModal,
    handleSelectExportDirectoryFromModal,
    handleSelectExportFolder,
    // handleExportConversation / handleBatchExport are intentionally not
    // destructured: their UI entries are disabled (kanban #14). The useExport
    // hook and its underlying logic stay intact for a future re-enable.
    handleConfirmExport,
  } = useExport({
    conversations,
    selectedConversationIds,
    setSelectedConversationIds,
    onBatchModeChange,
  });

  const { sensors, activeId, activeConversation, handleDragStart, handleDragEnd, handleDragCancel, isDragEnabled } =
    useDragAndDrop({
      pinnedConversations,
      batchMode,
      collapsed,
    });

  const conversationSectionActions = !collapsed ? (
    onNewChat ? (
      <Tooltip content={t('conversation.welcome.newConversation')} position='top'>
        <Button
          aria-label={t('conversation.welcome.newConversation')}
          className='sider-section-add-action !w-22px !h-22px !p-0 !rounded-6px !text-t-secondary hover:!text-t-primary hover:!bg-fill-3'
          size='mini'
          type='text'
          icon={<Plus theme='outline' size='14' fill='currentColor' className='block leading-none' />}
          onClick={(event) => {
            event.stopPropagation();
            onNewChat();
          }}
        />
      </Tooltip>
    ) : null
  ) : null;

  const projectSectionActions = !collapsed ? (
    <Tooltip content={t('conversation.history.newProject')} position='top'>
      <Button
        aria-label={t('conversation.history.newProject')}
        className='sider-section-add-action !w-22px !h-22px !p-0 !rounded-6px !text-t-secondary hover:!text-t-primary hover:!bg-fill-3'
        size='mini'
        type='text'
        icon={<Plus theme='outline' size='14' fill='currentColor' className='block leading-none' />}
        onClick={(event) => {
          event.stopPropagation();
          setProjectCreateInitialWorkspace(undefined);
          setProjectCreateVisible(true);
        }}
      />
    </Tooltip>
  ) : null;

  const getConversationRowProps = useCallback(
    (conversation: TChatConversation): ConversationRowProps => ({
      conversation,
      isGenerating: isConversationGenerating(conversation.id),
      recentCompletionAt: getRecentCompletionAt(conversation.id),
      collapsed,
      tooltipEnabled,
      batchMode,
      checked: selectedConversationIds.has(conversation.id),
      selected: id === conversation.id,
      menuVisible: dropdownVisibleId !== null && dropdownVisibleId === conversation.id,
      onToggleChecked: toggleSelectedConversation,
      onConversationClick: handleConversationClick,
      onOpenMenu: handleOpenMenu,
      onMenuVisibleChange: handleMenuVisibleChange,
      onEditStart: handleEditStart,
      onDelete: handleDeleteClick,
      // Export UI entry intentionally disabled (kanban #14): omit onExport so
      // ConversationRow's `{onExport && ...}` guard hides the menu item. The
      // underlying handleExportConversation logic from useExport is kept for a
      // future per-platform re-enable.
      onTogglePin: handleTogglePin,
      getJobStatus,
    }),
    [
      collapsed,
      tooltipEnabled,
      batchMode,
      isConversationGenerating,
      getRecentCompletionAt,
      selectedConversationIds,
      id,
      dropdownVisibleId,
      toggleSelectedConversation,
      handleConversationClick,
      handleOpenMenu,
      handleMenuVisibleChange,
      handleEditStart,
      handleDeleteClick,
      handleTogglePin,
      getJobStatus,
    ]
  );

  const renderConversation = (conversation: TChatConversation, dimIcon = false) => {
    const rowProps = getConversationRowProps(conversation);
    return <ConversationRow key={conversation.id} {...rowProps} dimIcon={dimIcon} />;
  };

  // Collect all sortable IDs for the pinned section
  const pinnedIds = useMemo(() => pinnedConversations.map((c) => c.id), [pinnedConversations]);

  const projectGroups = useMemo(
    () => buildProjectSidebarGroups(projects, timelineSections),
    [projects, timelineSections]
  );

  const navigateToProjectChat = useCallback(
    (workspace: string, projectId?: string) => {
      void navigate('/guid', { state: { workspace, projectId } });
    },
    [navigate]
  );

  const handleRenameProject = useCallback(
    (projectId: string, currentName: string) => {
      let nextName = currentName;
      Modal.confirm({
        title: t('conversation.history.renameProject'),
        content: (
          <Input
            autoFocus
            defaultValue={currentName}
            placeholder={t('conversation.history.projectNamePlaceholder')}
            onChange={(value) => {
              nextName = value;
            }}
          />
        ),
        okText: t('conversation.history.saveName'),
        cancelText: t('conversation.history.cancelEdit'),
        onOk: () => {
          const trimmedName = nextName.trim();
          if (!trimmedName) {
            return;
          }
          updateProject({ id: projectId, name: trimmedName });
          refreshProjects();
        },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [refreshProjects, t]
  );

  const handleRelinkProject = useCallback(
    async (projectId: string, workspace: string) => {
      const result = await ipcBridge.dialog.showOpen.invoke({
        defaultPath: workspace,
        properties: ['openDirectory', 'createDirectory'],
      });
      const selectedFolder = result?.[0];
      if (!selectedFolder) {
        return;
      }
      try {
        updateProject({ id: projectId, workspace: selectedFolder });
        refreshProjects();
      } catch (error) {
        console.error('Failed to relink project:', error);
        Message.error(t('conversation.history.createProjectFailed'));
      }
    },
    [refreshProjects, t]
  );

  const handleSaveWorkspaceAsProject = useCallback(
    async (displayName: string, workspace: string, groupConversations: TChatConversation[]) => {
      try {
        const project = createProject({ name: displayName, workspace });
        await Promise.all(
          groupConversations.map((conversation) =>
            ipcBridge.conversation.update.invoke({
              id: conversation.id,
              updates: {
                extra: {
                  ...conversation.extra,
                  project_id: project.id,
                  workspace,
                  custom_workspace: true,
                },
              } as Partial<TChatConversation>,
              merge_extra: false,
            })
          )
        );
        refreshProjects();
        emitter.emit('chat.history.refresh');
      } catch (error) {
        console.error('Failed to save workspace as project:', error);
        Message.error(t('conversation.history.createProjectFailed'));
      }
    },
    [refreshProjects]
  );

  // Conversations section: keep timeline grouping (today/yesterday/...) but only show non-workspace conversations.
  const conversationOnlySections = useMemo(
    () =>
      timelineSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => item.type === 'conversation' && item.conversation),
        }))
        .filter((section) => section.items.length > 0),
    [timelineSections]
  );

  const batchSelectionPanel =
    batchMode && !collapsed ? (
      <div className='px-12px pb-8px pt-2px sticky top-28px z-20 bg-[var(--bg-2)]'>
        <div className='rd-8px bg-fill-1 p-10px flex flex-col gap-8px border border-solid border-[rgba(var(--primary-6),0.08)]'>
          <div className='text-12px leading-18px text-t-secondary'>
            {t('conversation.history.selectedCount', { count: selectedCount })}
          </div>
          {/* Batch export UI entry intentionally disabled (kanban #14): the
              button is removed so select-all + delete share the two columns.
              handleBatchExport from useExport is kept for a future re-enable. */}
          <div className='grid grid-cols-2 gap-6px'>
            <Button
              className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
              size='mini'
              type='secondary'
              onClick={handleToggleSelectAll}
            >
              {allSelected ? t('common.cancel') : t('conversation.history.selectAll')}
            </Button>
            <Button
              className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
              size='mini'
              status='warning'
              onClick={handleBatchDelete}
            >
              {t('conversation.history.batchDelete')}
            </Button>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <>
      <Modal
        title={t('conversation.history.renameTitle')}
        visible={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={handleRenameCancel}
        okText={t('conversation.history.saveName')}
        cancelText={t('conversation.history.cancelEdit')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameModalName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameModalName}
          onChange={setRenameModalName}
          onPressEnter={handleRenameConfirm}
          placeholder={t('conversation.history.renamePlaceholder')}
          allowClear
        />
      </Modal>

      <Modal
        visible={exportModalVisible}
        title={t('conversation.history.exportDialogTitle')}
        onCancel={closeExportModal}
        footer={null}
        style={{ borderRadius: '12px' }}
        className='conversation-export-modal'
        alignCenter
        getPopupContainer={() => document.body}
      >
        <div className='py-8px'>
          <div className='text-14px mb-16px text-t-secondary'>
            {exportTask?.mode === 'batch'
              ? t('conversation.history.exportDialogBatchDescription', { count: exportTask.conversation_ids.length })
              : t('conversation.history.exportDialogSingleDescription')}
          </div>

          <div className='mb-16px p-16px rounded-12px bg-fill-1'>
            <div className='text-14px mb-8px text-t-primary'>{t('conversation.history.exportTargetFolder')}</div>
            <div
              className='flex items-center justify-between px-12px py-10px rounded-8px transition-colors'
              style={{
                backgroundColor: 'var(--color-bg-1)',
                border: '1px solid var(--color-border-2)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
                opacity: exportModalLoading ? 0.55 : 1,
              }}
              onClick={() => {
                void handleSelectExportFolder();
              }}
            >
              <span
                className='text-14px overflow-hidden text-ellipsis whitespace-nowrap'
                style={{ color: exportTargetPath ? 'var(--color-text-1)' : 'var(--color-text-3)' }}
              >
                {exportTargetPath || t('conversation.history.exportSelectFolder')}
              </span>
              <FolderOpen theme='outline' size='18' fill='var(--color-text-3)' />
            </div>
          </div>

          <div className='flex items-center gap-8px mb-20px text-14px text-t-secondary'>
            <span>💡</span>
            <span>{t('conversation.history.exportDialogHint')}</span>
          </div>

          <div className='flex gap-12px justify-end'>
            <Button className='!px-24px !h-36px !rounded-20px' type='secondary' onClick={closeExportModal}>
              {t('common.cancel')}
            </Button>
            <Button
              className='!px-24px !h-36px !rounded-20px'
              type='primary'
              onClick={() => {
                void handleConfirmExport();
              }}
              loading={exportModalLoading}
              disabled={exportModalLoading}
            >
              {exportModalLoading ? t('conversation.history.exporting') : t('common.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      <DirectorySelectionModal
        visible={showExportDirectorySelector}
        onConfirm={handleSelectExportDirectoryFromModal}
        onCancel={() => setShowExportDirectorySelector(false)}
      />

      {/* 移除项目确认弹窗 — 使用项目自家 AionModal + 圆角线框按钮（红色危险态） */}
      <AionModal
        visible={removeProjectTarget !== null}
        style={{ width: '400px' }}
        header={{
          title: t('conversation.history.removeProjectTitle'),
          showClose: true,
          style: { borderBottom: 'none' },
        }}
        onCancel={handleRemoveProjectCancel}
        footer={
          <div className='flex justify-end gap-12px pt-16px'>
            <Button
              className='!px-24px !h-36px !rounded-20px'
              type='secondary'
              onClick={handleRemoveProjectCancel}
              disabled={removeProjectLoading}
            >
              {t('conversation.history.cancelDelete')}
            </Button>
            <Button
              className='!px-24px !h-36px !rounded-20px'
              status='danger'
              type='outline'
              onClick={() => void handleRemoveProjectConfirm()}
              disabled={removeProjectLoading}
            >
              {removeProjectLoading ? t('conversation.history.deleting') : t('conversation.history.confirmDelete')}
            </Button>
          </div>
        }
      >
        <div className='text-14px leading-22px text-t-secondary'>
          {t('conversation.history.removeProjectConfirm', {
            name: removeProjectTarget?.name ?? '',
            count: removeProjectTarget?.conversations.length ?? 0,
          })}
        </div>
      </AionModal>

      <ProjectCreateModal
        visible={projectCreateVisible}
        initialWorkspace={projectCreateInitialWorkspace}
        onCancel={() => setProjectCreateVisible(false)}
        onCreated={(project) => {
          refreshProjects();
          setProjectCreateVisible(false);
          navigateToProjectChat(project.workspace, project.id);
        }}
      />

      <div>
        {/* L1: Pinned section */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {pinnedConversations.length > 0 && (
            <div className='min-w-0'>
              {!collapsed && <SectionLabel sectionKey='pinned' label={t('conversation.history.pinnedSection')} />}
              {!collapsedSections.has('pinned') && (
                <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                  <div className='min-w-0'>
                    {pinnedConversations.map((conversation) => {
                      const props = getConversationRowProps(conversation);
                      return isDragEnabled ? (
                        <SortableConversationRow key={conversation.id} {...props} />
                      ) : (
                        <ConversationRow key={conversation.id} {...props} />
                      );
                    })}
                  </div>
                </SortableContext>
              )}
            </div>
          )}

          <DragOverlay dropAnimation={null}>
            {activeId && activeConversation ? <DragOverlayContent conversation={activeConversation} /> : null}
          </DragOverlay>
        </DndContext>

        {/* Slot 由父级（Sider）填入：例如 Team / CronJob sections，位于「置顶」之后、「项目」之前 */}
        {afterPinnedContent}

        {/* L1: Projects section — workspace folders, peer to conversations */}
        {(projectGroups.length > 0 || !collapsed) && (
          <div className='min-w-0'>
            {!collapsed && (
              <SectionLabel
                sectionKey='projects'
                label={t('conversation.history.projectsSection')}
                trailing={projectSectionActions}
              />
            )}
            {!collapsedSections.has('projects') &&
              projectGroups.map((group) => {
                const projectMenu = (
                  <Menu
                    onClickMenuItem={(key) => {
                      if (key === 'new-chat') {
                        navigateToProjectChat(group.workspace, group.project_id);
                      }
                      if (key === 'save-project') {
                        void handleSaveWorkspaceAsProject(group.display_name, group.workspace, group.conversations);
                      }
                      if (key === 'rename' && group.project_id) {
                        handleRenameProject(group.project_id, group.display_name);
                      }
                      if (key === 'reveal') {
                        void ipcBridge.shell.showItemInFolder.invoke(group.workspace);
                      }
                      if (key === 'relink' && group.project_id) {
                        void handleRelinkProject(group.project_id, group.workspace);
                      }
                      if (key === 'remove') {
                        handleRemoveProject(group.display_name, group.conversations, group.project_id);
                      }
                    }}
                  >
                    <Menu.Item key='new-chat'>{t('conversation.history.newConversationInProject')}</Menu.Item>
                    {group.source === 'legacy-workspace' ? (
                      <Menu.Item key='save-project'>{t('conversation.history.convertWorkspaceToProject')}</Menu.Item>
                    ) : null}
                    {group.source === 'project' ? (
                      <>
                        <Menu.Item key='rename'>{t('conversation.history.renameProject')}</Menu.Item>
                        <Menu.Item key='reveal'>{t('conversation.history.revealProjectFolder')}</Menu.Item>
                        <Menu.Item key='relink'>{t('conversation.history.relinkProjectFolder')}</Menu.Item>
                        <Menu.Item key='remove' className='!text-danger-6'>
                          <span className='flex items-center gap-8px'>
                            <Delete theme='outline' size='14' />
                            {t('conversation.history.removeProject')}
                          </span>
                        </Menu.Item>
                      </>
                    ) : null}
                  </Menu>
                );
                return (
                  <div key={group.workspace} className='min-w-0'>
                    <WorkspaceCollapse
                      expanded={expandedWorkspaces.includes(group.workspace)}
                      onToggle={() => handleToggleWorkspace(group.workspace)}
                      siderCollapsed={collapsed}
                      stickyHeader
                      stickyTop={28}
                      header={
                        <span className='text-14px font-[500] truncate flex-1 text-t-primary min-w-0'>
                          {group.display_name}
                        </span>
                      }
                      trailing={
                        <span className='flex items-center gap-6px'>
                          <Tooltip content={t('conversation.history.newConversationInProject')} position='top'>
                            <Button
                              aria-label={t('conversation.history.newConversationInProject')}
                              className={classNames(
                                '!w-20px !h-20px !p-0 !rounded-4px !text-t-secondary hover:!text-t-primary hover:!bg-fill-3 sider-action-btn',
                                isMobile ? 'flex' : 'hidden group-hover:flex'
                              )}
                              size='mini'
                              type='text'
                              icon={
                                <Plus theme='outline' size='14' fill='currentColor' className='block leading-none' />
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                navigateToProjectChat(group.workspace, group.project_id);
                              }}
                            />
                          </Tooltip>
                          <Dropdown
                            droplist={projectMenu}
                            trigger='click'
                            position='br'
                            getPopupContainer={() => document.body}
                            unmountOnExit={false}
                          >
                            <Button
                              aria-label={t('conversation.history.projectActions')}
                              className={classNames(
                                '!w-20px !h-20px !p-0 !rounded-4px !text-t-secondary hover:!text-t-primary hover:!bg-fill-3 sider-action-btn',
                                isMobile ? 'flex' : 'hidden group-hover:flex'
                              )}
                              size='mini'
                              type='text'
                              icon={
                                <MoreOne theme='outline' size='14' fill='currentColor' className='block leading-none' />
                              }
                              onClick={(e) => e.stopPropagation()}
                            />
                          </Dropdown>
                        </span>
                      }
                    >
                      <div className={classNames('flex flex-col min-w-0', { 'mt-1px': !collapsed })}>
                        {group.conversations.map((conversation) => renderConversation(conversation, true))}
                      </div>
                    </WorkspaceCollapse>
                  </div>
                );
              })}
          </div>
        )}

        {/* L1: Conversations section — peer to projects, internally split by timeline */}
        {(conversationOnlySections.length > 0 ||
          (timelineSections.length === 0 && pinnedConversations.length === 0)) && (
          <div className='min-w-0'>
            {!collapsed && (
              <SectionLabel
                sectionKey='conversations'
                label={t('conversation.history.conversationsSection')}
                trailing={conversationSectionActions}
              />
            )}
            {batchSelectionPanel}
            {conversationOnlySections.length === 0 ? (
              <div className='py-48px flex-center'>
                <Empty description={t('conversation.history.noHistory')} />
              </div>
            ) : null}
            {!collapsedSections.has('conversations') &&
              conversationOnlySections.map((section) => (
                <div key={section.timeline} className='min-w-0'>
                  {!collapsed && conversationOnlySections.length > 1 && (
                    <div className='flex items-center px-16px h-24px select-none'>
                      <span className='text-12px text-t-secondary font-[500] leading-none'>{section.timeline}</span>
                    </div>
                  )}
                  {section.items.map((item) =>
                    item.type === 'conversation' && item.conversation ? renderConversation(item.conversation) : null
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </>
  );
};

export default WorkspaceGroupedHistory;
