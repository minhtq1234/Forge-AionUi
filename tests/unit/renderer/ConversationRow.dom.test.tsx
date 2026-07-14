/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: undefined }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: ({ status }: { status: string }) => <span data-testid={`cron-status-${status}`} />,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'fallback', label: 'Agent' }),
}));

import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';

const conversation = {
  id: 'conversation-1',
  name: 'Review the release notes',
  created_at: 1,
  modified_at: 1,
  type: 'acp',
  model: { provider: 'openai', model: 'gpt-5' },
  extra: { backend: 'codex' },
} satisfies TChatConversation;

const buildProps = (overrides: Partial<ConversationRowProps> = {}): ConversationRowProps => ({
  conversation,
  isGenerating: false,
  hasCompletionUnread: false,
  collapsed: false,
  tooltipEnabled: false,
  batchMode: false,
  checked: false,
  selected: false,
  menuVisible: false,
  onToggleChecked: vi.fn(),
  onConversationClick: vi.fn(),
  onOpenMenu: vi.fn(),
  onMenuVisibleChange: vi.fn(),
  onEditStart: vi.fn(),
  onDelete: vi.fn(),
  onTogglePin: vi.fn(),
  getJobStatus: () => 'none',
  ...overrides,
});

describe('ConversationRow status icon', () => {
  it('shows a running indicator while a chat is generating', () => {
    render(<ConversationRow {...buildProps({ isGenerating: true })} />);

    expect(screen.getByTestId('conversation-status-running-conversation-1')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-status-attention-conversation-1')).not.toBeInTheDocument();
  });

  it('uses an attention indicator for an unread completion', () => {
    render(<ConversationRow {...buildProps({ hasCompletionUnread: true })} />);

    expect(screen.getByTestId('conversation-status-attention-conversation-1')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-status-completed-conversation-1')).not.toBeInTheDocument();
  });

  it('shows a completion check when a chat has no active or unread state', () => {
    render(<ConversationRow {...buildProps()} />);

    expect(screen.getByTestId('conversation-status-completed-conversation-1')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-status-completed-conversation-1')).not.toHaveClass(
      'conversation-status-mark--settling'
    );
  });

  it('settles the completion mark when a generating chat finishes', () => {
    const { rerender } = render(<ConversationRow {...buildProps({ isGenerating: true })} />);

    rerender(<ConversationRow {...buildProps()} />);

    expect(screen.getByTestId('conversation-status-completed-conversation-1')).toHaveClass(
      'conversation-status-mark--settling'
    );
  });

  it('does not animate a new generating state after a completion settles', () => {
    const { rerender } = render(<ConversationRow {...buildProps({ isGenerating: true })} />);

    rerender(<ConversationRow {...buildProps()} />);
    rerender(<ConversationRow {...buildProps({ isGenerating: true })} />);

    expect(screen.getByTestId('conversation-status-running-conversation-1')).not.toHaveClass(
      'conversation-status-mark--settling'
    );
  });

  it('keeps the scheduled-task indicator when the conversation has a cron status', () => {
    render(<ConversationRow {...buildProps({ getJobStatus: () => 'active' })} />);

    expect(screen.getByTestId('cron-status-active')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-status-completed-conversation-1')).not.toBeInTheDocument();
  });
});
