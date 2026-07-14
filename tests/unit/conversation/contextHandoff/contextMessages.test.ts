import { describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import {
  loadContextHandoffMessages,
  selectContextHandoffMessages,
} from '@/renderer/pages/conversation/contextHandoff/contextMessages';
import { DEFAULT_MESSAGE_PAGE_LIMIT, loadLatestConversationMessages } from '@/renderer/utils/chat/messagePagination';

vi.mock('@/renderer/utils/chat/messagePagination', () => ({
  DEFAULT_MESSAGE_PAGE_LIMIT: 50,
  loadLatestConversationMessages: vi.fn(),
}));

const textMessage = (id: string, content: string): TMessage => ({
  id,
  msg_id: id,
  conversation_id: 'conv-1',
  type: 'text',
  position: 'right',
  content: { content },
});

describe('context handoff messages', () => {
  it('uses loaded sidebar messages when no live message provider is available', () => {
    const loaded = [textMessage('loaded-1', 'Loaded from compact page')];

    expect(selectContextHandoffMessages([], loaded)).toBe(loaded);
  });

  it('prefers live provider messages when the panel is mounted inside the chat provider', () => {
    const live = [textMessage('live-1', 'Live message')];
    const loaded = [textMessage('loaded-1', 'Loaded message')];

    expect(selectContextHandoffMessages(live, loaded)).toBe(live);
  });

  it('loads the latest compact messages for Project sidebar budgeting', async () => {
    const message = textMessage('loaded-1', 'Loaded from compact page');
    vi.mocked(loadLatestConversationMessages).mockResolvedValue({
      items: [message],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    await expect(loadContextHandoffMessages('conv-1')).resolves.toEqual([message]);
    expect(loadLatestConversationMessages).toHaveBeenCalledWith('conv-1', {
      limit: DEFAULT_MESSAGE_PAGE_LIMIT,
      contentMode: 'compact',
    });
  });
});
