import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { IConversationTurnCompletedEvent } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation, TContextSnapshot } from '@/common/config/storage';
import {
  compactConversationContext,
  ContextCompactionOperationError,
  handoffConversationContext,
  isMeaningfulContextTurn,
  pinConversationContext,
  shouldAutoCompactContext,
  type CompactConversationContextResult,
  type ContextCompactionDependencies,
  useContextCompaction,
} from '@/renderer/pages/conversation/contextHandoff/useContextCompaction';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshot: TContextSnapshot = {
  goal: 'Ship LLM-first context management.',
  current_state: ['Structured compaction is wired.'],
  decisions: ['Pins are immutable.'],
  artifacts: ['/workspace/Context.md'],
  user_preferences: ['Keep the UI compact.'],
  open_questions: [],
  next_steps: ['Verify the handoff.'],
  do_not_forget: ['Keep transcript export unchanged.'],
};

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
};

const messages: TMessage[] = [
  {
    id: 'message-1',
    msg_id: 'message-1',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'right',
    content: { content: 'Build context management.' },
  },
  {
    id: 'message-2',
    msg_id: 'message-2',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'left',
    content: { content: 'The implementation is ready.' },
  },
];

type TestDependencies = ContextCompactionDependencies & {
  updates: Array<{ id: string; updates: Partial<TChatConversation>; merge_extra?: boolean }>;
};

const createDependencies = (): TestDependencies => {
  const updates: TestDependencies['updates'] = [];
  return {
    updates,
    getConversation: vi.fn(async () => conversation),
    loadMessages: vi.fn(async () => messages),
    readFile: vi.fn(async () => '# Conversation Context\n\n## Goal\n\n- Keep the edited goal.'),
    writeFile: vi.fn(async () => true),
    updateConversation: vi.fn(async (input) => {
      updates.push(input);
      return true;
    }),
    compactRemote: vi.fn(async () => ({ snapshot, through_turn_id: 'turn-4' })),
    compactLocal: vi.fn(async () => ({
      snapshot,
      through_turn_id: 'turn-4',
      model: { provider_id: 'provider-1', model: 'model-1' },
    })),
    emitRefresh: vi.fn(),
    now: () => 100,
  };
};

const completedTurn = (overrides: Partial<IConversationTurnCompletedEvent> = {}): IConversationTurnCompletedEvent => ({
  session_id: 'conversation-1',
  turn_id: 'turn-1',
  status: 'finished',
  state: 'ai_waiting_input',
  detail: '',
  can_send_message: true,
  runtime: {
    state: 'idle',
    can_send_message: true,
    has_task: false,
    is_processing: false,
    pending_confirmations: 0,
    turn_id: null,
  },
  workspace: '/workspace',
  model: { platform: 'openai', name: 'OpenAI', use_model: 'model-1' },
  last_message: {
    id: 'message-2',
    type: 'text',
    content: 'Completed useful work.',
    status: 'finish',
    created_at: 100,
  },
  ...overrides,
});

