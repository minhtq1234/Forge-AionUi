/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { AgentStreamErrorInfo, IMessageText, IMessageTips, TMessage } from '@/common/chat/chatLib';
import {
  composeMessage,
  isDiagnosticTelemetryTip,
  mergeAcpToolCallContent,
  mergeTextMessageContent,
  normalizeAgentStreamError,
  normalizeTextMessageContent,
  preferTextMessageVersion,
  sanitizeAcpToolCallContent,
} from '@/common/chat/chatLib';
import { useCallback, useEffect, useRef } from 'react';
import { createContext } from '@renderer/utils/ui/createContext';
import {
  DEFAULT_MESSAGE_PAGE_LIMIT,
  loadConversationAnchorWindow,
  loadConversationMessagePage,
  loadLatestConversationMessages,
} from '@/renderer/utils/chat/messagePagination';

const [useMessageList, MessageListProvider, useUpdateMessageList] = createContext([] as TMessage[]);
const [useMessageListLoading, MessageListLoadingProvider, useUpdateMessageListLoading] = createContext(false);

const [useChatKey, ChatKeyProvider] = createContext('');

export type MessagePaginationState = {
  oldestCursor?: string;
  newestCursor?: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  isLoadingBefore: boolean;
  isLoadingAnchor: boolean;
};

const EMPTY_MESSAGE_PAGINATION_STATE: MessagePaginationState = {
  hasMoreBefore: false,
  hasMoreAfter: false,
  isLoadingBefore: false,
  isLoadingAnchor: false,
};

const [useMessagePaginationState, MessagePaginationProvider, useUpdateMessagePaginationState] =
  createContext<MessagePaginationState>(EMPTY_MESSAGE_PAGINATION_STATE);

const beforeUpdateMessageListStack: Array<(list: TMessage[]) => TMessage[]> = [];

const HISTORY_GAP_MARKER_CODE = '__aionui_renderer_history_gap__';

const createHistoryGapMarker = (conversationId: string): IMessageTips => ({
  id: `renderer-history-gap:${conversationId}`,
  conversation_id: conversationId,
  type: 'tips',
  position: 'center',
  hidden: true,
  content: {
    content: '',
    type: 'info',
    code: HISTORY_GAP_MARKER_CODE,
  },
});

export const isHistoryGapMarker = (message: TMessage): boolean =>
  message.type === 'tips' && message.hidden === true && message.content.code === HISTORY_GAP_MARKER_CODE;

type MessageAliasState = {
  conversationId?: string;
  messageAliases: Map<string, string>;
};

const messageAliasStateCache = new WeakMap<ReturnType<typeof useUpdateMessageList>, MessageAliasState>();

const getMessageAliasState = (update: ReturnType<typeof useUpdateMessageList>): MessageAliasState => {
  const existing = messageAliasStateCache.get(update);
  if (existing) return existing;

  const created = { messageAliases: new Map<string, string>() };
  messageAliasStateCache.set(update, created);
  return created;
};

// 消息索引缓存类型定义
// Message index cache type definitions
interface MessageIndex {
  msgIdIndex: Map<string, number>; // msg_id -> index
  call_idIndex: Map<string, number>; // tool_call.call_id -> index
  tool_call_idIndex: Map<string, number>; // acp_tool_call.update.tool_call_id -> index
  permission_call_idIndex: Map<string, number>; // permission.content.call_id -> index
}

function getMessageIndexKey(message: TMessage): string | undefined {
  if (!message.msg_id) return undefined;
  return message.type === 'thinking' ? `thinking:${message.msg_id}` : message.msg_id;
}

// 使用 WeakMap 缓存索引，当列表被 GC 时自动清理
// Use WeakMap to cache index, auto-cleanup when list is GC'd
const indexCache = new WeakMap<TMessage[], MessageIndex>();

export function logDroppedToolCallWithoutCallId(message: TMessage | undefined): boolean {
  if (!message) return false;
  if (message.type !== 'tool_call' || message.content?.call_id) return false;

  console.warn('[tool-call] dropped tool_call without call_id', {
    conversation_id: message.conversation_id,
    msg_id: message.msg_id,
    name: message.content?.name,
    status: message.content?.status,
  });
  return true;
}

// 构建消息索引
// Build message index
function buildMessageIndex(list: TMessage[]): MessageIndex {
  const msgIdIndex = new Map<string, number>();
  const call_idIndex = new Map<string, number>();
  const tool_call_idIndex = new Map<string, number>();
  const permission_call_idIndex = new Map<string, number>();

  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    const msgIndexKey = getMessageIndexKey(msg);
    if (msgIndexKey) {
      msgIdIndex.set(msgIndexKey, i);
    }
    if (msg.type === 'tool_call' && msg.content?.call_id) {
      call_idIndex.set(msg.content.call_id, i);
    }
    if (msg.type === 'acp_tool_call' && msg.content?.update?.tool_call_id) {
      tool_call_idIndex.set(msg.content.update.tool_call_id, i);
    }
    if (msg.type === 'permission' && msg.content?.call_id) {
      permission_call_idIndex.set(msg.content.call_id, i);
    }
  }

  return { msgIdIndex, call_idIndex, tool_call_idIndex, permission_call_idIndex };
}

