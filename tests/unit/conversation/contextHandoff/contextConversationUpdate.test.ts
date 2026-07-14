import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import {
  buildContextHandoffExtraPatch,
  buildContextSnapshotStatePatch,
} from '@/renderer/pages/conversation/contextHandoff/contextConversationUpdate';
import type { TContextSnapshot } from '@/common/config/storage';

const conversation = {
  id: 'conv-1',
  name: 'Monthly Close',
  type: 'aionrs',
  created_at: 1,
  modified_at: 2,
  model: { id: 'p1', platform: 'openai', name: 'OpenAI', base_url: '', api_key: '', use_model: 'gpt-4.1' },
  extra: {
    workspace: '/workspace',
    skills: ['finance-close'],
    mcp_servers: ['filesystem'],
    context_handoff: {
      pinned_context: [
        {
          id: 'pin-1',
          title: 'Reporting unit',
          content: 'Use VND millions.',
          source: 'manual',
          created_at: 1,
          updated_at: 1,
        },
      ],
    },
  },
} satisfies Extract<TChatConversation, { type: 'aionrs' }>;

const snapshot: TContextSnapshot = {
  goal: 'Summarize the handoff.',
  current_state: ['The panel can export Context.md.'],
  decisions: ['Pins stay outside the model-authored snapshot.'],
  artifacts: ['/workspace/Context.md'],
  user_preferences: ['Preserve existing manual pins.'],
  open_questions: ['How should stale state be surfaced?'],
  next_steps: ['Add structured compaction metadata.'],
  do_not_forget: ['Do not let the model rewrite pins.'],
};

describe('buildContextHandoffExtraPatch', () => {
  it('patches only context_handoff so immutable skills and MCP snapshots are not resent', () => {
    const patch = buildContextHandoffExtraPatch(conversation, {
      context_file_name: 'Context.md',
      context_file_path: '/workspace/Context.md',
    });

    expect(patch).toEqual({
      context_handoff: {
        pinned_context: conversation.extra.context_handoff?.pinned_context,
        context_file_name: 'Context.md',
        context_file_path: '/workspace/Context.md',
      },
    });
    expect(patch).not.toHaveProperty('skills');
    expect(patch).not.toHaveProperty('mcp_servers');
    expect(patch).not.toHaveProperty('workspace');
  });

  it('preserves existing pins when a model-authored patch is not allowed to mutate them', () => {
    const patch = buildContextSnapshotStatePatch(conversation, {
      snapshot: {
        ...snapshot,
        decisions: [{ bad: 'shape' }],
      },
      source: 'llm',
      status: 'failed',
      updatedAt: 99,
      lastErrorCode: 'invalid_snapshot',
      didPersistFileUpdate: true,
    });

    expect(patch).toEqual({
      context_handoff: {
        pinned_context: conversation.extra.context_handoff?.pinned_context,
        source: 'llm',
        status: 'failed',
        updated_at: 99,
        last_error_code: 'invalid_snapshot',
      },
    });
  });

  it('drops protected generation fields from the generic mutable patch builder', () => {
    const patch = buildContextHandoffExtraPatch(conversation, {
      context_file_name: 'Context.md',
      context_file_path: '/workspace/Context.md',
      snapshot,
      revision: 99,
      source: 'llm',
      status: 'fresh',
      last_compacted_turn_id: 'turn-7',
      turns_since_compaction: 0,
      updated_at: 123,
      last_error_code: 'should-not-pass-through',
    } as unknown as Parameters<typeof buildContextHandoffExtraPatch>[1]);

    expect(patch).toEqual({
      context_handoff: {
        pinned_context: conversation.extra.context_handoff?.pinned_context,
        context_file_name: 'Context.md',
        context_file_path: '/workspace/Context.md',
      },
    });
  });
});
