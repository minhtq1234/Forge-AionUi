/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { IMessageText } from '@/common/chat/chatLib';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  useAddOrUpdateMessage,
  useMessageLstCache,
  useMessageList,
  usePrependHistoryPage,
  useRemoveMessageByMsgId,
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

function CacheWrapper({ children }: PropsWithChildren): JSX.Element {
  return (
    <MessageListLoadingProvider value={false}>
      <MessagePaginationProvider
        value={{ hasMoreBefore: false, hasMoreAfter: false, isLoadingBefore: false, isLoadingAnchor: false }}
      >
        <MessageListProvider value={[]}>{children}</MessageListProvider>
      </MessagePaginationProvider>
    </MessageListLoadingProvider>
  );
}

function useMessageHarness() {
  return {
    addOrUpdateMessage: useAddOrUpdateMessage(),
    prependHistoryPage: usePrependHistoryPage(),
    removeMessageByMsgId: useRemoveMessageByMsgId(),
    replaceWithAnchorWindow: useReplaceWithAnchorWindow(),
    messages: useMessageList(),
  };
}

function useSharedMessageHarness() {
  return {
    firstAddOrUpdateMessage: useAddOrUpdateMessage(),
    secondAddOrUpdateMessage: useAddOrUpdateMessage(),
    messages: useMessageList(),
  };
}