// 获取或构建索引（带缓存）
// Get or build index with caching
function getOrBuildIndex(list: TMessage[]): MessageIndex {
  let cached = indexCache.get(list);
  if (!cached) {
    cached = buildMessageIndex(list);
    indexCache.set(list, cached);
  }
  return cached;
}

const sanitizeMessageForList = (message: TMessage): TMessage =>
  message.type === 'acp_tool_call'
    ? ({ ...message, content: sanitizeAcpToolCallContent(message.content) } as TMessage)
    : message;

// 使用索引优化的消息合并函数
// Index-optimized message compose function
function composeMessageWithIndex(message: TMessage | undefined, list: TMessage[], index: MessageIndex): TMessage[] {
  if (!message) return list || [];

  if (logDroppedToolCallWithoutCallId(message)) {
    return list || [];
  }

  if (!list?.length) {
    const firstMessage = sanitizeMessageForList(message);
    // Update index when adding first message
    const msgIndexKey = getMessageIndexKey(firstMessage);
    if (msgIndexKey) {
      index.msgIdIndex.set(msgIndexKey, 0);
    }
    return [firstMessage];
  }

  const last = list[list.length - 1];

  // 对于 tool_group 类型，使用原始的 composeMessage（因为涉及内部数组匹配）
  // For tool_group type, use original composeMessage (involves inner array matching)
  // After composeMessage, the returned list may have different length/ordering,
  // so we must invalidate the index to prevent stale lookups in subsequent calls.
  if (message.type === 'tool_group') {
    const result = composeMessage(message, list);
    if (result !== list) {
      // Rebuild index maps from the new list to keep them in sync
      const rebuilt = buildMessageIndex(result);
      index.msgIdIndex = rebuilt.msgIdIndex;
      index.call_idIndex = rebuilt.call_idIndex;
      index.tool_call_idIndex = rebuilt.tool_call_idIndex;
      index.permission_call_idIndex = rebuilt.permission_call_idIndex;
    }
    return result;
  }

  // tool_call: 使用 call_idIndex 快速查找
  // tool_call: use call_idIndex for fast lookup
  if (message.type === 'tool_call' && message.content?.call_id) {
    const existingIdx = index.call_idIndex.get(message.content.call_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'tool_call') {
        const newList = list.slice();
        const merged = { ...existingMsg.content, ...message.content };
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    // 未找到，添加新消息并更新索引
    const newIdx = list.length;
    index.call_idIndex.set(message.content.call_id, newIdx);
    const msgIndexKey = getMessageIndexKey(message);
    if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
    return list.concat(message);
  }

  // acp_tool_call: use tool_call_idIndex for fast lookup
  if (message.type === 'acp_tool_call' && message.content?.update?.tool_call_id) {
    const existingIdx = index.tool_call_idIndex.get(message.content.update.tool_call_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'acp_tool_call') {
        const newList = list.slice();
        const merged = mergeAcpToolCallContent(existingMsg.content, message.content);
        newList[existingIdx] = { ...existingMsg, content: merged };
        return newList;
      }
    }
    // 未找到，添加新消息并更新索引
    const newIdx = list.length;
    index.tool_call_idIndex.set(message.content.update.tool_call_id, newIdx);
    const msgIndexKey = getMessageIndexKey(message);
    if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
    return list.concat(sanitizeMessageForList(message));
  }

  // permission: use call_id for recovery/live stream dedupe.
  if (message.type === 'permission' && message.content?.call_id) {
    const existingIdx = index.permission_call_idIndex.get(message.content.call_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'permission') {
        const newList = list.slice();
        newList[existingIdx] = { ...existingMsg, ...message, content: message.content };
        return newList;
      }
    }
    const newIdx = list.length;
    index.permission_call_idIndex.set(message.content.call_id, newIdx);
    const msgIndexKey = getMessageIndexKey(message);
    if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
    return list.concat(message);
  }

  // text message: merge only with the latest contiguous streaming chunk.
  // text 消息: 只与最后一条连续的流式片段合并，保留被工具/思考打断后的消息边界。
  if (message.type === 'text' && message.msg_id) {
    const existingIdx = index.msgIdIndex.get(message.msg_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      if (existingMsg.type === 'text') {
        // User messages (right position) are complete — skip if already exists to prevent duplicates
        if (message.position === 'right') {
          return list;
        }
        // Complete teammate messages are not streaming chunks — skip if already exists
        if ((message.content as { teammateMessage?: boolean })?.teammateMessage) {
          return list;
        }
      }
    }

    if (last.type === 'text' && last.msg_id === message.msg_id) {
      const newList = list.slice();
      newList[newList.length - 1] = {
        ...last,
        status: last.status === 'finish' || message.status === 'finish' ? 'finish' : (message.status ?? last.status),
        content: mergeTextMessageContent(last.content, message.content),
      };
      return newList;
    }

    const newIdx = list.length;
    index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  // thinking message: merge only with the latest contiguous thinking chunk.
  // Uses "thinking:${msg_id}" key to avoid collision with text messages sharing the same msg_id.
  if (message.type === 'thinking' && message.msg_id) {
    const thinkingKey = `thinking:${message.msg_id}`;
    if (message.content.status === 'done') {
      const existingIdx = index.msgIdIndex.get(thinkingKey);
      if (existingIdx !== undefined && existingIdx < list.length) {
        const existingMsg = list[existingIdx];
        if (existingMsg.type === 'thinking') {
          const newList = list.slice();
          newList[existingIdx] = {
            ...existingMsg,
            content: {
              ...existingMsg.content,
              status: 'done' as const,
              duration: message.content.duration,
              subject: message.content.subject || existingMsg.content.subject,
            },
          };
          return newList;
        }
      }
    }

    if (last.type === 'thinking' && last.msg_id === message.msg_id) {
      const newList = list.slice();
      newList[newList.length - 1] = {
        ...last,
        content: {
          ...last.content,
          content: last.content.content + message.content.content,
          subject: message.content.subject || last.content.subject,
        },
      };
      return newList;
    }

    const newIdx = list.length;
    index.msgIdIndex.set(thinkingKey, newIdx);
    return list.concat(message);
  }

  // plan message: update content and move to end of list
  if (message.type === 'plan' && message.msg_id) {
    const existingIdx = index.msgIdIndex.get(message.msg_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      const newList = list.slice();
      newList.splice(existingIdx, 1);
      const updated = { ...existingMsg, ...message, content: message.content } as TMessage;
      newList.push(updated);
      // Rebuild index after splice
      const rebuilt = buildMessageIndex(newList);
      index.msgIdIndex = rebuilt.msgIdIndex;
      index.call_idIndex = rebuilt.call_idIndex;
      index.tool_call_idIndex = rebuilt.tool_call_idIndex;
      index.permission_call_idIndex = rebuilt.permission_call_idIndex;
      return newList;
    }
    const newIdx = list.length;
    index.msgIdIndex.set(message.msg_id, newIdx);
    return list.concat(message);
  }

  // agent_status / tips and other msg_id-based messages:
  // replace the existing item in place instead of appending duplicates.
  if (message.msg_id) {
    const existingIdx = index.msgIdIndex.get(message.msg_id);
    if (existingIdx !== undefined && existingIdx < list.length) {
      const existingMsg = list[existingIdx];
      const newList = list.slice();
      newList[existingIdx] = {
        ...existingMsg,
        ...message,
        content: message.content,
      } as TMessage;
      return newList;
    }
  }

  // Other types: fallback to last message check
  // 其他类型: 回退到检查最后一条消息
  if (last.msg_id !== message.msg_id || last.type !== message.type) {
    // Add new message and update index
    const newIdx = list.length;
    const msgIndexKey = getMessageIndexKey(message);
    if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
    return list.concat(message);
  }

  // Merge other message types with same msg_id
  const newList = list.slice();
  const lastIdx = newList.length - 1;
  newList[lastIdx] = { ...last, ...message };
  return newList;
}

