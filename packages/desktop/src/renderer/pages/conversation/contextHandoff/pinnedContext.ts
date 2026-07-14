import type {
  TChatConversation,
  TContextHandoffExtra,
  TContextHandoffItem,
  TContextHandoffItemSource,
} from '@/common/config/storage';

type AddPinnedContextInput = {
  items: TContextHandoffItem[];
  title: string;
  content: string;
  source: TContextHandoffItemSource;
  now: number;
  createId: () => string;
};

type UpdatePinnedContextInput = {
  items: TContextHandoffItem[];
  id: string;
  title: string;
  content: string;
  now: number;
};

const cleanText = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const addPinnedContext = (input: AddPinnedContextInput): TContextHandoffItem[] => {
  const content = cleanText(input.content);
  if (!content) return input.items;

  return [
    ...input.items,
    {
      id: input.createId(),
      title: cleanText(input.title),
      content,
      source: input.source,
      created_at: input.now,
      updated_at: input.now,
    },
  ];
};

export const updatePinnedContext = (input: UpdatePinnedContextInput): TContextHandoffItem[] => {
  const content = cleanText(input.content);
  if (!content) return removePinnedContext(input.items, input.id);

  return input.items.map((item) =>
    item.id === input.id
      ? {
          ...item,
          title: cleanText(input.title),
          content,
          updated_at: input.now,
        }
      : item
  );
};

export const removePinnedContext = (items: TContextHandoffItem[], id: string): TContextHandoffItem[] => {
  return items.filter((item) => item.id !== id);
};

export const getConversationContextHandoffExtra = (
  conversation: TChatConversation | null | undefined
): TContextHandoffExtra => {
  const contextHandoff = conversation?.extra?.context_handoff;
  return contextHandoff && typeof contextHandoff === 'object' ? contextHandoff : {};
};

export const getConversationPinnedContext = (
  conversation: TChatConversation | null | undefined
): TContextHandoffItem[] => {
  const pinnedContext = getConversationContextHandoffExtra(conversation).pinned_context;
  return Array.isArray(pinnedContext) ? pinnedContext : [];
};
