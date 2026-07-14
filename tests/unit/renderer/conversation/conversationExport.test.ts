import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { buildConversationExportText } from '@/renderer/utils/chat/conversationExport';
import { afterEach, describe, expect, it, vi } from 'vitest';

const conversation: Extract<TChatConversation, { type: 'aionrs' }> = {
  id: 'conversation-1',
  name: 'Context work',
  type: 'aionrs',
  created_at: 1,
  modified_at: 2,
  model: {
    id: 'provider-1',
    platform: 'openai',
    name: 'OpenAI',
    base_url: '',
    api_key: '',
    use_model: 'model-1',
  },
  extra: {
    workspace: '/workspace',
    context: '# Conversation Context\n\n## Goal\n\n- Hidden from transcript export.',
    context_file_name: 'Context.md',
    context_handoff: {
      snapshot: {
        goal: 'Hidden from transcript export.',
        current_state: [],
        decisions: [],
        artifacts: [],
        user_preferences: [],
        open_questions: [],
        next_steps: [],
        do_not_forget: [],
      },
      revision: 3,
      source: 'llm',
      status: 'fresh',
    },
  },
};

const messages: TMessage[] = [
  {
    id: 'message-1',
    msg_id: 'message-1',
    conversation_id: conversation.id,
    type: 'text',
    position: 'right',
    content: { content: 'Please implement context management.' },
  },
  {
    id: 'message-2',
    msg_id: 'message-2',
    conversation_id: conversation.id,
    type: 'text',
    position: 'left',
    content: { content: 'The focused implementation is complete.' },
  },
];

describe('buildConversationExportText', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves the legacy transcript format and excludes Context.md state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));

    const exported = buildConversationExportText(conversation, messages, {
      conversation: 'Conversation',
      conversation_id: 'Conversation ID',
      exportedAt: 'Exported at',
      type: 'Type',
      noMessages: 'No messages',
      user: 'User',
      assistant: 'Assistant',
      system: 'System',
    });

    expect(exported).toBe(
      [
        'Conversation: Context work',
        'Conversation ID: conversation-1',
        'Exported at: 2026-07-10T08:00:00.000Z',
        'Type: aionrs',
        '',
        'User:',
        'Please implement context management.',
        '',
        'Assistant:',
        'The focused implementation is complete.',
      ].join('\n')
    );
    expect(exported).not.toContain('Conversation Context');
    expect(exported).not.toContain('Hidden from transcript export');
    expect(exported).not.toContain('revision');
  });
});