export const useMergeLiveMessage = () => {
  const update = useUpdateMessageList();
  const pendingRef = useRef<Array<{ message: TMessage; add: boolean }>>([]);
  const rafRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliasState = getMessageAliasState(update);

  const flush = useCallback(() => {
    rafRef.current = null;

    const pending = pendingRef.current;
    if (!pending.length) return;
    pendingRef.current = [];
    update((list) => {
      // 获取或构建索引用于快速查找 (O(1) instead of O(n))
      // Get or build index for fast lookup
      const index = getOrBuildIndex(list);
      let newList = list;

      for (const item of pending) {
        if (!item.message) {
          continue;
        }

        const messageAliases = getConversationMessageAliases(aliasState, item.message.conversation_id);
        reconcileMessageAliases(newList, messageAliases);
        const message = resolveTextMessageAlias(item.message, messageAliases);

        if (logDroppedToolCallWithoutCallId(message)) {
          continue;
        }

        if (item.add) {
          // 新增消息，更新索引
          // New message, update index
          const msg = sanitizeMessageForList(message);
          const newIdx = newList.length;
          const msgIndexKey = getMessageIndexKey(msg);
          if (msgIndexKey) index.msgIdIndex.set(msgIndexKey, newIdx);
          if (msg.type === 'tool_call' && msg.content?.call_id) {
            index.call_idIndex.set(msg.content.call_id, newIdx);
          }
          if (msg.type === 'acp_tool_call' && msg.content?.update?.tool_call_id) {
            index.tool_call_idIndex.set(msg.content.update.tool_call_id, newIdx);
          }
          if (msg.type === 'permission' && msg.content?.call_id) {
            index.permission_call_idIndex.set(msg.content.call_id, newIdx);
          }
          newList = newList.concat(msg);
        } else {
          // 使用索引优化的消息合并
          // Use index-optimized message compose
          newList = composeMessageWithIndex(message, newList, index);
        }

        while (beforeUpdateMessageListStack.length) {
          newList = beforeUpdateMessageListStack.shift()!(newList);
        }

        if (isDedupeCandidate(message)) {
          const dedupedList = reconcileAssistantReplyList(newList, item.message.conversation_id, aliasState);
          if (dedupedList !== newList) {
            newList = dedupedList;
            const rebuilt = buildMessageIndex(newList);
            index.msgIdIndex = rebuilt.msgIdIndex;
            index.call_idIndex = rebuilt.call_idIndex;
            index.tool_call_idIndex = rebuilt.tool_call_idIndex;
            index.permission_call_idIndex = rebuilt.permission_call_idIndex;
          }
        }
      }
      const conversationId =
        aliasState.conversationId ?? newList.find((message) => !isHistoryGapMarker(message))?.conversation_id;
      const dedupedList = conversationId ? reconcileAssistantReplyList(newList, conversationId, aliasState) : newList;
      const rebuilt = buildMessageIndex(dedupedList);
      index.msgIdIndex = rebuilt.msgIdIndex;
      index.call_idIndex = rebuilt.call_idIndex;
      index.tool_call_idIndex = rebuilt.tool_call_idIndex;
      index.permission_call_idIndex = rebuilt.permission_call_idIndex;
      indexCache.set(dedupedList, index);
      return dedupedList;
    });

    rafRef.current = setTimeout(flush);
  }, [aliasState, update]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        clearTimeout(rafRef.current);
      }
    };
  }, []);

  return useCallback(
    (message: TMessage | undefined, add = false) => {
      if (!message) {
        return;
      }
      pendingRef.current.push({ message, add });
      if (rafRef.current === null) {
        rafRef.current = setTimeout(flush);
      }
    },
    [flush]
  );
};