describe('compactConversationContext', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('persists a validated remote snapshot only after Context.md is written', async () => {
    const dependencies = createDependencies();

    const result = await compactConversationContext(
      {
        conversationId: 'conversation-1',
        workspace: '/workspace',
        trigger: 'auto',
        targetTurnId: 'turn-4',
        budgetStatus: 'healthy',
      },
      dependencies
    );

    expect(result.source).toBe('llm');
    expect(dependencies.writeFile).toHaveBeenCalledWith({
      path: '/workspace/Context.md',
      data: expect.stringContaining('- Ship LLM-first context management.'),
      workspace: '/workspace',
    });
    expect(dependencies.updates.at(-1)?.updates.extra).toEqual({
      context_handoff: expect.objectContaining({
        snapshot,
        revision: 1,
        source: 'llm',
        status: 'fresh',
        last_compacted_turn_id: 'turn-4',
        turns_since_compaction: 0,
        context_file_path: '/workspace/Context.md',
        context_file_name: 'Context.md',
      }),
    });
    expect(dependencies.emitRefresh).toHaveBeenCalledWith('conversation-1');
  });

  it('normalizes bounded model variance instead of using the rules fallback', async () => {
    const dependencies = createDependencies();
    dependencies.compactRemote = vi.fn(async () => ({
      snapshot: {
        ...snapshot,
        goal: 'g'.repeat(1_001),
        current_state: Array.from({ length: 13 }, (_, index) => `State ${index}`),
        decisions: ['d'.repeat(501)],
        provider_note: 'ignore this extra field',
      },
      through_turn_id: 'turn-4',
    }));

    const result = await compactConversationContext(
      {
        conversationId: 'conversation-1',
        workspace: '/workspace',
        trigger: 'auto',
        targetTurnId: 'turn-4',
      },
      dependencies
    );

    expect(result.source).toBe('llm');
    expect(result.snapshot.goal).toHaveLength(1_000);
    expect(result.snapshot.current_state).toHaveLength(12);
    expect(result.snapshot.decisions[0]).toHaveLength(500);
    expect(result.snapshot).not.toHaveProperty('provider_note');
  });

  it('uses the desktop provider fallback only when the runtime endpoint is unavailable', async () => {
    const dependencies = createDependencies();
    dependencies.compactRemote = vi.fn(async () => {
      throw new BackendHttpError({ method: 'POST', path: '/context/compact', status: 404, body: {} });
    });

    await compactConversationContext(
      {
        conversationId: 'conversation-1',
        workspace: '/workspace',
        trigger: 'manual',
        targetTurnId: 'turn-4',
      },
      dependencies
    );

    expect(dependencies.compactLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-1',
        provider_id: 'provider-1',
        model: 'model-1',
        target_turn_id: 'turn-4',
      })
    );
  });

  it('resolves the fallback provider from the persisted aionrs model shape', async () => {
    const dependencies = createDependencies();
    // Aionrs conversations persist { provider_id, model, use_model: null } —
    // not the TProviderWithModel shape the type declares.
    dependencies.getConversation = vi.fn(async () => ({
      ...conversation,
      model: { provider_id: 'provider-1', model: 'model-1', use_model: null } as unknown as typeof conversation.model,
    }));
    dependencies.compactRemote = vi.fn(async () => {
      throw new BackendHttpError({ method: 'POST', path: '/context/compact', status: 404, body: {} });
    });

    await compactConversationContext(
      {
        conversationId: 'conversation-1',
        workspace: '/workspace',
        trigger: 'manual',
        targetTurnId: 'turn-4',
      },
      dependencies
    );

    expect(dependencies.compactLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-1',
        provider_id: 'provider-1',
        model: 'model-1',
      })
    );
  });

  it('writes a preservation-oriented rules snapshot when both LLM paths fail', async () => {
    const dependencies = createDependencies();
    dependencies.compactRemote = vi.fn(async () => {
      throw new BackendHttpError({ method: 'POST', path: '/context/compact', status: 404, body: {} });
    });
    dependencies.compactLocal = vi.fn(async () => {
      throw Object.assign(new Error('provider failed'), { code: 'provider_request_failed' });
    });

    const result = await compactConversationContext(
      {
        conversationId: 'conversation-1',
        workspace: '/workspace',
        trigger: 'manual',
        targetTurnId: 'turn-4',
      },
      dependencies
    );

    expect(result.source).toBe('rules');
    expect(result.markdown).toContain('Keep the edited goal.');
    expect(dependencies.updates.at(-1)?.updates.extra).toEqual({
      context_handoff: expect.objectContaining({
        source: 'rules',
        status: 'fresh',
        last_error_code: 'provider_request_failed',
        revision: 1,
      }),
    });
  });

  it('does not advance the durable revision when writing Context.md fails', async () => {
    const dependencies = createDependencies();
    dependencies.writeFile = vi.fn(async () => false);

    await expect(
      compactConversationContext(
        {
          conversationId: 'conversation-1',
          workspace: '/workspace',
          trigger: 'manual',
          targetTurnId: 'turn-4',
        },
        dependencies
      )
    ).rejects.toBeInstanceOf(ContextCompactionOperationError);

    expect(dependencies.updates.at(-1)?.updates.extra).toEqual({
      context_handoff: expect.not.objectContaining({ revision: expect.any(Number) }),
    });
    expect(dependencies.updates.at(-1)?.updates.extra).toEqual({
      context_handoff: expect.objectContaining({ status: 'failed', last_error_code: 'file_write_failed' }),
    });
  });

  it('rejects invalid remote snapshots and commits the rules fallback instead', async () => {
    const dependencies = createDependencies();
    dependencies.compactRemote = vi.fn(async () => ({
      snapshot: { goal: 42 },
      through_turn_id: 'turn-4',
    }));

    const result = await compactConversationContext(
      {
        conversationId: 'conversation-1',
        workspace: '/workspace',
        trigger: 'manual',
        targetTurnId: 'turn-4',
      },
      dependencies
    );

    expect(result.source).toBe('rules');
    expect(dependencies.compactLocal).not.toHaveBeenCalled();
    expect(dependencies.updates.at(-1)?.updates.extra).toEqual({
      context_handoff: expect.objectContaining({
        source: 'rules',
        status: 'fresh',
        last_error_code: 'invalid_model_output',
      }),
    });
  });

  it('reports metadata failure after the file write without claiming a committed revision', async () => {
    const dependencies = createDependencies();
    dependencies.updateConversation = vi
      .fn<(input: TestDependencies['updates'][number]) => Promise<boolean>>()
      .mockImplementation(async (input) => {
        dependencies.updates.push(input);
        return dependencies.updates.length === 1;
      });

    await expect(
      compactConversationContext(
        {
          conversationId: 'conversation-1',
          workspace: '/workspace',
          trigger: 'manual',
          targetTurnId: 'turn-4',
        },
        dependencies
      )
    ).rejects.toMatchObject({ code: 'metadata_write_failed' });

    expect(dependencies.writeFile).toHaveBeenCalledOnce();
    expect(dependencies.emitRefresh).not.toHaveBeenCalled();
  });
});

