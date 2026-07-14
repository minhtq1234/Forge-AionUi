/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { WorkspaceGroupedHistoryProps } from '@/renderer/pages/conversation/GroupedHistory/types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const onBatchModeChangeMock = vi.fn();
const onNewChatMock = vi.fn();
const capturedDisplayTimes = vi.hoisted(() => [] as Array<string | undefined>);

const conversation = {
  id: 'conv-1',
  name: 'Quarterly planning',
  created_at: 1,
  updated_at: 2,
  status: 'finished',
  platform: 'acp',
  extra: { backend: 'codex' },
} satisfies TChatConversation;

const hiddenConversation = {
  id: 'conv-2',
  name: 'Remote access notes',
  created_at: 1,
  updated_at: 1,
  status: 'finished',
  platform: 'acp',
  extra: { backend: 'codex' },
} satisfies TChatConversation;

const t = (key: string, options?: { count?: number }) => {
  const values: Record<string, string> = {
    'conversation.history.batchDelete': 'Batch Delete',
    'conversation.history.batchManage': 'Batch Manage',
    'conversation.history.batchModeExit': 'Exit Batch Mode',
    'conversation.history.conversationsSection': 'Chats',
    'conversation.history.noHistory': 'No history',
    'conversation.history.projectsSection': 'Projects',
    'conversation.history.searchPlaceholder': 'Search chats & projects',
    'conversation.history.selectAll': 'Select All',
    'conversation.history.selectedCount': `${options?.count ?? 0} selected`,
    'conversation.welcome.newConversation': 'New Chat',
  };
  return values[key] ?? key;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/cron', () => ({
  useCronJobsMap: () => ({
    getJobStatus: () => 'none',
    markAsRead: vi.fn(),
    setActiveConversation: vi.fn(),
  }),
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));

vi.mock('@/renderer/components/settings/DirectorySelectionModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationRow', () => ({
  default: ({
    conversation: rowConversation,
    displayTime,
  }: {
    conversation: TChatConversation;
    displayTime?: string;
  }) => {
    capturedDisplayTimes.push(displayTime);
    return <div>{rowConversation.name}</div>;
  },
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/SortableConversationRow', () => ({
  default: ({ conversation: rowConversation }: { conversation: TChatConversation }) => (
    <div>{rowConversation.name}</div>
  ),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/DragOverlayContent', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversations', () => ({
  useConversations: () => ({
    conversations: [conversation],
    isConversationGenerating: () => false,
    hasCompletionUnread: () => false,
    expandedWorkspaces: [],
    pinnedConversations: [],
    timelineSections: [
      {
        timeline: 'Today',
        items: [
          { type: 'conversation', time: 2, conversation },
          { type: 'conversation', time: 1, conversation: hiddenConversation },
        ],
      },
    ],
    handleToggleWorkspace: vi.fn(),
    collapsedSections: new Set<string>(),
    toggleSection: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions', () => ({
  useConversationActions: () => ({
    renameModalVisible: false,
    renameModalName: '',
    setRenameModalName: vi.fn(),
    renameLoading: false,
    dropdownVisibleId: null,
    handleConversationClick: vi.fn(),
    handleDeleteClick: vi.fn(),
    handleBatchDelete: vi.fn(),
    handleEditStart: vi.fn(),
    handleRenameConfirm: vi.fn(),
    handleRenameCancel: vi.fn(),
    handleTogglePin: vi.fn(),
    handleMenuVisibleChange: vi.fn(),
    handleOpenMenu: vi.fn(),
    handleRemoveProject: vi.fn(),
    removeProjectTarget: null,
    removeProjectLoading: false,
    handleRemoveProjectCancel: vi.fn(),
    handleRemoveProjectConfirm: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useExport', () => ({
  useExport: () => ({
    exportTask: null,
    exportModalVisible: false,
    exportTargetPath: '',
    exportModalLoading: false,
    showExportDirectorySelector: false,
    setShowExportDirectorySelector: vi.fn(),
    closeExportModal: vi.fn(),
    handleSelectExportDirectoryFromModal: vi.fn(),
    handleSelectExportFolder: vi.fn(),
    handleConfirmExport: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useDragAndDrop', () => ({
  useDragAndDrop: () => ({
    sensors: [],
    activeId: null,
    activeConversation: null,
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragCancel: vi.fn(),
    isDragEnabled: false,
  }),
}));

import WorkspaceGroupedHistory from '@/renderer/pages/conversation/GroupedHistory';

const GroupedHistoryWithNewChat = WorkspaceGroupedHistory as React.ComponentType<
  WorkspaceGroupedHistoryProps & { onNewChat: () => void }
>;

describe('sidebar Chats controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDisplayTimes.length = 0;
  });

  it('shows one aligned add action beside Chats without a batch edit button', () => {
    render(
      <MemoryRouter>
        <GroupedHistoryWithNewChat
          onBatchModeChange={onBatchModeChangeMock}
          onNewChat={onNewChatMock}
          afterPinnedContent={<div data-testid='teams-section'>Teams</div>}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.queryByText('Conversations')).not.toBeInTheDocument();

    const chatsLabel = screen.getByText('Chats');
    const chatsHeader = chatsLabel.closest('.sider-section-label');
    expect(chatsHeader).toBeInstanceOf(HTMLElement);
    expect(within(chatsHeader as HTMLElement).queryByText('2')).not.toBeInTheDocument();
    expect(chatsLabel).toHaveClass('text-15px');
    expect(chatsLabel).toHaveClass('text-t-primary');
    expect(chatsLabel).toHaveClass('font-700');

    const newChatButton = within(chatsHeader as HTMLElement).getByLabelText('New Chat');
    expect(newChatButton).toHaveClass('sider-section-add-action');
    expect(within(chatsHeader as HTMLElement).queryByLabelText('Batch Manage')).not.toBeInTheDocument();
    expect(within(chatsHeader as HTMLElement).queryByLabelText('Exit Batch Mode')).not.toBeInTheDocument();

    fireEvent.click(newChatButton);

    expect(onNewChatMock).toHaveBeenCalledTimes(1);
    expect(onBatchModeChangeMock).not.toHaveBeenCalled();

    const projectsHeader = screen.getByText('Projects').closest('.sider-section-label');
    expect(projectsHeader).toBeInstanceOf(HTMLElement);
    expect(within(projectsHeader as HTMLElement).queryByText('0')).not.toBeInTheDocument();
    expect(within(projectsHeader as HTMLElement).getByLabelText('conversation.history.newProject')).toHaveClass(
      'sider-section-add-action'
    );
  });

  it('shows sections without counts or a sidebar search field', () => {
    render(
      <MemoryRouter>
        <GroupedHistoryWithNewChat
          onBatchModeChange={onBatchModeChangeMock}
          onNewChat={onNewChatMock}
          afterPinnedContent={<div data-testid='teams-section'>Teams</div>}
        />
      </MemoryRouter>
    );

    expect(screen.queryByPlaceholderText('Search chats & projects')).not.toBeInTheDocument();
    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
    expect(screen.getByText('Quarterly planning')).toBeInTheDocument();
    expect(screen.getByText('Remote access notes')).toBeInTheDocument();
    expect(capturedDisplayTimes).not.toContainEqual(expect.any(String));
  });
});