export const useAddOrUpdateMessage = useMergeLiveMessage;

export const useRemoveMessageByMsgId = () => {
  const update = useUpdateMessageList();
  const aliasState = getMessageAliasState(update);

  return useCallback(
    (msgId: string) => {
      update((list) => {
        const conversationId = list.find((message) => !isHistoryGapMarker(message))?.conversation_id;
        if (conversationId) {
          invalidateMessageAlias(msgId, getConversationMessageAliases(aliasState, conversationId));
        }
        const filtered = list.filter((message) => message.msg_id !== msgId);
        return conversationId ? reconcileAssistantReplyList(filtered, conversationId, aliasState) : filtered;
      });
    },
    [aliasState, update]
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const normalizeTipType = (value: unknown, fallback: IMessageTips['content']['type']) =>
  value === 'success' || value === 'warning' || value === 'error' || value === 'info' ? value : fallback;

const normalizePersistedWorkspaceRuntimeError = (
  parsed: Record<string, unknown>,
  message: string
): AgentStreamErrorInfo | undefined => {
  if (
    parsed.code !== 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE' &&
    parsed.code !== 'WORKSPACE_PATH_CONTAINS_WHITESPACE_RUNTIME_UNSUPPORTED'
  ) {
    return undefined;
  }

  const details = isRecord(parsed.details) ? parsed.details : undefined;
  const workspacePath = typeof details?.workspace_path === 'string' ? details.workspace_path : undefined;
  if (!workspacePath) {
    return undefined;
  }

  const persistedError = isRecord(parsed.error) ? parsed.error : undefined;
  const detail = typeof persistedError?.detail === 'string' ? persistedError.detail : message;

  return {
    message,
    code: 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE',
    ownership: 'aionui',
    detail,
    workspacePath,
    retryable: false,
    feedback_recommended: false,
  };
};

const classifyPersistedSendFailure = (
  parsed: Record<string, unknown>,
  message: string
): AgentStreamErrorInfo | undefined => {
  if (typeof parsed.source !== 'string' && typeof parsed.code !== 'string') {
    return undefined;
  }

  const persistedCode = typeof parsed.code === 'string' ? parsed.code : undefined;
  const structuredContent = isRecord(parsed.structuredContent) ? parsed.structuredContent : undefined;
  const domainCode =
    typeof structuredContent?.domainCode === 'string'
      ? structuredContent.domainCode
      : typeof parsed.domainCode === 'string'
        ? parsed.domainCode
        : undefined;
  const effectiveCode = domainCode || persistedCode;

  if (
    effectiveCode === 'MCP_HTTP_RESPONSE_READ_FAILED' ||
    effectiveCode === 'MCP_TOOL_REMOTE_ERROR' ||
    effectiveCode === 'MCP_TOOL_RESPONSE_UNEXPECTED' ||
    effectiveCode === 'MCP_TCP_READ_FAILED' ||
    effectiveCode === 'TEAM_SERVICE_UNAVAILABLE'
  ) {
    return {
      message,
      code: effectiveCode,
      ownership: 'aionui',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  if (
    effectiveCode === 'TEAM_ASSISTANT_ID_REQUIRED' ||
    effectiveCode === 'TEAM_ASSISTANT_NOT_FOUND' ||
    effectiveCode === 'TEAM_ASSISTANT_FIELD_UNSUPPORTED'
  ) {
    return {
      message,
      code: effectiveCode,
      ownership: 'aionui',
      detail: message,
      retryable: false,
      feedback_recommended: false,
    };
  }

  if (persistedCode === 'BAD_GATEWAY') {
    return {
      message,
      code: 'UNKNOWN_UPSTREAM_ERROR',
      ownership: 'unknown_upstream',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  if (persistedCode === 'INTERNAL_ERROR') {
    return {
      message,
      code: 'AIONUI_INTERNAL_ERROR',
      ownership: 'aionui',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  if (persistedCode?.startsWith('AIONUI_')) {
    return { message, code: persistedCode, ownership: 'aionui', detail: message, retryable: true };
  }
  if (persistedCode?.startsWith('USER_AGENT_')) {
    return { message, code: persistedCode, ownership: 'user_agent', detail: message, retryable: true };
  }
  if (persistedCode?.startsWith('USER_LLM_PROVIDER_')) {
    return {
      message,
      code: persistedCode,
      ownership: 'user_llm_provider',
      detail: message,
      retryable: false,
      feedback_recommended: false,
    };
  }
  if (persistedCode === 'UNKNOWN_UPSTREAM_ERROR') {
    return {
      message,
      code: persistedCode,
      ownership: 'unknown_upstream',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  if (parsed.source === 'send_failed') {
    return {
      message,
      code: 'AIONUI_INTERNAL_ERROR',
      ownership: 'aionui',
      detail: message,
      retryable: true,
      feedback_recommended: true,
    };
  }

  return undefined;
};

const normalizeDbTipsMessage = (msg: IMessageTips): IMessageTips => {
  const parsed = parseJsonRecord(msg.content);
  if (!parsed || typeof parsed.content !== 'string') return msg;

  const existingContent = isRecord(msg.content) ? msg.content : undefined;
  const fallbackType =
    existingContent?.type === 'success' ||
    existingContent?.type === 'warning' ||
    existingContent?.type === 'error' ||
    existingContent?.type === 'info'
      ? existingContent.type
      : 'error';
  const tipType = normalizeTipType(parsed.type, fallbackType);
  const code =
    typeof parsed.code === 'string'
      ? parsed.code
      : typeof existingContent?.code === 'string'
        ? existingContent.code
        : undefined;
  const params = isRecord(parsed.params)
    ? parsed.params
    : isRecord(existingContent?.params)
      ? existingContent.params
      : undefined;
  const structuredError =
    tipType === 'error'
      ? (normalizePersistedWorkspaceRuntimeError(parsed, parsed.content) ??
        normalizeAgentStreamError(parsed.error) ??
        classifyPersistedSendFailure(parsed, parsed.content) ??
        normalizeAgentStreamError({ ...parsed, message: parsed.content }))
      : undefined;

  return {
    ...msg,
    content: {
      content: parsed.content,
      type: tipType,
      ...(tipType !== 'error' && code ? { code } : {}),
      ...(tipType !== 'error' && params ? { params } : {}),
      ...(structuredError ? { error: structuredError } : {}),
    },
  };
};

/**
 * Normalize a message loaded from backend DB into renderer runtime shape.
 */
export function normalizeDbMessage(msg: TMessage): TMessage {
  if (msg.type === 'tips') {
    const normalized = normalizeDbTipsMessage(msg);
    return isDiagnosticTelemetryTip(normalized.content.content) ? { ...normalized, hidden: true } : normalized;
  }
  if (msg.type !== 'text') return msg;

  return {
    ...msg,
    content: normalizeTextMessageContent((msg as IMessageText).content),
  };
}

const getMessageMergeKey = (message: TMessage): string => {
  if (message.msg_id) return `${message.type}:${message.msg_id}`;
  return `id:${message.id}`;
};

const normalizeDedupeTextContent = (content: string): string => {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');

  while (lines.length && lines[0].trim().length === 0) lines.shift();
  while (lines.length && lines.at(-1)?.trim().length === 0) lines.pop();
  if (!lines.length) return '';

  // CommonMark allows up to three insignificant leading spaces; four starts an indented code block.
  lines[0] = lines[0].replace(/^ {1,3}(?=\S)/, '');
  lines[lines.length - 1] = lines[lines.length - 1].replace(/[ \t]+$/, '');
  return lines.join('\n');
};

const isDedupeCandidate = (message: TMessage): message is IMessageText =>
  message.type === 'text' && message.position === 'left' && !message.hidden && !message.content.teammateMessage;

const dedupeAssistantRepliesByTurn = (messages: TMessage[], messageAliases?: Map<string, string>): TMessage[] => {
  const dedupedMessages: TMessage[] = [];
  const assistantReplyIndexes = new Map<string, number>();
  const currentSegmentAliases = messageAliases ? new Map(messageAliases) : undefined;
  let changed = false;

  for (const message of messages) {
    if (isHistoryGapMarker(message)) {
      assistantReplyIndexes.clear();
      if (messageAliases && currentSegmentAliases) {
        messageAliases.clear();
        for (const [sourceMessageId, canonicalMessageId] of currentSegmentAliases) {
          messageAliases.set(sourceMessageId, canonicalMessageId);
        }
      }
      dedupedMessages.push(message);
      continue;
    }

    if (message.position === 'right' && !message.hidden) {
      assistantReplyIndexes.clear();
    }

    if (!isDedupeCandidate(message)) {
      dedupedMessages.push(message);
      continue;
    }

    const normalizedContent = normalizeDedupeTextContent(message.content.content);
    const existingIndex = assistantReplyIndexes.get(normalizedContent);
    if (existingIndex === undefined) {
      assistantReplyIndexes.set(normalizedContent, dedupedMessages.length);
      dedupedMessages.push(message);
      continue;
    }

    const existing = dedupedMessages[existingIndex];
    if (isDedupeCandidate(existing)) {
      const replacementPreferenceChanged = (existing.content.replace === true) !== (message.content.replace === true);
      const preferredVersion = replacementPreferenceChanged ? preferTextMessageVersion(existing, message) : existing;
      const discarded = preferredVersion === existing ? message : existing;
      const preferred =
        existing.status === 'finish' || message.status === 'finish'
          ? { ...preferredVersion, status: 'finish' as const }
          : preferredVersion;
      dedupedMessages[existingIndex] = preferred;
      changed = true;

      if (messageAliases && discarded.msg_id && preferred.msg_id && discarded.msg_id !== preferred.msg_id) {
        messageAliases.set(discarded.msg_id, preferred.msg_id);
      }
    }
  }

  return changed ? dedupedMessages : messages;
};

const resolveMessageAlias = (messageId: string, messageAliases: Map<string, string>): string => {
  let currentId = messageId;
  const visited = new Set<string>();

  while (!visited.has(currentId)) {
    visited.add(currentId);
    const nextId = messageAliases.get(currentId);
    if (!nextId) break;
    currentId = nextId;
  }

  return currentId;
};

const invalidateMessageAlias = (messageId: string, messageAliases: Map<string, string>): void => {
  for (const sourceMessageId of messageAliases.keys()) {
    let currentId = sourceMessageId;
    const visited = new Set<string>();

    while (!visited.has(currentId)) {
      if (currentId === messageId) {
        messageAliases.delete(sourceMessageId);
        break;
      }
      visited.add(currentId);
      const nextId = messageAliases.get(currentId);
      if (!nextId) break;
      currentId = nextId;
    }
  }
};

const resolveTextMessageAlias = (message: TMessage, messageAliases: Map<string, string>): TMessage => {
  if (message.type !== 'text' || !message.msg_id) return message;

  const canonicalMessageId = resolveMessageAlias(message.msg_id, messageAliases);
  return canonicalMessageId === message.msg_id ? message : { ...message, msg_id: canonicalMessageId };
};

const getConversationMessageAliases = (aliasState: MessageAliasState, conversationId: string): Map<string, string> => {
  if (aliasState.conversationId !== conversationId) {
    aliasState.conversationId = conversationId;
    aliasState.messageAliases.clear();
  }
  return aliasState.messageAliases;
};

const getCurrentAliasSegment = (messages: TMessage[]): TMessage[] => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isHistoryGapMarker(messages[index])) return messages.slice(index + 1);
  }
  return messages;
};

const reconcileMessageAliases = (messages: TMessage[], messageAliases: Map<string, string>): void => {
  const retainedMessageIds = new Set(
    getCurrentAliasSegment(messages).flatMap((message) =>
      message.type === 'text' && message.msg_id ? [message.msg_id] : []
    )
  );

  for (const retainedMessageId of retainedMessageIds) {
    messageAliases.delete(retainedMessageId);
  }

  for (const [sourceMessageId] of messageAliases) {
    const canonicalMessageId = resolveMessageAlias(sourceMessageId, messageAliases);
    if (canonicalMessageId === sourceMessageId || !retainedMessageIds.has(canonicalMessageId)) {
      messageAliases.delete(sourceMessageId);
      continue;
    }
    messageAliases.set(sourceMessageId, canonicalMessageId);
  }
};

const reconcileAssistantReplyList = (
  messages: TMessage[],
  conversationId: string,
  aliasState: MessageAliasState
): TMessage[] => {
  const messageAliases = getConversationMessageAliases(aliasState, conversationId);
  const dedupedMessages = dedupeAssistantRepliesByTurn(messages, messageAliases);
  reconcileMessageAliases(dedupedMessages, messageAliases);
  return dedupedMessages;
};

const preferPersistedOrLiveMessage = (persisted: TMessage, live: TMessage): TMessage => {
  if (persisted.type === 'text' && live.type === 'text') {
    return preferTextMessageVersion(persisted, live);
  }
  return persisted;
};

type AnchorWindowMergeOptions = {
  hasMoreAfter?: boolean;
};

function mergeLoadedPageWithCurrent(
  conversationId: string,
  messages: TMessage[],
  currentList: TMessage[],
  options: AnchorWindowMergeOptions = {},
  aliasState: MessageAliasState = { messageAliases: new Map<string, string>() }
): TMessage[] {
  const loadedMessages = messages.filter((message) => !isHistoryGapMarker(message));
  const sameConversation = currentList.filter((message) => message.conversation_id === conversationId);
  const currentGapIndex = sameConversation.findLastIndex(isHistoryGapMarker);
  const currentTail = (currentGapIndex >= 0 ? sameConversation.slice(currentGapIndex + 1) : sameConversation).filter(
    (message) => !isHistoryGapMarker(message)
  );
  const comparableCurrent = sameConversation.filter((message) => !isHistoryGapMarker(message));

  const currentById = new Map(comparableCurrent.map((message) => [message.id, message]));
  const currentByKey = new Map(comparableCurrent.map((message) => [getMessageMergeKey(message), message]));
  const loadedIds = new Set(loadedMessages.map((message) => message.id));
  const loadedKeys = new Set(loadedMessages.map(getMessageMergeKey));

  const mergedMessages = loadedMessages.map((message) => {
    const live = currentById.get(message.id) ?? currentByKey.get(getMessageMergeKey(message));
    return live ? preferPersistedOrLiveMessage(message, live) : message;
  });
  const liveOnly = currentTail.filter(
    (message) => !loadedIds.has(message.id) && !loadedKeys.has(getMessageMergeKey(message))
  );
  const combinedMessages = options.hasMoreAfter
    ? [...mergedMessages, createHistoryGapMarker(conversationId), ...liveOnly]
    : [...mergedMessages, ...liveOnly];

  return reconcileAssistantReplyList(combinedMessages, conversationId, aliasState);
}

export function prependHistoryMessages(currentList: TMessage[], messages: TMessage[]): TMessage[] {
  const conversationId = messages[0]?.conversation_id ?? currentList[0]?.conversation_id;
  const aliasState: MessageAliasState = { messageAliases: new Map<string, string>() };
  return conversationId
    ? prependHistoryMessagesWithAliases(currentList, messages, conversationId, aliasState)
    : currentList;
}

const prependHistoryMessagesWithAliases = (
  currentList: TMessage[],
  messages: TMessage[],
  conversationId: string,
  aliasState: MessageAliasState
): TMessage[] => {
  if (!messages.length) return currentList;

  const currentIds = new Set(currentList.map((message) => message.id));
  const currentKeys = new Set(currentList.map(getMessageMergeKey));
  const uniqueHistory = messages.filter(
    (message) => !currentIds.has(message.id) && !currentKeys.has(getMessageMergeKey(message))
  );
  return reconcileAssistantReplyList(
    uniqueHistory.length ? [...uniqueHistory, ...currentList] : currentList,
    conversationId,
    aliasState
  );
};

export const usePrependHistoryPage = () => {
  const update = useUpdateMessageList();
  const aliasState = getMessageAliasState(update);
  return useCallback(
    (messages: TMessage[]) => {
      update((list) => {
        const conversationId = messages[0]?.conversation_id ?? list[0]?.conversation_id;
        return conversationId ? prependHistoryMessagesWithAliases(list, messages, conversationId, aliasState) : list;
      });
    },
    [aliasState, update]
  );
};

export const useReplaceWithAnchorWindow = () => {
  const update = useUpdateMessageList();
  const aliasState = getMessageAliasState(update);
  return useCallback(
    (conversationId: string, messages: TMessage[], options: AnchorWindowMergeOptions = {}) => {
      update((list) => mergeLoadedPageWithCurrent(conversationId, messages, list, options, aliasState));
    },
    [aliasState, update]
  );
};

export const useLoadPreviousMessagePage = (conversationId?: string) => {
  const pagination = useMessagePaginationState();
  const setPagination = useUpdateMessagePaginationState();
  const prependHistoryPage = usePrependHistoryPage();

  return useCallback(async () => {
    if (!conversationId || !pagination.oldestCursor || !pagination.hasMoreBefore || pagination.isLoadingBefore) {
      return false;
    }

    setPagination((current) => ({ ...current, isLoadingBefore: true }));
    try {
      const page = await loadConversationMessagePage(conversationId, {
        limit: DEFAULT_MESSAGE_PAGE_LIMIT,
        before: pagination.oldestCursor,
        contentMode: 'compact',
      });
      const messages = page.items.map(normalizeDbMessage);
      prependHistoryPage(messages);
      setPagination((current) => ({
        ...current,
        oldestCursor: page.oldest_cursor ?? current.oldestCursor,
        newestCursor: current.newestCursor ?? page.newest_cursor ?? undefined,
        hasMoreBefore: page.has_more_before,
        hasMoreAfter: current.hasMoreAfter || page.has_more_after,
        isLoadingBefore: false,
      }));
      return true;
    } catch (error) {
      console.error('[useLoadPreviousMessagePage] Failed to load previous messages:', error);
      setPagination((current) => ({ ...current, isLoadingBefore: false }));
      return false;
    }
  }, [
    conversationId,
    pagination.hasMoreBefore,
    pagination.isLoadingBefore,
    pagination.oldestCursor,
    prependHistoryPage,
    setPagination,
  ]);
};

export const useLoadAnchorMessageWindow = (conversationId?: string) => {
  const setPagination = useUpdateMessagePaginationState();
  const replaceWithAnchorWindow = useReplaceWithAnchorWindow();

  return useCallback(
    async (messageId: string) => {
      if (!conversationId || !messageId) return false;

      setPagination((current) => ({ ...current, isLoadingAnchor: true }));
      try {
        const page = await loadConversationAnchorWindow(conversationId, messageId, {
          limit: DEFAULT_MESSAGE_PAGE_LIMIT,
          contentMode: 'compact',
        });
        replaceWithAnchorWindow(conversationId, page.items.map(normalizeDbMessage), {
          hasMoreAfter: page.has_more_after,
        });
        setPagination({
          oldestCursor: page.oldest_cursor ?? undefined,
          newestCursor: page.newest_cursor ?? undefined,
          hasMoreBefore: page.has_more_before,
          hasMoreAfter: page.has_more_after,
          isLoadingBefore: false,
          isLoadingAnchor: false,
        });
        return true;
      } catch (error) {
        console.error('[useLoadAnchorMessageWindow] Failed to load anchor messages:', error);
        setPagination((current) => ({ ...current, isLoadingAnchor: false }));
        return false;
      }
    },
    [conversationId, replaceWithAnchorWindow, setPagination]
  );
};

export const useMessageLstCache = (key: string) => {
  const update = useUpdateMessageList();
  const aliasState = getMessageAliasState(update);
  const setLoading = useUpdateMessageListLoading();
  const setPagination = useUpdateMessagePaginationState();
  const loadMessages = useCallback(async (): Promise<TMessage[]> => {
    const result = await loadLatestConversationMessages(key, {
      limit: DEFAULT_MESSAGE_PAGE_LIMIT,
      contentMode: 'compact',
    });
    const messages = result?.items?.map(normalizeDbMessage);
    if (messages && Array.isArray(messages)) {
      update((currentList) => mergeLoadedPageWithCurrent(key, messages, currentList, {}, aliasState));
      setPagination({
        oldestCursor: result.oldest_cursor ?? undefined,
        newestCursor: result.newest_cursor ?? undefined,
        hasMoreBefore: result.has_more_before,
        hasMoreAfter: result.has_more_after,
        isLoadingBefore: false,
        isLoadingAnchor: false,
      });
      return messages;
    }
    return [];
  }, [aliasState, key, setPagination, update]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setLoading(true);
    setPagination({ ...EMPTY_MESSAGE_PAGINATION_STATE });
    void loadMessages()
      .catch((error) => {
        console.error('[useMessageLstCache] Failed to load messages from database:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, loadMessages, setLoading, setPagination]);

  useEffect(() => {
    if (!key) {
      return;
    }

    return ipcBridge.conversation.userCreated.on((payload) => {
      if (payload.conversation_id !== key) {
        return;
      }

      update((list) => {
        const messageAliases = getConversationMessageAliases(aliasState, key);
        const index = getOrBuildIndex(list);
        const message = resolveTextMessageAlias(
          {
            id: payload.msg_id,
            msg_id: payload.msg_id,
            conversation_id: payload.conversation_id,
            type: 'text',
            position: payload.position,
            status: payload.status,
            hidden: payload.hidden,
            created_at: payload.created_at,
            content: {
              content: payload.content,
            },
          },
          messageAliases
        );
        return reconcileAssistantReplyList(composeMessageWithIndex(message, list, index), key, aliasState);
      });
    });
  }, [aliasState, key, update]);
};

export const beforeUpdateMessageList = (fn: (list: TMessage[]) => TMessage[]) => {
  beforeUpdateMessageListStack.push(fn);
  return () => {
    beforeUpdateMessageListStack.splice(beforeUpdateMessageListStack.indexOf(fn), 1);
  };
};
export {
  ChatKeyProvider,
  MessagePaginationProvider,
  MessageListLoadingProvider,
  MessageListProvider,
  useChatKey,
  useMessagePaginationState,
  useMessageList,
  useMessageListLoading,
  useUpdateMessagePaginationState,
  useUpdateMessageList,
};
