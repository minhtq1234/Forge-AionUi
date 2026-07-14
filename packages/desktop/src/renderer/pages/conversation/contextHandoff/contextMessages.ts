import type { TMessage } from '@/common/chat/chatLib';
import { DEFAULT_MESSAGE_PAGE_LIMIT, loadLatestConversationMessages } from '@/renderer/utils/chat/messagePagination';

export const selectContextHandoffMessages = (liveMessages: TMessage[], loadedMessages: TMessage[]): TMessage[] => {
  return liveMessages.length > 0 ? liveMessages : loadedMessages;
};

export const loadContextHandoffMessages = async (conversationId: string): Promise<TMessage[]> => {
  const page = await loadLatestConversationMessages(conversationId, {
    limit: DEFAULT_MESSAGE_PAGE_LIMIT,
    contentMode: 'compact',
  });
  return page.items;
};
