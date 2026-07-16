/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation, TConversationRuntimeSummary } from '@/common/config/storage';
import { addEventListener } from '@/renderer/utils/emitter';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Whitelist of message types that indicate content generation is in progress.
 * Only these types should trigger the sidebar loading spinner.
 * Using a whitelist (instead of a blacklist) prevents unknown/internal message
 * types (e.g. slash_commands_updated, acp_context_usage) from falsely
 * triggering the generating state.
 */
const isGeneratingStreamMessage = (type: string): boolean => {
  return (
    type === 'content' ||
    type === 'start' ||
    type === 'thought' ||
    type === 'thinking' ||
    type === 'tool_group' ||
    type === 'acp_tool_call' ||
    type === 'acp_permission' ||
    type === 'permission' ||
    type === 'plan'
  );
};

const isTerminalAgentStatus = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const { status } = data as { status?: string };
  return status === 'error' || status === 'disconnected';
};

const isTerminalStreamMessage = (message: { type: string; data: unknown }): boolean => {
  return (
    message.type === 'finish' ||
    message.type === 'error' ||
    (message.type === 'agent_status' && isTerminalAgentStatus(message.data))
  );
};

const isPermissionStreamMessage = (type: string): boolean => type === 'acp_permission' || type === 'permission';

export type SidebarStreamGuardDecision = {
  markGenerating: boolean;
  clearCompleted: boolean;
  lateIgnored: boolean;
};

export const getSidebarStreamGuardDecision = ({
  type,
  completed,
}: {
  type: string;
  completed: boolean;
}): SidebarStreamGuardDecision => {
  if (!isGeneratingStreamMessage(type)) {
    return {
      markGenerating: false,
      clearCompleted: false,
      lateIgnored: false,
    };
  }

  if (type === 'start') {
    return {
      markGenerating: true,
      clearCompleted: true,
      lateIgnored: false,
    };
  }

  if (completed) {
    return {
      markGenerating: false,
      clearCompleted: false,
      lateIgnored: true,
    };
  }

  return {
    markGenerating: true,
    clearCompleted: false,
    lateIgnored: false,
  };
};

type ConversationListSyncSnapshot = {
  conversations: TChatConversation[];
  generatingConversationIds: Set<string>;
  recentCompletionAtByConversationId: Map<string, number>;
};

const listeners = new Set<() => void>();

let isStoreInitialized = false;
let conversationsState: TChatConversation[] = [];
let generatingConversationIdsState = new Set<string>();
let recentCompletionAtByConversationIdState = new Map<string, number>();
let runtimeByConversationIdState = new Map<string, TConversationRuntimeSummary>();
let completedConversationIdsState = new Set<string>();
let conversation_idsState = new Set<string>();
let latestRefreshRequestId = 0;
let latestRuntimeRefreshRequestId = 0;
let runtimeRefreshRequestIdByConversationId = new Map<string, number>();
let snapshotState: ConversationListSyncSnapshot = {
  conversations: conversationsState,
  generatingConversationIds: generatingConversationIdsState,
  recentCompletionAtByConversationId: recentCompletionAtByConversationIdState,
};

const emitStoreChange = () => {
  snapshotState = {
    conversations: conversationsState,
    generatingConversationIds: generatingConversationIdsState,
    recentCompletionAtByConversationId: recentCompletionAtByConversationIdState,
  };
  listeners.forEach((listener) => listener());
};

const subscribeConversationListSync = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getConversationListSyncSnapshot = (): ConversationListSyncSnapshot => snapshotState;

