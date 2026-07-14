/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationTurnCompletedEvent, IResponseMessage } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ListChangedEvent = { action: 'deleted' | 'created' | 'updated'; conversation_id: string };
type ConversationListResult = { items: TChatConversation[] };
type ConfirmationEvent = { conversation_id: string; id: string };

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const harness = vi.hoisted(() => ({
  getUserConversations: vi.fn(),
  getConversation: vi.fn(),
  writeRendererLog: vi.fn().mockResolvedValue(undefined),
  listChangedHandler: undefined as ((event: ListChangedEvent) => void) | undefined,
  responseStreamHandler: undefined as ((event: IResponseMessage) => void) | undefined,
  turnCompletedHandler: undefined as ((event: IConversationTurnCompletedEvent) => void) | undefined,
  confirmationAddedHandler: undefined as ((event: ConfirmationEvent) => void) | undefined,
  confirmationRemovedHandler: undefined as ((event: ConfirmationEvent) => void) | undefined,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      writeRendererLog: {
        invoke: harness.writeRendererLog,
      },
    },
    database: {
      getUserConversations: {
        invoke: harness.getUserConversations,
      },
    },
    conversation: {
      get: {
        invoke: harness.getConversation,
      },
      listChanged: {
        on: vi.fn((handler: (event: ListChangedEvent) => void) => {
          harness.listChangedHandler = handler;
          return () => {};
        }),
      },
      responseStream: {
        on: vi.fn((handler: (event: IResponseMessage) => void) => {
          harness.responseStreamHandler = handler;
          return () => {};
        }),
      },
      turnCompleted: {
        on: vi.fn((handler: (event: IConversationTurnCompletedEvent) => void) => {
          harness.turnCompletedHandler = handler;
          return () => {};
        }),
      },
      confirmation: {
        add: {
          on: vi.fn((handler: (event: ConfirmationEvent) => void) => {
            harness.confirmationAddedHandler = handler;
            return () => {};
          }),
        },
        remove: {
          on: vi.fn((handler: (event: ConfirmationEvent) => void) => {
            harness.confirmationRemovedHandler = handler;
            return () => {};
          }),
        },
      },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  addEventListener: vi.fn(),
}));

const conversation = {
  id: 'conversation-1',
  name: 'Review the release notes',
  created_at: 1,
  modified_at: 1,
  type: 'acp',
  model: { provider: 'openai', model: 'gpt-5' },
  extra: { backend: 'codex' },
} satisfies TChatConversation;

const waitingRuntime = {
  state: 'waiting_confirmation',
  can_send_message: false,
  has_task: true,
  task_status: 'running',
  is_processing: true,
  pending_confirmations: 1,
  turn_id: 'turn-1',
} satisfies IConversationTurnCompletedEvent['runtime'];

const idleRuntime = {
  state: 'idle',
  can_send_message: true,
  has_task: true,
  task_status: 'finished',
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
} satisfies IConversationTurnCompletedEvent['runtime'];

const runningRuntime = {
  state: 'running',
  can_send_message: false,
  has_task: true,
  task_status: 'running',
  is_processing: true,
  pending_confirmations: 0,
  turn_id: 'turn-1',
} satisfies IConversationTurnCompletedEvent['runtime'];

const buildTurnCompletedEvent = (
  runtime: IConversationTurnCompletedEvent['runtime'],
  state: IConversationTurnCompletedEvent['state']
): IConversationTurnCompletedEvent => ({
  session_id: conversation.id,
  turn_id: runtime.turn_id ?? 'turn-1',
  status: 'finished',
  state,
  detail: '',
  can_send_message: runtime.can_send_message,
  runtime,
  workspace: '',
  model: { platform: 'codex', name: 'Codex', use_model: 'gpt-5' },
  last_message: { content: null, created_at: 1 },
});

const renderConversationListSync = async () => {
  const { useConversationListSync } =
    await import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
  const rendered = renderHook(() => useConversationListSync());
  await waitFor(() => expect(rendered.result.current.conversations).toHaveLength(1));
  return rendered;
};

