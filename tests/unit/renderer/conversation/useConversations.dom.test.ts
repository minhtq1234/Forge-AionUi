/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  activeId: 'conversation-1' as string | undefined,
  clearCompletionUnread: vi.fn(),
  refreshConversationRuntime: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: harness.activeId }),
}));

vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    conversations: [],
    isConversationGenerating: vi.fn(),
    getRecentCompletionAt: vi.fn(),
    clearCompletionUnread: harness.clearCompletionUnread,
    refreshConversationRuntime: harness.refreshConversationRuntime,
    groupedHistory: {
      pinnedConversations: [],
      timelineSections: [],
    },
  }),
}));

import { useConversations } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversations';

describe('useConversations completion state', () => {
  beforeEach(() => {
    harness.activeId = 'conversation-1';
    harness.clearCompletionUnread.mockReset();
    harness.refreshConversationRuntime.mockReset();
  });

  it('does not clear the one-minute completion signal when the route or sidebar rerenders', () => {
    const { rerender } = renderHook(() => useConversations());

    rerender();
    harness.activeId = 'conversation-2';
    rerender();

    expect(harness.clearCompletionUnread).not.toHaveBeenCalled();
    expect(harness.refreshConversationRuntime).toHaveBeenLastCalledWith('conversation-2');
  });
});