const refreshConversations = () => {
  const requestId = ++latestRefreshRequestId;
  void ipcBridge.database.getUserConversations
    .invoke({ limit: 10000 })
    .then((result) => {
      if (requestId !== latestRefreshRequestId) {
        return;
      }

      const items = result?.items;
      if (items && Array.isArray(items)) {
        const filteredData = items.filter((conv) => {
          // Legacy rows from the pre-provider-probe health check flow are hidden
          // from normal history. New health checks must not create conversations.
          const extra = conv.extra as { is_health_check?: boolean; team_id?: string; teamId?: string } | undefined;
          return extra?.is_health_check !== true && !extra?.team_id && !extra?.teamId;
        });
        const nextRuntimeByConversationId = new Map(runtimeByConversationIdState);
        conversationsState = filteredData.map((conversation) => {
          if (conversation.runtime) {
            nextRuntimeByConversationId.set(conversation.id, conversation.runtime);
            return conversation;
          }

          const runtime = nextRuntimeByConversationId.get(conversation.id);
          return runtime ? { ...conversation, runtime } : conversation;
        });
        runtimeByConversationIdState = nextRuntimeByConversationId;
        // Use ALL conversation IDs (including team/legacy health-check rows) so the
        // responseStream listener recognises them as known and doesn't
        // trigger an infinite refreshConversations loop.
        conversation_idsState = new Set(items.map((conversation) => conversation.id));
        emitStoreChange();
        return;
      }

      conversationsState = [];
      conversation_idsState = new Set();
      emitStoreChange();
    })
    .catch((error) => {
      if (requestId !== latestRefreshRequestId) {
        return;
      }

      console.error('[WorkspaceGroupedHistory] Failed to load conversations:', error);
      conversationsState = [];
      conversation_idsState = new Set();
      emitStoreChange();
    });
};

const markGenerating = (conversation_id: string) => {
  if (generatingConversationIdsState.has(conversation_id)) {
    return;
  }

  generatingConversationIdsState = new Set(generatingConversationIdsState).add(conversation_id);
  emitStoreChange();
};

const clearGenerating = (conversation_id: string) => {
  if (!generatingConversationIdsState.has(conversation_id)) {
    return;
  }

  const next = new Set(generatingConversationIdsState);
  next.delete(conversation_id);
  generatingConversationIdsState = next;
  emitStoreChange();
};

const applyConversationRuntime = (conversation_id: string, runtime: TConversationRuntimeSummary) => {
  runtimeByConversationIdState = new Map(runtimeByConversationIdState).set(conversation_id, runtime);
  const conversationIndex = conversationsState.findIndex((conversation) => conversation.id === conversation_id);
  const conversation = conversationsState[conversationIndex];
  if (!conversation) {
    return;
  }

  const nextConversations = conversationsState.slice();
  nextConversations[conversationIndex] = { ...conversation, runtime };
  conversationsState = nextConversations;
  emitStoreChange();
};

const advanceConversationRuntimeRequest = (conversation_id: string) => {
  const requestId = ++latestRuntimeRefreshRequestId;
  runtimeRefreshRequestIdByConversationId = new Map(runtimeRefreshRequestIdByConversationId).set(
    conversation_id,
    requestId
  );
  return requestId;
};

const refreshConversationRuntimeState = (conversation_id: string) => {
  const requestId = advanceConversationRuntimeRequest(conversation_id);
  void ipcBridge.conversation.get
    .invoke({ id: conversation_id })
    .then((conversation) => {
      if (runtimeRefreshRequestIdByConversationId.get(conversation_id) !== requestId || !conversation?.runtime) {
        return;
      }
      applyConversationRuntime(conversation_id, conversation.runtime);
    })
    .catch(() => {});
};

const clearConversationRuntimeState = (conversation_id: string) => {
  advanceConversationRuntimeRequest(conversation_id);
  if (!runtimeByConversationIdState.has(conversation_id)) {
    return;
  }

  const nextRuntimeByConversationId = new Map(runtimeByConversationIdState);
  nextRuntimeByConversationId.delete(conversation_id);
  runtimeByConversationIdState = nextRuntimeByConversationId;
};

const markRecentCompletion = (conversation_id: string) => {
  recentCompletionAtByConversationIdState = new Map(recentCompletionAtByConversationIdState).set(
    conversation_id,
    Date.now()
  );
  emitStoreChange();
};

const clearRecentCompletionState = (conversation_id: string) => {
  if (!recentCompletionAtByConversationIdState.has(conversation_id)) {
    return;
  }

  const nextCompletionTimes = new Map(recentCompletionAtByConversationIdState);
  nextCompletionTimes.delete(conversation_id);
  recentCompletionAtByConversationIdState = nextCompletionTimes;
  emitStoreChange();
};

const markCompleted = (conversation_id: string) => {
  completedConversationIdsState = new Set(completedConversationIdsState).add(conversation_id);
};