describe('useConversationListSync sidebar runtime state', () => {
  beforeEach(() => {
    vi.resetModules();
    harness.getUserConversations.mockReset();
    harness.getUserConversations
      .mockResolvedValueOnce({ items: [conversation] })
      .mockReturnValue(new Promise(() => {}));
    harness.getConversation.mockReset();
    harness.getConversation.mockReturnValue(new Promise(() => {}));
    harness.listChangedHandler = undefined;
    harness.responseStreamHandler = undefined;
    harness.turnCompletedHandler = undefined;
    harness.confirmationAddedHandler = undefined;
    harness.confirmationRemovedHandler = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies approval runtime from turn completion before database reconciliation', async () => {
    const { result } = await renderConversationListSync();

    act(() => {
      harness.turnCompletedHandler?.(buildTurnCompletedEvent(waitingRuntime, 'ai_waiting_confirmation'));
    });

    expect(result.current.conversations[0]?.runtime).toEqual(waitingRuntime);
  });

  it('refreshes a known conversation when the permission stream arrives', async () => {
    harness.getConversation.mockResolvedValueOnce({ ...conversation, runtime: waitingRuntime });
    const { result } = await renderConversationListSync();

    act(() => {
      harness.responseStreamHandler?.({
        type: 'acp_permission',
        data: {},
        msg_id: 'message-1',
        conversation_id: conversation.id,
      });
    });

    await waitFor(() => expect(result.current.conversations[0]?.runtime).toEqual(waitingRuntime));
  });

  it('refreshes a waiting conversation when its confirmation is removed', async () => {
    harness.getUserConversations.mockReset();
    harness.getUserConversations.mockResolvedValueOnce({ items: [{ ...conversation, runtime: waitingRuntime }] });
    harness.getConversation.mockResolvedValueOnce({ ...conversation, runtime: runningRuntime });
    const { result } = await renderConversationListSync();

    act(() => {
      harness.confirmationRemovedHandler?.({ conversation_id: conversation.id, id: 'confirmation-1' });
    });

    await waitFor(() => expect(result.current.conversations[0]?.runtime).toEqual(runningRuntime));
  });

  it('keeps detail runtime when it arrives before the conversation list', async () => {
    const listRequest = createDeferred<ConversationListResult>();
    harness.getUserConversations.mockReset();
    harness.getUserConversations.mockReturnValueOnce(listRequest.promise);
    harness.getConversation.mockResolvedValueOnce({ ...conversation, runtime: waitingRuntime });
    const { useConversationListSync } =
      await import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
    const rendered = renderHook(() => useConversationListSync());

    act(() => {
      rendered.result.current.refreshConversationRuntime(conversation.id);
    });
    await waitFor(() => expect(harness.getConversation).toHaveBeenCalledWith({ id: conversation.id }));

    await act(async () => {
      listRequest.resolve({ items: [conversation] });
      await listRequest.promise;
    });

    await waitFor(() => expect(rendered.result.current.conversations[0]?.runtime).toEqual(waitingRuntime));
  });

  it('does not let a pending detail request overwrite completed runtime', async () => {
    const detailRequest = createDeferred<TChatConversation>();
    harness.getConversation.mockReset();
    harness.getConversation.mockReturnValueOnce(detailRequest.promise);
    const { result } = await renderConversationListSync();

    act(() => {
      result.current.refreshConversationRuntime(conversation.id);
      harness.turnCompletedHandler?.(buildTurnCompletedEvent(idleRuntime, 'ai_waiting_input'));
    });
    expect(result.current.conversations[0]?.runtime).toEqual(idleRuntime);

    await act(async () => {
      detailRequest.resolve({ ...conversation, runtime: waitingRuntime });
      await detailRequest.promise;
    });

    expect(result.current.conversations[0]?.runtime).toEqual(idleRuntime);
  });

  it('does not let an older refresh overwrite runtime from turn completion', async () => {
    const staleRefresh = createDeferred<ConversationListResult>();
    const latestRefresh = createDeferred<ConversationListResult>();
    harness.getUserConversations.mockReset();
    harness.getUserConversations
      .mockResolvedValueOnce({ items: [conversation] })
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(latestRefresh.promise);
    const { result } = await renderConversationListSync();

    act(() => {
      harness.listChangedHandler?.({ action: 'updated', conversation_id: conversation.id });
      harness.turnCompletedHandler?.(buildTurnCompletedEvent(waitingRuntime, 'ai_waiting_confirmation'));
    });
    expect(result.current.conversations[0]?.runtime).toEqual(waitingRuntime);

    await act(async () => {
      staleRefresh.resolve({ items: [conversation] });
      await staleRefresh.promise;
    });

    expect(result.current.conversations[0]?.runtime).toEqual(waitingRuntime);
    latestRefresh.resolve({ items: [{ ...conversation, runtime: waitingRuntime }] });
  });

  it('restarts the completion timestamp and clears it when the conversation is deleted', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { result } = await renderConversationListSync();

    act(() => {
      harness.turnCompletedHandler?.(buildTurnCompletedEvent(idleRuntime, 'ai_waiting_input'));
    });
    expect(result.current.getRecentCompletionAt(conversation.id)).toBe(1_000);

    now.mockReturnValue(2_000);
    act(() => {
      harness.turnCompletedHandler?.(buildTurnCompletedEvent(idleRuntime, 'ai_waiting_input'));
    });
    expect(result.current.getRecentCompletionAt(conversation.id)).toBe(2_000);

    act(() => {
      harness.listChangedHandler?.({ action: 'deleted', conversation_id: conversation.id });
    });
    expect(result.current.getRecentCompletionAt(conversation.id)).toBeUndefined();
  });

  it('records recent completion for the active conversation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(3_000);
    const { result } = await renderConversationListSync();

    act(() => {
      harness.turnCompletedHandler?.(buildTurnCompletedEvent(idleRuntime, 'ai_waiting_input'));
    });

    expect(result.current.getRecentCompletionAt(conversation.id)).toBe(3_000);
  });
});
