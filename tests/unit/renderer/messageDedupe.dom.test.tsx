/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageText } from '@/common/chat/chatLib';
import {
  MessageListProvider,
  useAddOrUpdateMessage,
  useMessageList,
  usePrependHistoryPage,
  useReplaceWithAnchorWindow,
} from '@/renderer/pages/conversation/Messages/hooks';

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      userCreated: {
        on: vi.fn().mockReturnValue(() => {}),
      },
    },
    database: {
      getConversationMessages: {
        invoke: vi.fn(),
      },
    },
  },
}));

const CONVERSATION_ID = 'conv-1';

const textMessage = (
  id: string,
  msg_id: string,
  content: string,
  created_at: number,
  contentMetadata: Omit<IMessageText['content'], 'content'> = {}
): IMessageText => ({
  id,
  msg_id,
  conversation_id: CONVERSATION_ID,
  type: 'text',
  position: 'left',
  created_at,
  content: {
    content,
    ...contentMetadata,
  },
});

const userMessage = (id: string, msg_id: string, content: string, created_at: number): IMessageText => ({
  ...textMessage(id, msg_id, content, created_at),
  position: 'right',
});

function TestWrapper({ children }: PropsWithChildren): JSX.Element {
  return <MessageListProvider value={[]}>{children}</MessageListProvider>;
}

function useMessageHarness() {
  return {
    addOrUpdateMessage: useAddOrUpdateMessage(),
    prependHistoryPage: usePrependHistoryPage(),
    replaceWithAnchorWindow: useReplaceWithAnchorWindow(),
    messages: useMessageList(),
  };
}

async function flushMessageQueue(): Promise<void> {
  await act(async () => {
    vi.runAllTimers();
  });
}

describe('message dedupe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not show the same assistant answer from live stream and persisted history twice', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(textMessage('live-answer', 'live-msg', 'same final answer', 100));
    });
    await flushMessageQueue();

    act(() => {
      result.current.replaceWithAnchorWindow(CONVERSATION_ID, [
        userMessage('persisted-user', 'user-msg', 'question', 50),
        textMessage('persisted-answer', 'persisted-msg', 'same final answer', 200),
      ]);
    });

    expect(result.current.messages.map((message) => message.id)).toEqual(['persisted-user', 'persisted-answer']);
  });

  it('keeps one exact assistant reply when different live message ids arrive in the same user turn', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });
    const preferredAnswer = textMessage('live-answer-2', 'live-msg-2', 'same final answer', 102, { replace: true });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('live-answer-1', 'live-msg-1', 'same final answer', 101));
      result.current.addOrUpdateMessage(preferredAnswer, true);
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toEqual(preferredAnswer);
  });

  it('keeps near-matching assistant replies in the same user turn', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-1', 'answer-msg-1', 'Done.', 101));
      result.current.addOrUpdateMessage(textMessage('answer-2', 'answer-msg-2', 'Done with details.', 102));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.id)).toEqual(['user-1', 'answer-1', 'answer-2']);
  });

  it('keeps identical assistant replies in different user turns', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'first question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-1', 'answer-msg-1', 'Done.', 101));
      result.current.addOrUpdateMessage(userMessage('user-2', 'user-msg-2', 'second question', 200));
      result.current.addOrUpdateMessage(textMessage('answer-2', 'answer-msg-2', 'Done.', 201));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.id)).toEqual(['user-1', 'answer-1', 'user-2', 'answer-2']);
  });

  it('keeps teammate replies even when their text matches', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(
        textMessage('teammate-1', 'teammate-msg-1', 'Done.', 101, { teammateMessage: true })
      );
      result.current.addOrUpdateMessage(
        textMessage('teammate-2', 'teammate-msg-2', 'Done.', 102, { teammateMessage: true })
      );
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.id)).toEqual(['user-1', 'teammate-1', 'teammate-2']);
  });

  it('dedupes exact assistant replies in an initial persisted window', () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });
    const preferredAnswer = textMessage('persisted-answer-2', 'persisted-msg-2', 'same final answer', 102, {
      replace: true,
    });

    act(() => {
      result.current.replaceWithAnchorWindow(CONVERSATION_ID, [
        userMessage('persisted-user', 'persisted-user-msg', 'question', 100),
        textMessage('persisted-answer-1', 'persisted-msg-1', 'same final answer', 101),
        preferredAnswer,
      ]);
    });

    expect(result.current.messages).toEqual([
      userMessage('persisted-user', 'persisted-user-msg', 'question', 100),
      preferredAnswer,
    ]);
  });

  it('dedupes exact assistant replies when older history is prepended', () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });
    const preferredAnswer = textMessage('persisted-answer', 'persisted-msg', 'same final answer', 101, {
      replace: true,
    });

    act(() => {
      result.current.replaceWithAnchorWindow(CONVERSATION_ID, [
        textMessage('live-answer', 'live-msg', 'same final answer', 102),
      ]);
      result.current.prependHistoryPage([
        userMessage('persisted-user', 'persisted-user-msg', 'question', 100),
        preferredAnswer,
      ]);
    });

    expect(result.current.messages).toEqual([
      userMessage('persisted-user', 'persisted-user-msg', 'question', 100),
      preferredAnswer,
    ]);
  });
});
