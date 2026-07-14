/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { useAionrsMessage } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { getLocalTokenUsageSummary } from '@/renderer/pages/conversation/utils/localTokenUsage';

const { mergeLiveMessageMock, responseStreamOnMock, responseStreamHandlerRef, updateConversationInvokeMock } =
  vi.hoisted(() => ({
    mergeLiveMessageMock: vi.fn(),
    responseStreamOnMock: vi.fn(),
    responseStreamHandlerRef: {
      current: undefined as ((message: IResponseMessage) => void) | undefined,
    },
    updateConversationInvokeMock: vi.fn(),
  }));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMergeLiveMessage: () => mergeLiveMessageMock,
}));

vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  logStreamTerminalObserved: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: responseStreamOnMock.mockImplementation((handler: (message: IResponseMessage) => void) => {
          responseStreamHandlerRef.current = handler;
          return vi.fn();
        }),
      },
      update: {
        invoke: updateConversationInvokeMock,
      },
    },
  },
}));

describe('useAionrsMessage runtime state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    updateConversationInvokeMock.mockResolvedValue(undefined);
    responseStreamHandlerRef.current = undefined;
    localStorage.clear();
  });

  it('clears active tool state when the stream finishes', async () => {
    const { result } = renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'tool_group',
        data: [{ status: 'Executing', name: 'Read' }],
        msg_id: 'msg-1',
        turn_id: 'turn-1',
        conversation_id: 'conv-1',
      });
    });

    expect(result.current.running).toBe(true);

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: null,
        msg_id: 'msg-1',
        turn_id: 'turn-1',
        conversation_id: 'conv-1',
      });
    });

    expect(result.current.running).toBe(false);
  });

  it('records explicit completed-turn usage once with a stable event id', async () => {
    renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(responseStreamHandlerRef.current).toBeDefined();
    });

    const completedTurn: IResponseMessage = {
      type: 'finish',
      data: { input_tokens: 10, output_tokens: 5 },
      msg_id: 'message-1',
      turn_id: 'turn-1',
      conversation_id: 'conv-1',
    };

    act(() => {
      responseStreamHandlerRef.current?.(completedTurn);
      responseStreamHandlerRef.current?.(completedTurn);
    });

    const events = JSON.parse(localStorage.getItem('aionui.local-token-usage.v1') ?? '{"events":[]}').events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'conv-1:turn-1',
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(getLocalTokenUsageSummary()).toEqual({ today: 15, weekToDate: 15, monthToDate: 15 });
  });

  it('records diagnostic estimates when completed turns omit provider usage', async () => {
    renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(responseStreamHandlerRef.current).toBeDefined();
    });

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'tips',
        data: {
          content: 'Token watermark override: provider=0, local_estimate=11768, using=11768',
        },
        msg_id: 'message-1',
        turn_id: 'turn-1',
        conversation_id: 'conv-1',
      });
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: null,
        msg_id: 'message-1',
        turn_id: 'turn-1',
        conversation_id: 'conv-1',
      });
      responseStreamHandlerRef.current?.({
        type: 'tips',
        data: {
          content: 'Token watermark override: provider=0, local_estimate=37034, using=37034',
        },
        msg_id: 'message-1',
        turn_id: 'turn-1',
        conversation_id: 'conv-1',
      });
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: {},
        msg_id: 'message-1',
        turn_id: 'turn-1',
        conversation_id: 'conv-1',
      });
    });

    expect(getLocalTokenUsageSummary()).toEqual({ today: 48_802, weekToDate: 48_802, monthToDate: 48_802 });
  });

  it('prefers explicit provider usage over a pending diagnostic estimate', async () => {
    renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(responseStreamHandlerRef.current).toBeDefined();
    });

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'tips',
        data: {
          content: 'Token watermark override: provider=0, local_estimate=11768, using=11768',
        },
        msg_id: 'message-1',
        turn_id: 'turn-1',
        conversation_id: 'conv-1',
      });
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: { input_tokens: 10, output_tokens: 5 },
        msg_id: 'message-1',
        turn_id: 'turn-1',
        conversation_id: 'conv-1',
      });
    });

    expect(getLocalTokenUsageSummary()).toEqual({ today: 15, weekToDate: 15, monthToDate: 15 });
  });

  it('does not record a completed turn without explicit usage', async () => {
    renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(responseStreamHandlerRef.current).toBeDefined();
    });

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: {},
        msg_id: 'message-1',
        conversation_id: 'conv-1',
      });
    });

    expect(getLocalTokenUsageSummary()).toEqual({ today: 0, weekToDate: 0, monthToDate: 0 });
  });

  it('records output-only usage with the message id fallback', async () => {
    renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(responseStreamHandlerRef.current).toBeDefined();
    });

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: { output_tokens: 8 },
        msg_id: 'message-1',
        conversation_id: 'conv-1',
      });
    });

    const events = JSON.parse(localStorage.getItem('aionui.local-token-usage.v1') ?? '{"events":[]}').events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'conv-1:message-1',
      inputTokens: 0,
      outputTokens: 8,
    });
    expect(updateConversationInvokeMock).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 'malformed'])(
    'keeps valid output when input usage is invalid: %p',
    async (invalidInputTokens) => {
      renderHook(() => useAionrsMessage('conv-1'));

      await waitFor(() => {
        expect(responseStreamHandlerRef.current).toBeDefined();
      });

      act(() => {
        responseStreamHandlerRef.current?.({
          type: 'finish',
          data: { input_tokens: invalidInputTokens, output_tokens: 8 },
          msg_id: 'message-1',
          conversation_id: 'conv-1',
        });
      });

      const events = JSON.parse(localStorage.getItem('aionui.local-token-usage.v1') ?? '{"events":[]}').events;
      expect(events).toEqual([
        expect.objectContaining({
          id: 'conv-1:message-1',
          inputTokens: 0,
          outputTokens: 8,
        }),
      ]);
      expect(updateConversationInvokeMock).not.toHaveBeenCalled();
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 'malformed'])(
    'keeps valid input when output usage is invalid: %p',
    async (invalidOutputTokens) => {
      renderHook(() => useAionrsMessage('conv-1'));

      await waitFor(() => {
        expect(responseStreamHandlerRef.current).toBeDefined();
      });

      act(() => {
        responseStreamHandlerRef.current?.({
          type: 'finish',
          data: { input_tokens: 4, output_tokens: invalidOutputTokens },
          msg_id: 'message-1',
          conversation_id: 'conv-1',
        });
      });

      const events = JSON.parse(localStorage.getItem('aionui.local-token-usage.v1') ?? '{"events":[]}').events;
      expect(events).toEqual([
        expect.objectContaining({
          id: 'conv-1:message-1',
          inputTokens: 4,
          outputTokens: 0,
        }),
      ]);
      expect(updateConversationInvokeMock).toHaveBeenCalledWith({
        id: 'conv-1',
        updates: { extra: { last_token_usage: { total_tokens: 4 } } },
        merge_extra: true,
      });
    }
  );
});