describe('automatic context compaction policy', () => {
  it('accepts terminal completion when the backend omits optional last-message details', () => {
    expect(isMeaningfulContextTurn(completedTurn())).toBe(true);
    expect(isMeaningfulContextTurn(completedTurn({ state: 'error' }))).toBe(false);
    expect(
      isMeaningfulContextTurn(completedTurn({ last_message: { ...completedTurn().last_message, content: '' } }))
    ).toBe(false);
    expect(
      isMeaningfulContextTurn(completedTurn({ last_message: { ...completedTurn().last_message, type: 'tool' } }))
    ).toBe(false);
    expect(
      isMeaningfulContextTurn(
        completedTurn({
          last_message: {
            content: null,
            created_at: 100,
          },
        })
      )
    ).toBe(true);
  });

  it('compacts context after every completed turn', () => {
    expect(
      shouldAutoCompactContext({
        hasContext: false,
        turnsSinceCompaction: 1,
        previousBudgetStatus: 'healthy',
        nextBudgetStatus: 'healthy',
      })
    ).toBe(true);
    expect(
      shouldAutoCompactContext({
        hasContext: true,
        turnsSinceCompaction: 1,
        previousBudgetStatus: 'healthy',
        nextBudgetStatus: 'healthy',
      })
    ).toBe(true);
    expect(
      shouldAutoCompactContext({
        hasContext: true,
        turnsSinceCompaction: 3,
        previousBudgetStatus: 'healthy',
        nextBudgetStatus: 'healthy',
      })
    ).toBe(true);
    expect(
      shouldAutoCompactContext({
        hasContext: true,
        turnsSinceCompaction: 1,
        previousBudgetStatus: 'healthy',
        nextBudgetStatus: 'watch',
      })
    ).toBe(true);
    expect(
      shouldAutoCompactContext({
        hasContext: true,
        turnsSinceCompaction: 1,
        previousBudgetStatus: 'watch',
        nextBudgetStatus: 'watch',
      })
    ).toBe(true);
  });

  it('starts invisible compaction after the first completed turn when last-message details are omitted', async () => {
    let listener: ((event: IConversationTurnCompletedEvent) => void) | undefined;
    const runCompaction = vi.fn(async () => ({
      fileName: 'Context.md',
      filePath: '/workspace/Context.md',
      markdown: '# Context',
      snapshot,
      source: 'llm' as const,
      throughTurnId: 'turn-1',
    }));
    const dependencies = {
      subscribeTurnCompleted: vi.fn((next: (event: IConversationTurnCompletedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
      getConversation: vi.fn(async () => conversation),
      updateConversation: vi.fn(async () => true),
      runCompaction,
      now: () => 100,
    };

    renderHook(() =>
      useContextCompaction({
        conversationId: 'conversation-1',
        workspace: '/workspace',
        enabled: true,
        dependencies,
      })
    );

    act(() =>
      listener?.(
        completedTurn({
          last_message: {
            content: null,
            created_at: 100,
          },
        })
      )
    );

    await waitFor(() =>
      expect(runCompaction).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'auto', targetTurnId: 'turn-1' }))
    );
  });

  it('derives the runtime budget status from the per-model window when no context limit is stored', async () => {
    let listener: ((event: IConversationTurnCompletedEvent) => void) | undefined;
    const runCompaction = vi.fn(async () => ({
      fileName: 'Context.md',
      filePath: '/workspace/Context.md',
      markdown: '# Context',
      snapshot,
      source: 'llm' as const,
      throughTurnId: 'turn-1',
    }));
    const budgetConversation: Extract<TChatConversation, { type: 'aionrs' }> = {
      ...conversation,
      model: { ...conversation.model, use_model: 'minimax-m2.5' },
      extra: {
        ...conversation.extra,
        // No last_context_limit — aionrs conversations never receive one.
        last_token_usage: { total_tokens: 180_000 },
        context_handoff: {
          ...conversation.extra.context_handoff,
          snapshot,
        },
      },
    };
    const dependencies = {
      subscribeTurnCompleted: vi.fn((next: (event: IConversationTurnCompletedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
      getConversation: vi.fn(async () => budgetConversation),
      updateConversation: vi.fn(async () => true),
      runCompaction,
      now: () => 100,
    };

    renderHook(() =>
      useContextCompaction({
        conversationId: 'conversation-1',
        workspace: '/workspace',
        enabled: true,
        dependencies,
      })
    );

    act(() => listener?.(completedTurn()));

    await waitFor(() =>
      expect(runCompaction).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'auto', budgetStatus: 'compress' }))
    );
  });

  it('marks an interrupted compaction as pending when the hook mounts', async () => {
    const updateConversation = vi.fn(async () => true);
    const interruptedConversation: Extract<TChatConversation, { type: 'aionrs' }> = {
      ...conversation,
      extra: {
        ...conversation.extra,
        context_handoff: {
          ...conversation.extra.context_handoff,
          source: 'llm',
          status: 'updating',
          turns_since_compaction: 1,
        },
      },
    };
    const dependencies = {
      subscribeTurnCompleted: vi.fn(() => vi.fn()),
      getConversation: vi.fn(async () => interruptedConversation),
      updateConversation,
      runCompaction: vi.fn(),
      now: () => 200,
    };

    renderHook(() =>
      useContextCompaction({
        conversationId: 'conversation-1',
        workspace: '/workspace',
        enabled: true,
        dependencies,
      })
    );

    await waitFor(() =>
      expect(updateConversation).toHaveBeenCalledWith({
        id: 'conversation-1',
        updates: {
          extra: {
            context_handoff: expect.objectContaining({
              source: 'llm',
              status: 'stale',
              turns_since_compaction: 1,
              last_error_code: 'interrupted',
            }),
          },
        },
        merge_extra: true,
      })
    );
  });

  it('ignores failed and tool-only completion events', async () => {
    let listener: ((event: IConversationTurnCompletedEvent) => void) | undefined;
    const runCompaction = vi.fn();
    const dependencies = {
      subscribeTurnCompleted: vi.fn((next: (event: IConversationTurnCompletedEvent) => void) => {
        listener = next;
        return vi.fn();
      }),
      getConversation: vi.fn(async () => conversation),
      updateConversation: vi.fn(async () => true),
      runCompaction,
      now: () => 100,
    };

    renderHook(() =>
      useContextCompaction({
        conversationId: 'conversation-1',
        workspace: '/workspace',
        enabled: true,
        dependencies,
      })
    );

    act(() => {
      listener?.(completedTurn({ state: 'error' }));
      listener?.(completedTurn({ last_message: { ...completedTurn().last_message, type: 'tool' } }));
    });

    await Promise.resolve();
    expect(runCompaction).not.toHaveBeenCalled();
  });

  it('coalesces requests received during a compaction into one follow-up run', async () => {
    let resolveFirst: ((result: CompactConversationContextResult) => void) | undefined;
    const firstResult: CompactConversationContextResult = {
      fileName: 'Context.md',
      filePath: '/workspace/Context.md',
      markdown: '# First',
      snapshot,
      source: 'llm',
      throughTurnId: 'turn-1',
    };
    const secondResult: CompactConversationContextResult = {
      ...firstResult,
      markdown: '# Second',
      throughTurnId: 'turn-2',
    };
    const runCompaction = vi
      .fn<(input: { trigger: string }) => Promise<CompactConversationContextResult>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(secondResult);
    const dependencies = {
      subscribeTurnCompleted: vi.fn(() => vi.fn()),
      getConversation: vi.fn(async () => conversation),
      updateConversation: vi.fn(async () => true),
      runCompaction,
      now: () => 100,
    };
    const { result } = renderHook(() =>
      useContextCompaction({
        conversationId: 'conversation-1',
        workspace: '/workspace',
        dependencies,
      })
    );

    let firstPromise: Promise<CompactConversationContextResult | null> | undefined;
    act(() => {
      firstPromise = result.current.compact('manual');
      void result.current.compact('handoff', 'turn-2');
    });
    expect(runCompaction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.(firstResult);
      await firstPromise;
    });

    expect(runCompaction).toHaveBeenCalledTimes(2);
    expect(runCompaction).toHaveBeenLastCalledWith(
      expect.objectContaining({ trigger: 'handoff', targetTurnId: 'turn-2' })
    );
  });

  it('unsubscribes from completed turns on unmount', () => {
    const unsubscribe = vi.fn();
    const dependencies = {
      subscribeTurnCompleted: vi.fn(() => unsubscribe),
      getConversation: vi.fn(async () => conversation),
      updateConversation: vi.fn(async () => true),
      runCompaction: vi.fn(),
      now: () => 100,
    };
    const { unmount } = renderHook(() =>
      useContextCompaction({
        conversationId: 'conversation-1',
        workspace: '/workspace',
        dependencies,
      })
    );

    unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('native context actions', () => {
  it('persists a user-owned pin before compacting the context', async () => {
    const updateConversation = vi.fn(async () => true);
    const compactContext = vi.fn(async () => ({
      fileName: 'Context.md',
      filePath: '/workspace/Context.md',
      markdown: '# Context',
      snapshot,
      source: 'llm' as const,
      throughTurnId: 'turn-4',
    }));

    const result = await pinConversationContext(
      {
        conversationId: 'conversation-1',
        workspace: '/workspace',
        text: 'Keep accessibility checks in the acceptance criteria.',
      },
      {
        getConversation: vi.fn(async () => conversation),
        updateConversation,
        compactContext,
        createId: () => 'pin-2',
        now: () => 200,
      }
    );

    expect(updateConversation).toHaveBeenCalledWith({
      id: 'conversation-1',
      updates: {
        extra: {
          context_handoff: expect.objectContaining({
            pinned_context: expect.arrayContaining([
              expect.objectContaining({
                id: 'pin-2',
                content: 'Keep accessibility checks in the acceptance criteria.',
                source: 'manual',
              }),
            ]),
          }),
        },
      },
      merge_extra: true,
    });
    expect(compactContext).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      workspace: '/workspace',
      trigger: 'manual',
    });
    expect(result.pin.id).toBe('pin-2');
  });

  it('compacts stale context, rereads the edited file, and creates a clean continuation', async () => {
    const staleConversation: Extract<TChatConversation, { type: 'aionrs' }> = {
      ...conversation,
      status: 'running',
      runtime: {
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        pending_confirmations: 0,
        turn_id: 'turn-5',
      },
      assistant: {
        id: 'assistant-1',
        source: 'preset',
        name: 'Forge',
        avatar: '',
        backend: 'aionrs',
      },
      extra: {
        ...conversation.extra,
        skills: ['context-manager'],
        mcp_server_ids: ['mcp-1'],
        mcp_servers: ['Filesystem'],
        last_token_usage: { total_tokens: 12_000 },
        context_handoff: {
          ...conversation.extra.context_handoff,
          context_file_path: '/workspace/Context.md',
          context_file_name: 'Context.md',
          revision: 4,
          status: 'stale',
          source: 'llm',
          last_compacted_turn_id: 'turn-4',
          turns_since_compaction: 1,
          last_error_code: 'provider_timeout',
        },
      },
    };
    const refreshedConversation: Extract<TChatConversation, { type: 'aionrs' }> = {
      ...staleConversation,
      extra: {
        ...staleConversation.extra,
        context_handoff: {
          ...staleConversation.extra.context_handoff,
          status: 'fresh',
          turns_since_compaction: 0,
        },
      },
    };
    const getConversation = vi
      .fn<() => Promise<TChatConversation | null>>()
      .mockResolvedValueOnce(staleConversation)
      .mockResolvedValue(refreshedConversation);
    const compactContext = vi.fn(async () => null);
    const createConversation = vi.fn(async ({ conversation: next }: { conversation: TChatConversation }) => next);

    const result = await handoffConversationContext(
      { conversationId: 'conversation-1', workspace: '/workspace' },
      {
        getConversation,
        compactContext,
        readFile: vi.fn(async () => '# Edited Context\n\nKeep this exact edit.'),
        createConversation,
        createId: () => 'conversation-2',
        now: () => 300,
      }
    );

    expect(compactContext).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      workspace: '/workspace',
      trigger: 'handoff',
    });
    expect(createConversation).toHaveBeenCalledWith({
      conversation: expect.objectContaining({
        id: 'conversation-2',
        assistant: staleConversation.assistant,
        model: staleConversation.model,
        runtime: undefined,
        status: undefined,
        extra: expect.objectContaining({
          workspace: '/workspace',
          skills: ['context-manager'],
          mcp_server_ids: ['mcp-1'],
          context: '# Edited Context\n\nKeep this exact edit.',
          context_file_name: 'Context.md',
          context_handoff: expect.objectContaining({
            pinned_context: staleConversation.extra.context_handoff?.pinned_context,
            source: 'user',
            status: 'fresh',
            turns_since_compaction: 0,
          }),
        }),
      }),
    });
    const nextHandoff = result.conversation.extra.context_handoff;
    expect(nextHandoff).not.toHaveProperty('revision');
    expect(nextHandoff).not.toHaveProperty('last_compacted_turn_id');
    expect(nextHandoff).not.toHaveProperty('last_error_code');
    expect(result.conversation.extra).not.toHaveProperty('last_token_usage');
  });

  it('skips compaction when Context.md is already fresh', async () => {
    const freshConversation: Extract<TChatConversation, { type: 'aionrs' }> = {
      ...conversation,
      extra: {
        ...conversation.extra,
        context_handoff: {
          ...conversation.extra.context_handoff,
          context_file_path: '/workspace/Context.md',
          context_file_name: 'Context.md',
          status: 'fresh',
          turns_since_compaction: 0,
        },
      },
    };
    const compactContext = vi.fn();

    await handoffConversationContext(
      { conversationId: 'conversation-1', workspace: '/workspace' },
      {
        getConversation: vi.fn(async () => freshConversation),
        compactContext,
        readFile: vi.fn(async () => '# Fresh Context'),
        createConversation: vi.fn(async ({ conversation: next }) => next),
        createId: () => 'conversation-2',
        now: () => 300,
      }
    );

    expect(compactContext).not.toHaveBeenCalled();
  });
});