const clearCompleted = (conversation_id: string) => {
  if (!completedConversationIdsState.has(conversation_id)) {
    return;
  }

  const next = new Set(completedConversationIdsState);
  next.delete(conversation_id);
  completedConversationIdsState = next;
};

const logLateStreamIgnored = (conversation_id: string, type: string) => {
  void ipcBridge.application.writeRendererLog
    .invoke({
      level: 'warn',
      tag: 'conversationRuntimeView',
      message: 'late_stream_ignored_for_runtime',
      data: {
        conversation_id,
        stream_type: type,
      },
    })
    .catch(() => {});
};

const initializeConversationListSyncStore = () => {
  if (isStoreInitialized) {
    return;
  }

  isStoreInitialized = true;
  refreshConversations();

  addEventListener('chat.history.refresh', refreshConversations);
  ipcBridge.conversation.listChanged.on((event) => {
    if (event.action === 'deleted') {
      clearGenerating(event.conversation_id);
      clearRecentCompletionState(event.conversation_id);
      clearConversationRuntimeState(event.conversation_id);
      clearCompleted(event.conversation_id);
    }
    refreshConversations();
  });
  ipcBridge.conversation.confirmation.add.on((event) => {
    refreshConversationRuntimeState(event.conversation_id);
  });
  ipcBridge.conversation.confirmation.remove.on((event) => {
    refreshConversationRuntimeState(event.conversation_id);
  });
  ipcBridge.conversation.responseStream.on((message) => {
    const conversation_id = message.conversation_id;
    if (!conversation_id) {
      return;
    }

    const conversation = conversationsState.find((item) => item.id === conversation_id);
    const wasWaitingApproval =
      conversation?.runtime?.state === 'waiting_confirmation' ||
      (conversation?.runtime?.pending_confirmations ?? 0) > 0;
    if (!conversation_idsState.has(conversation_id)) {
      refreshConversations();
    }
    if (isPermissionStreamMessage(message.type)) {
      refreshConversationRuntimeState(conversation_id);
    }

    if (isTerminalStreamMessage(message)) {
      const wasGenerating = generatingConversationIdsState.has(conversation_id);
      if (message.type === 'finish' && wasGenerating) {
        markRecentCompletion(conversation_id);
      }
      clearGenerating(conversation_id);
      return;
    }

    const decision = getSidebarStreamGuardDecision({
      type: message.type,
      completed: completedConversationIdsState.has(conversation_id),
    });
    if (decision.clearCompleted) {
      clearCompleted(conversation_id);
    }
    if (decision.lateIgnored) {
      logLateStreamIgnored(conversation_id, message.type);
      return;
    }
    if (decision.markGenerating) {
      if (wasWaitingApproval && !isPermissionStreamMessage(message.type)) {
        refreshConversationRuntimeState(conversation_id);
      }
      markGenerating(conversation_id);
    }
  });
  ipcBridge.conversation.turnCompleted.on((event) => {
    advanceConversationRuntimeRequest(event.session_id);
    applyConversationRuntime(event.session_id, event.runtime);
    if (event.state === 'ai_waiting_input') {
      markRecentCompletion(event.session_id);
    }
    markCompleted(event.session_id);
    clearGenerating(event.session_id);
    refreshConversations();
  });
};

export const useConversationListSync = () => {
  useEffect(() => {
    initializeConversationListSyncStore();
  }, []);

  const { conversations, generatingConversationIds, recentCompletionAtByConversationId } = useSyncExternalStore(
    subscribeConversationListSync,
    getConversationListSyncSnapshot,
    getConversationListSyncSnapshot
  );

  const isConversationGenerating = useCallback(
    (conversation_id: string) => {
      return generatingConversationIds.has(conversation_id);
    },
    [generatingConversationIds]
  );

  const getRecentCompletionAt = useCallback(
    (conversation_id: string) => {
      return recentCompletionAtByConversationId.get(conversation_id);
    },
    [recentCompletionAtByConversationId]
  );

  const refreshConversationRuntime = useCallback((conversation_id: string) => {
    refreshConversationRuntimeState(conversation_id);
  }, []);

  return {
    conversations,
    isConversationGenerating,
    getRecentCompletionAt,
    refreshConversationRuntime,
  };
};
