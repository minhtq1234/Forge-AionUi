/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: (enabled = false) => ({
    disabled: !enabled,
    popupVisible: enabled,
    unmountOnExit: true,
    popupHoverStay: false,
    getPopupContainer: () => document.body,
  }),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: ({ status }: { status: string }) => <span data-testid={`cron-status-${status}`} />,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'image', value: 'assistant.png', label: 'Agent' }),
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

const waitingApprovalConversation = {
  ...conversation,
  runtime: {
    state: 'waiting_confirmation',
    can_send_message: false,
    has_task: true,
    task_status: 'running',
    is_processing: true,
    pending_confirmations: 1,
    turn_id: 'turn-1',
  },
} satisfies TChatConversation;

const buildProps = (overrides: Partial<ConversationRowProps> = {}): ConversationRowProps => ({
  conversation,
  isGenerating: false,
  recentCompletionAt: undefined,
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

afterEach(() => {
  vi.useRealTimers();
});

describe('ConversationRow status', () => {
  it('shows a running indicator while a chat is generating', () => {
    render(<ConversationRow {...buildProps({ isGenerating: true })} />);

    expect(screen.getByTestId('conversation-status-running-conversation-1')).toBeInTheDocument();
    expect(screen.queryByAltText('Agent')).not.toBeInTheDocument();
  });

  it('keeps an idle chat free of a leading logo', () => {
    render(<ConversationRow {...buildProps()} />);

    expect(screen.queryByAltText('Agent')).not.toBeInTheDocument();
  });

  it('shows the assistant logo for one minute after completion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));

    render(<ConversationRow {...buildProps({ recentCompletionAt: Date.now() })} />);

    expect(screen.getByAltText('Agent')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(screen.getByAltText('Agent')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByAltText('Agent')).not.toBeInTheDocument();
  });

  it('does not revive a completion logo when the stored completion is already expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:01:00Z'));

    render(<ConversationRow {...buildProps({ recentCompletionAt: Date.now() - 60_000 })} />);

    expect(screen.queryByAltText('Agent')).not.toBeInTheDocument();
  });

  it('resumes the remaining completion window after remounting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
    const completedAt = Date.now();
    const firstRender = render(<ConversationRow {...buildProps({ recentCompletionAt: completedAt })} />);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(vi.getTimerCount()).toBe(1);
    firstRender.unmount();
    expect(vi.getTimerCount()).toBe(0);
    render(<ConversationRow {...buildProps({ recentCompletionAt: completedAt })} />);

    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    expect(screen.getByAltText('Agent')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByAltText('Agent')).not.toBeInTheDocument();
  });

  it('replaces the title with an approval pill while a generating chat waits for confirmation', () => {
    render(<ConversationRow {...buildProps({ conversation: waitingApprovalConversation, isGenerating: true })} />);

    expect(screen.getByTestId('conversation-status-approval-pill-conversation-1')).toHaveTextContent(
      'conversation.status.waitingApproval'
    );
    expect(screen.queryByText(conversation.name)).not.toBeInTheDocument();
    expect(screen.queryByTestId('conversation-status-running-conversation-1')).not.toBeInTheDocument();
  });

  it('removes the selected row background around an expanded approval pill', () => {
    render(
      <ConversationRow
        {...buildProps({ conversation: waitingApprovalConversation, isGenerating: true, selected: true })}
      />
    );

    expect(document.getElementById('c-conversation-1')).not.toHaveClass('!bg-fill-3');
  });

  it('uses the approval mark when a collapsed chat waits for confirmation', () => {
    render(
      <ConversationRow
        {...buildProps({ conversation: waitingApprovalConversation, isGenerating: true, collapsed: true })}
      />
    );

    expect(screen.getByTestId('conversation-status-approval-conversation-1')).toHaveAccessibleName(
      `${conversation.name} conversation.status.waitingApproval`
    );
    expect(screen.queryByTestId('conversation-status-approval-pill-conversation-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('conversation-status-running-conversation-1')).not.toBeInTheDocument();
  });

  it('keeps the conversation name in the collapsed approval tooltip', async () => {
    render(
      <ConversationRow
        {...buildProps({
          conversation: waitingApprovalConversation,
          isGenerating: true,
          collapsed: true,
          tooltipEnabled: true,
        })}
      />
    );

    const tooltipContent = await waitFor(() => {
      const content = document.querySelector('[role="tooltip"] .arco-tooltip-content-inner');
      expect(content).not.toBeNull();
      return content;
    });
    expect(tooltipContent).toHaveTextContent(conversation.name);
    expect(tooltipContent).toHaveTextContent('conversation.status.waitingApproval');
  });

  it('shows approval when pending confirmations are reported without the waiting state', () => {
    const countOnlyApprovalConversation = {
      ...waitingApprovalConversation,
      runtime: {
        ...waitingApprovalConversation.runtime,
        state: 'running',
      },
    } satisfies TChatConversation;

    render(<ConversationRow {...buildProps({ conversation: countOnlyApprovalConversation, isGenerating: true })} />);

    expect(screen.getByTestId('conversation-status-approval-pill-conversation-1')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-status-running-conversation-1')).not.toBeInTheDocument();
  });

  it('keeps the assistant identity in batch mode', () => {
    render(<ConversationRow {...buildProps({ batchMode: true })} />);

    expect(screen.getByAltText('Agent')).toBeInTheDocument();
  });

  it('keeps the scheduled-task indicator when the conversation has a cron status', () => {
    render(<ConversationRow {...buildProps({ recentCompletionAt: Date.now(), getJobStatus: () => 'active' })} />);

    expect(screen.getByTestId('cron-status-active')).toBeInTheDocument();
    expect(screen.queryByAltText('Agent')).not.toBeInTheDocument();
  });
});