function useCacheMessageHarness() {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  useMessageLstCache(CONVERSATION_ID);
  return {
    addOrUpdateMessage,
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

  it('routes a continuation through an alias created by initial cache hydration', async () => {
    type MessagePage = Awaited<ReturnType<typeof ipcBridge.database.getConversationMessages.invoke>>;
    let resolveHydration!: (page: MessagePage) => void;
    const hydration = new Promise<MessagePage>((resolve) => {
      resolveHydration = resolve;
    });
    vi.mocked(ipcBridge.database.getConversationMessages.invoke).mockReturnValueOnce(hydration);

    const { result } = renderHook(() => useCacheMessageHarness(), {
      wrapper: CacheWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(textMessage('live-answer', 'live-msg', 'same final answer', 102));
    });
    await flushMessageQueue();

    await act(async () => {
      resolveHydration({
        items: [
          userMessage('persisted-user', 'persisted-user-msg', 'question', 100),
          textMessage('persisted-answer', 'persisted-msg', 'same final answer', 101),
        ],
        oldest_cursor: null,
        newest_cursor: null,
        has_more_before: false,
        has_more_after: false,
      });
      await hydration;
    });

    act(() => {
      result.current.addOrUpdateMessage(textMessage('live-tail', 'live-msg', ' with more detail', 103));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: 'persisted-answer',
      msg_id: 'persisted-msg',
      content: { content: 'same final answer with more detail' },
    });
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

  it('routes a continuation from a deduped tie loser to the retained live reply', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-1', 'answer-msg-1', 'same final answer', 101));
      result.current.addOrUpdateMessage(textMessage('answer-2', 'answer-msg-2', 'same final answer', 102));
    });
    await flushMessageQueue();

    act(() => {
      result.current.addOrUpdateMessage(textMessage('answer-2-tail', 'answer-msg-2', ' with more detail', 103));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: 'answer-1',
      msg_id: 'answer-msg-1',
      content: { content: 'same final answer with more detail' },
    });
  });

  it('preserves a terminal status when contiguous text chunks merge', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage({
        ...textMessage('answer-pending', 'answer-msg', 'Done.', 101),
        status: 'pending',
      });
      result.current.addOrUpdateMessage({
        ...textMessage('answer-finished', 'answer-msg', '', 102),
        status: 'finish',
      });
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ status: 'finish', content: { content: 'Done.' } });
  });

  it('preserves a terminal status when exact cross-id replies dedupe', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage({
        ...textMessage('answer-pending', 'answer-msg-a', 'Done.', 101),
        status: 'pending',
      });
      result.current.addOrUpdateMessage({
        ...textMessage('answer-finished', 'answer-msg-b', 'Done.', 102),
        status: 'finish',
      });
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ status: 'finish', content: { content: 'Done.' } });
  });

  it('invalidates a discarded alias when that alias is removed', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-a', 'msg-a', 'same final answer', 101));
      result.current.addOrUpdateMessage(textMessage('answer-b', 'msg-b', 'same final answer', 102));
    });
    await flushMessageQueue();

    act(() => {
      result.current.removeMessageByMsgId('msg-b');
      result.current.addOrUpdateMessage(textMessage('answer-b-tail', 'msg-b', 'new answer', 103));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.id)).toEqual(['user-1', 'answer-a', 'answer-b-tail']);
    expect(result.current.messages[1]).toMatchObject({ content: { content: 'same final answer' } });
  });

  it('invalidates aliases that target a removed canonical reply', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-a', 'msg-a', 'same final answer', 101));
      result.current.addOrUpdateMessage(textMessage('answer-b', 'msg-b', 'same final answer', 102));
    });
    await flushMessageQueue();

    act(() => {
      result.current.removeMessageByMsgId('msg-a');
      result.current.addOrUpdateMessage(textMessage('answer-b-tail', 'msg-b', 'new answer', 103));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.id)).toEqual(['user-1', 'answer-b-tail']);
  });

  it('shares deduped message aliases across live hooks in the same conversation', async () => {
    const { result } = renderHook(() => useSharedMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.firstAddOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.firstAddOrUpdateMessage(textMessage('answer-1', 'answer-msg-1', 'same final answer', 101));
      result.current.firstAddOrUpdateMessage(textMessage('answer-2', 'answer-msg-2', 'same final answer', 102));
    });
    await flushMessageQueue();

    act(() => {
      result.current.secondAddOrUpdateMessage(textMessage('answer-2-tail', 'answer-msg-2', ' with more detail', 103));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: 'answer-1',
      msg_id: 'answer-msg-1',
      content: { content: 'same final answer with more detail' },
    });
  });

  it('routes a continuation from a deduped replace loser to the preferred live reply', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-1', 'answer-msg-1', 'same final answer', 101));
      result.current.addOrUpdateMessage(
        textMessage('answer-2', 'answer-msg-2', 'same final answer', 102, { replace: true })
      );
    });
    await flushMessageQueue();

    act(() => {
      result.current.addOrUpdateMessage(textMessage('answer-1-tail', 'answer-msg-1', ' with more detail', 103));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: 'answer-2',
      msg_id: 'answer-msg-2',
      content: { content: 'same final answer with more detail' },
    });
  });

  it.each([
    ['paragraph breaks', 'Line one\n\nLine two', 'Line one Line two'],
    ['Markdown hard breaks', 'Line one  \nLine two', 'Line one Line two'],
    ['indented code', 'Result:\n    const x = 1;', 'Result: const x = 1;'],
  ])('keeps replies with distinct %s', async (_caseName, firstContent, secondContent) => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-1', 'answer-msg-1', firstContent, 101));
      result.current.addOrUpdateMessage(textMessage('answer-2', 'answer-msg-2', secondContent, 102));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.id)).toEqual(['user-1', 'answer-1', 'answer-2']);
  });

  it('dedupes exact replies across platform line endings', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-1', 'answer-msg-1', 'Line one\r\nLine two', 101));
      result.current.addOrUpdateMessage(textMessage('answer-2', 'answer-msg-2', 'Line one\nLine two', 102));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.id)).toEqual(['user-1', 'answer-1']);
  });

  it('dedupes replies that differ only by insignificant outer whitespace', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-1', 'answer-msg-1', 'Done.', 101));
      result.current.addOrUpdateMessage(textMessage('answer-2', 'answer-msg-2', ' Done.\n', 102));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.id)).toEqual(['user-1', 'answer-1']);
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

  it('dedupes outer-whitespace variants in an initial persisted window', () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });
    const preferredAnswer = textMessage('persisted-answer-2', 'persisted-msg-2', ' same final answer\n', 102, {
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

  it('routes a continuation through an alias created while older history is prepended', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });
    const preferredAnswer = textMessage('persisted-answer', 'persisted-msg', ' same final answer\n', 101, {
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

    act(() => {
      result.current.addOrUpdateMessage(textMessage('live-tail', 'live-msg', ' with more detail', 103));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: 'persisted-answer',
      msg_id: 'persisted-msg',
      content: { content: ' same final answer\n with more detail' },
    });
  });

  it('routes a continuation through an alias created by anchor replacement', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(textMessage('live-answer', 'live-msg', 'same final answer', 102));
    });
    await flushMessageQueue();

    act(() => {
      result.current.replaceWithAnchorWindow(CONVERSATION_ID, [
        userMessage('persisted-user', 'persisted-user-msg', 'question', 100),
        textMessage('persisted-answer', 'persisted-msg', 'same final answer', 101),
      ]);
    });

    act(() => {
      result.current.addOrUpdateMessage(textMessage('live-tail', 'live-msg', ' with more detail', 103));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: 'persisted-answer',
      msg_id: 'persisted-msg',
      content: { content: 'same final answer with more detail' },
    });
  });

  it('atomically redirects stale aliases when anchor replacement changes the canonical reply', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('user-1', 'user-msg-1', 'question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-a', 'msg-a', 'same final answer', 101));
      result.current.addOrUpdateMessage(textMessage('answer-b', 'msg-b', 'same final answer', 102));
    });
    await flushMessageQueue();

    act(() => {
      result.current.replaceWithAnchorWindow(CONVERSATION_ID, [
        userMessage('user-1', 'user-msg-1', 'question', 100),
        textMessage('answer-b', 'msg-b', 'same final answer', 102, { replace: true }),
      ]);
    });

    act(() => {
      result.current.addOrUpdateMessage(textMessage('answer-a-tail', 'msg-a', ' with more detail', 103));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({
      id: 'answer-b',
      msg_id: 'msg-b',
      content: { content: 'same final answer with more detail' },
    });
  });

  it('preserves a retained live-tail alias across an anchored history gap', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(userMessage('live-user', 'live-user-msg', 'current question', 100));
      result.current.addOrUpdateMessage(textMessage('answer-a', 'msg-a', 'same final answer', 101));
      result.current.addOrUpdateMessage(textMessage('answer-b', 'msg-b', 'same final answer', 102));
    });
    await flushMessageQueue();

    act(() => {
      result.current.replaceWithAnchorWindow(
        CONVERSATION_ID,
        [
          userMessage('anchor-user', 'anchor-user-msg', 'older question', 10),
          textMessage('anchor-answer', 'anchor-answer-msg', 'older answer', 11),
        ],
        { hasMoreAfter: true }
      );
    });

    act(() => {
      result.current.addOrUpdateMessage(textMessage('answer-b-tail', 'msg-b', ' with more detail', 103));
    });
    await flushMessageQueue();

    const liveAnswer = result.current.messages.find((message) => message.id === 'answer-a');
    expect(liveAnswer).toMatchObject({
      msg_id: 'msg-a',
      content: { content: 'same final answer with more detail' },
    });
    expect(result.current.messages.some((message) => message.id === 'answer-b-tail')).toBe(false);
  });
});
