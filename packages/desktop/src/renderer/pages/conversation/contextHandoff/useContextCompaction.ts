import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type {
  ICompactContextParams,
  ICompactContextResult,
  IConversationTurnCompletedEvent,
  ILocalContextCompactionParams,
  ILocalContextCompactionResult,
  TContextCompactionTrigger,
} from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import type {
  TChatConversation,
  TContextBudgetStatus,
  TContextGenerationSource,
  TContextHandoffItem,
} from '@/common/config/storage';
import { uuid } from '@/common/utils';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { emitter } from '@/renderer/utils/emitter';
import { buildContextHandoffExtraPatch, buildContextSnapshotStatePatch } from './contextConversationUpdate';
import { resolveContextFile } from './contextFile';
import { resolveConversationContextLimit } from './contextLimit';
import { buildContextMarkdown, buildFallbackContextMarkdown, buildFallbackContextSnapshot } from './contextMarkdown';
import { loadContextHandoffMessages } from './contextMessages';
import { addPinnedContext, getConversationContextHandoffExtra, getConversationPinnedContext } from './pinnedContext';
import { normalizeModelContextSnapshot } from './contextSnapshot';
import type { parseContextSnapshot } from './contextSnapshot';
import { useCallback, useEffect, useRef, useState } from 'react';

type AionrsConversation = Extract<TChatConversation, { type: 'aionrs' }>;

export type CompactConversationContextInput = {
  conversationId: string;
  workspace: string;
  trigger: TContextCompactionTrigger;
  targetTurnId?: string;
  budgetStatus?: TContextBudgetStatus;
};

export type CompactConversationContextResult = {
  fileName: string;
  filePath: string;
  markdown: string;
  snapshot: NonNullable<ReturnType<typeof parseContextSnapshot>>;
  source: TContextGenerationSource;
  throughTurnId: string;
};

type ConversationUpdateInput = {
  id: string;
  updates: Partial<TChatConversation>;
  merge_extra?: boolean;
};

export type ContextCompactionDependencies = {
  getConversation: (conversationId: string) => Promise<TChatConversation | null>;
  loadMessages: (conversationId: string) => Promise<TMessage[]>;
  readFile: (input: { path: string; workspace: string }) => Promise<string | null>;
  writeFile: (input: { path: string; data: string; workspace: string }) => Promise<boolean>;
  updateConversation: (input: ConversationUpdateInput) => Promise<boolean>;
  compactRemote: (input: ICompactContextParams) => Promise<ICompactContextResult>;
  compactLocal: (input: ILocalContextCompactionParams) => Promise<ILocalContextCompactionResult>;
  emitRefresh: (conversationId: string) => void;
  now: () => number;
};

export class ContextCompactionOperationError extends Error {
  readonly code:
    | 'conversation_not_found'
    | 'unsupported_conversation'
    | 'file_write_failed'
    | 'metadata_write_failed'
    | 'invalid_pin_text'
    | 'context_file_missing';

  constructor(code: ContextCompactionOperationError['code']) {
    super(code);
    this.name = 'ContextCompactionOperationError';
    this.code = code;
  }
}

const defaultDependencies: ContextCompactionDependencies = {
  getConversation: getConversationOrNull,
  loadMessages: loadContextHandoffMessages,
  readFile: (input) => ipcBridge.fs.readFile.invoke(input),
  writeFile: (input) => ipcBridge.fs.writeFile.invoke(input),
  updateConversation: (input) => ipcBridge.conversation.update.invoke(input),
  compactRemote: (input) => ipcBridge.conversation.compactContext.invoke(input),
  compactLocal: async (input) => {
    const response = await ipcBridge.localContextCompaction.generate.invoke(input);
    if (response.ok === true) return response.result;
    throw Object.assign(new Error(response.error_code), { code: response.error_code });
  },
  emitRefresh: (conversationId) => {
    emitter.emit('aionrs.context-usage.refresh', conversationId);
    emitter.emit('aionrs.workspace.refresh');
  },
  now: Date.now,
};

const isAionrsConversation = (conversation: TChatConversation | null): conversation is AionrsConversation =>
  conversation?.type === 'aionrs';

const errorCode = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && error.code) {
    return error.code;
  }
  return fallback;
};

const isUnsupportedCompactEndpoint = (error: unknown): boolean =>
  isBackendHttpError(error) && (error.status === 404 || error.status === 501);

/** Backend persists aionrs models as { provider_id, model, use_model: null },
 *  not the TProviderWithModel shape the type declares. Accept both. */
type PersistedConversationModel = {
  id?: string;
  provider_id?: string;
  model?: string;
  use_model?: string | null;
};

const resolveConversationModelRef = (model: AionrsConversation['model']): { providerId: string; modelName: string } => {
  const persisted = model as PersistedConversationModel;
  return {
    providerId: persisted.provider_id || persisted.id || '',
    modelName: persisted.use_model || persisted.model || '',
  };
};

const conversationWithSnapshot = (
  conversation: AionrsConversation,
  snapshot: CompactConversationContextResult['snapshot']
): AionrsConversation => ({
  ...conversation,
  extra: {
    ...conversation.extra,
    context_handoff: {
      ...getConversationContextHandoffExtra(conversation),
      snapshot,
    },
  },
});

const patchContextState = async (
  conversation: AionrsConversation,
  updates: ReturnType<typeof buildContextSnapshotStatePatch>['context_handoff'],
  dependencies: ContextCompactionDependencies
): Promise<boolean> =>
  dependencies.updateConversation({
    id: conversation.id,
    updates: { extra: { context_handoff: updates } as TChatConversation['extra'] },
    merge_extra: true,
  });

export const compactConversationContext = async (
  input: CompactConversationContextInput,
  dependencies: ContextCompactionDependencies = defaultDependencies
): Promise<CompactConversationContextResult> => {
  const conversation = await dependencies.getConversation(input.conversationId);
  if (!conversation) throw new ContextCompactionOperationError('conversation_not_found');
  if (!isAionrsConversation(conversation)) throw new ContextCompactionOperationError('unsupported_conversation');

  const contextState = getConversationContextHandoffExtra(conversation);
  const pinnedContext = getConversationPinnedContext(conversation);
  const { fileName, filePath } = resolveContextFile(input.workspace);
  const [messages, currentMarkdown] = await Promise.all([
    dependencies.loadMessages(input.conversationId),
    dependencies.readFile({ path: filePath, workspace: input.workspace }),
  ]);
  const now = dependencies.now();

  const updating = buildContextSnapshotStatePatch(conversation, {
    source: contextState.source,
    status: 'updating',
    turnsSinceCompaction: contextState.turns_since_compaction,
    updatedAt: now,
    lastErrorCode: null,
    didPersistFileUpdate: false,
  });
  await patchContextState(conversation, updating.context_handoff, dependencies);

  const baseRequest: ICompactContextParams = {
    conversation_id: input.conversationId,
    trigger: input.trigger,
    previous_snapshot: contextState.snapshot,
    previous_markdown: currentMarkdown ?? undefined,
    pinned_context: pinnedContext,
    last_compacted_turn_id: contextState.last_compacted_turn_id,
  };

  let snapshot: CompactConversationContextResult['snapshot'] | null = null;
  let source: TContextGenerationSource = 'llm';
  let throughTurnId = input.targetTurnId || contextState.last_compacted_turn_id || '';
  let llmErrorCode: string | null = null;

  try {
    const remote = await dependencies.compactRemote(baseRequest);
    snapshot = normalizeModelContextSnapshot(remote.snapshot);
    throughTurnId = remote.through_turn_id || throughTurnId;
    if (!snapshot) llmErrorCode = 'invalid_model_output';
  } catch (remoteError) {
    if (isUnsupportedCompactEndpoint(remoteError)) {
      try {
        const modelRef = resolveConversationModelRef(conversation.model);
        const local = await dependencies.compactLocal({
          ...baseRequest,
          provider_id: modelRef.providerId,
          model: modelRef.modelName,
          target_turn_id: input.targetTurnId,
        });
        snapshot = normalizeModelContextSnapshot(local.snapshot);
        throughTurnId = local.through_turn_id || throughTurnId;
        if (!snapshot) llmErrorCode = 'invalid_model_output';
      } catch (localError) {
        llmErrorCode = errorCode(localError, 'provider_request_failed');
      }
    } else {
      llmErrorCode = errorCode(remoteError, 'provider_request_failed');
    }
  }

  let markdown: string;
  if (snapshot) {
    markdown = buildContextMarkdown({
      conversation: conversationWithSnapshot(conversation, snapshot),
      messages,
      currentMarkdown,
    });
  } else {
    source = 'rules';
    snapshot = buildFallbackContextSnapshot({ conversation, messages, currentMarkdown });
    markdown = buildFallbackContextMarkdown({ conversation, messages, currentMarkdown });
  }

  const saved = await dependencies.writeFile({ path: filePath, data: markdown, workspace: input.workspace });
  if (!saved) {
    const failed = buildContextSnapshotStatePatch(conversation, {
      source,
      status: 'failed',
      turnsSinceCompaction: contextState.turns_since_compaction,
      updatedAt: dependencies.now(),
      lastErrorCode: 'file_write_failed',
      didPersistFileUpdate: false,
    });
    await patchContextState(conversation, failed.context_handoff, dependencies);
    throw new ContextCompactionOperationError('file_write_failed');
  }

  const committed = buildContextSnapshotStatePatch(
    conversation,
    {
      snapshot,
      source,
      status: 'fresh',
      includedTurnId: throughTurnId,
      turnsSinceCompaction: 0,
      updatedAt: dependencies.now(),
      lastErrorCode: source === 'rules' ? llmErrorCode || 'llm_unavailable' : null,
      didPersistFileUpdate: true,
    },
    {
      context_file_name: fileName,
      context_file_path: filePath,
      last_exported_at: dependencies.now(),
      ...(input.budgetStatus ? { last_budget_status: input.budgetStatus } : {}),
    }
  );
  const updated = await patchContextState(conversation, committed.context_handoff, dependencies);
  if (!updated) throw new ContextCompactionOperationError('metadata_write_failed');

  dependencies.emitRefresh(input.conversationId);
  return { fileName, filePath, markdown, snapshot, source, throughTurnId };
};

export type PinConversationContextInput = {
  conversationId: string;
  workspace: string;
  text: string;
};

export type PinConversationContextDependencies = {
  getConversation: (conversationId: string) => Promise<TChatConversation | null>;
  updateConversation: (input: ConversationUpdateInput) => Promise<boolean>;
  compactContext: (input: CompactConversationContextInput) => Promise<CompactConversationContextResult | null>;
  createId: () => string;
  now: () => number;
};

const defaultPinDependencies: PinConversationContextDependencies = {
  getConversation: getConversationOrNull,
  updateConversation: (input) => ipcBridge.conversation.update.invoke(input),
  compactContext: (input) => compactConversationContext(input),
  createId: uuid,
  now: Date.now,
};

export type PinConversationContextResult = {
  pin: TContextHandoffItem;
  compaction: CompactConversationContextResult | null;
};

export const pinConversationContext = async (
  input: PinConversationContextInput,
  dependencyOverrides: Partial<PinConversationContextDependencies> = {}
): Promise<PinConversationContextResult> => {
  const dependencies = { ...defaultPinDependencies, ...dependencyOverrides };
  const conversation = await dependencies.getConversation(input.conversationId);
  if (!conversation) throw new ContextCompactionOperationError('conversation_not_found');
  if (!isAionrsConversation(conversation)) throw new ContextCompactionOperationError('unsupported_conversation');

  const pinnedContext = addPinnedContext({
    items: getConversationPinnedContext(conversation),
    title: '',
    content: input.text,
    source: 'manual',
    now: dependencies.now(),
    createId: dependencies.createId,
  });
  const pin = pinnedContext.at(-1);
  if (!pin || !input.text.trim()) throw new ContextCompactionOperationError('invalid_pin_text');

  const patch = buildContextHandoffExtraPatch(conversation, { pinned_context: pinnedContext });
  const updated = await dependencies.updateConversation({
    id: conversation.id,
    updates: { extra: patch as TChatConversation['extra'] },
    merge_extra: true,
  });
  if (!updated) throw new ContextCompactionOperationError('metadata_write_failed');

  const compaction = await dependencies.compactContext({
    conversationId: input.conversationId,
    workspace: input.workspace,
    trigger: 'manual',
  });
  return { pin, compaction };
};

export type HandoffConversationContextInput = {
  conversationId: string;
  workspace: string;
};

export type HandoffConversationContextDependencies = {
  getConversation: (conversationId: string) => Promise<TChatConversation | null>;
  compactContext: (input: CompactConversationContextInput) => Promise<CompactConversationContextResult | null>;
  readFile: (input: { path: string; workspace: string }) => Promise<string | null>;
  createConversation: (input: { conversation: TChatConversation }) => Promise<TChatConversation>;
  createId: () => string;
  now: () => number;
};

const defaultHandoffDependencies: HandoffConversationContextDependencies = {
  getConversation: getConversationOrNull,
  compactContext: (input) => compactConversationContext(input),
  readFile: (input) => ipcBridge.fs.readFile.invoke(input),
  createConversation: (input) => ipcBridge.conversation.createWithConversation.invoke(input),
  createId: uuid,
  now: Date.now,
};

export const isContextHandoffStale = (conversation: AionrsConversation): boolean => {
  const contextState = getConversationContextHandoffExtra(conversation);
  return (
    !contextState.context_file_path || contextState.status !== 'fresh' || (contextState.turns_since_compaction ?? 0) > 0
  );
};

export type HandoffConversationContextResult = {
  conversation: AionrsConversation;
  markdown: string;
};

const buildContinuationConversation = (
  source: AionrsConversation,
  input: { id: string; now: number; markdown: string; fileName: string; filePath: string }
): AionrsConversation => {
  const {
    context_handoff: _contextHandoff,
    context: _context,
    context_file_name: _contextFileName,
    last_token_usage: _lastTokenUsage,
    cron_job_id: _cronJobId,
    is_health_check: _isHealthCheck,
    pinned: _pinned,
    pinned_at: _pinnedAt,
    ...stableExtra
  } = source.extra;

  return {
    ...source,
    id: input.id,
    created_at: input.now,
    modified_at: input.now,
    status: undefined,
    runtime: undefined,
    extra: {
      ...stableExtra,
      context: input.markdown,
      context_file_name: input.fileName,
      context_handoff: {
        pinned_context: getConversationPinnedContext(source),
        context_file_path: input.filePath,
        context_file_name: input.fileName,
        source: 'user',
        status: 'fresh',
        turns_since_compaction: 0,
        updated_at: input.now,
      },
    },
  };
};

export const handoffConversationContext = async (
  input: HandoffConversationContextInput,
  dependencyOverrides: Partial<HandoffConversationContextDependencies> = {}
): Promise<HandoffConversationContextResult> => {
  const dependencies = { ...defaultHandoffDependencies, ...dependencyOverrides };
  const initialConversation = await dependencies.getConversation(input.conversationId);
  if (!initialConversation) throw new ContextCompactionOperationError('conversation_not_found');
  if (!isAionrsConversation(initialConversation)) {
    throw new ContextCompactionOperationError('unsupported_conversation');
  }

  if (isContextHandoffStale(initialConversation)) {
    await dependencies.compactContext({
      conversationId: input.conversationId,
      workspace: input.workspace,
      trigger: 'handoff',
    });
  }

  const latestConversation = await dependencies.getConversation(input.conversationId);
  if (!latestConversation) throw new ContextCompactionOperationError('conversation_not_found');
  if (!isAionrsConversation(latestConversation)) {
    throw new ContextCompactionOperationError('unsupported_conversation');
  }

  const contextState = getConversationContextHandoffExtra(latestConversation);
  const resolvedFile = resolveContextFile(input.workspace);
  const filePath = contextState.context_file_path || resolvedFile.filePath;
  const fileName = contextState.context_file_name || resolvedFile.fileName;
  const markdown = await dependencies.readFile({ path: filePath, workspace: input.workspace });
  if (markdown === null) throw new ContextCompactionOperationError('context_file_missing');

  const nextConversation = buildContinuationConversation(latestConversation, {
    id: dependencies.createId(),
    now: dependencies.now(),
    markdown,
    fileName,
    filePath,
  });
  const created = await dependencies.createConversation({ conversation: nextConversation });
  if (!isAionrsConversation(created)) throw new ContextCompactionOperationError('unsupported_conversation');
  return { conversation: created, markdown };
};

const readCompletedTurnText = (event: IConversationTurnCompletedEvent): string => {
  const content = event.last_message.content;
  if (typeof content === 'string') return content.trim();
  if (!content || typeof content !== 'object' || Array.isArray(content)) return '';
  if ('content' in content && typeof content.content === 'string') return content.content.trim();
  return '';
};

export const isMeaningfulContextTurn = (event: IConversationTurnCompletedEvent): boolean => {
  if (event.status !== 'finished' || event.state !== 'ai_waiting_input') return false;
  if (event.last_message.type && event.last_message.type !== 'text') return false;
  if (!event.last_message.type) return true;
  return readCompletedTurnText(event).length > 0;
};

type AutoCompactPolicyInput = {
  hasContext: boolean;
  turnsSinceCompaction: number;
  previousBudgetStatus: TContextBudgetStatus;
  nextBudgetStatus: TContextBudgetStatus;
};

const BUDGET_STATUS_RANK: Record<TContextBudgetStatus, number> = {
  healthy: 0,
  watch: 1,
  compress: 2,
  too_large: 3,
};

export const shouldAutoCompactContext = (input: AutoCompactPolicyInput): boolean => {
  if (!input.hasContext) return true;
  if (input.turnsSinceCompaction >= 1) return true;
  return (
    BUDGET_STATUS_RANK[input.nextBudgetStatus] > BUDGET_STATUS_RANK[input.previousBudgetStatus] &&
    BUDGET_STATUS_RANK[input.nextBudgetStatus] >= BUDGET_STATUS_RANK.watch
  );
};

const runtimeBudgetStatus = (
  conversation: AionrsConversation,
  fallback: TContextBudgetStatus
): TContextBudgetStatus => {
  const extra = conversation.extra as Record<string, unknown>;
  const usage = extra.last_token_usage;
  const limit = resolveConversationContextLimit(conversation);
  if (!usage || typeof usage !== 'object' || typeof limit !== 'number' || limit <= 0) return fallback;
  const total = (usage as { total_tokens?: unknown }).total_tokens;
  if (typeof total !== 'number' || total < 0) return fallback;
  const ratio = total / limit;
  if (ratio >= 0.9) return 'too_large';
  if (ratio >= 0.5) return 'compress';
  if (ratio >= 0.35) return 'watch';
  return 'healthy';
};

type HookCompactionRequest = CompactConversationContextInput;

export type ContextCompactionHookDependencies = {
  subscribeTurnCompleted: (listener: (event: IConversationTurnCompletedEvent) => void) => () => void;
  getConversation: (conversationId: string) => Promise<TChatConversation | null>;
  updateConversation: (input: ConversationUpdateInput) => Promise<boolean>;
  runCompaction: (input: CompactConversationContextInput) => Promise<CompactConversationContextResult>;
  now: () => number;
};

const defaultHookDependencies: ContextCompactionHookDependencies = {
  subscribeTurnCompleted: (listener) => ipcBridge.conversation.turnCompleted.on(listener),
  getConversation: getConversationOrNull,
  updateConversation: (input) => ipcBridge.conversation.update.invoke(input),
  runCompaction: (input) => compactConversationContext(input),
  now: Date.now,
};

export type UseContextCompactionInput = {
  conversationId: string;
  workspace: string;
  enabled?: boolean;
  dependencies?: ContextCompactionHookDependencies;
};

export type UseContextCompactionResult = {
  compact: (
    trigger?: TContextCompactionTrigger,
    targetTurnId?: string,
    budgetStatus?: TContextBudgetStatus
  ) => Promise<CompactConversationContextResult | null>;
  isCompacting: boolean;
};

export const useContextCompaction = ({
  conversationId,
  workspace,
  enabled = true,
  dependencies = defaultHookDependencies,
}: UseContextCompactionInput): UseContextCompactionResult => {
  const [isCompacting, setIsCompacting] = useState(false);
  const inFlightRef = useRef<Promise<CompactConversationContextResult | null> | null>(null);
  const pendingRequestRef = useRef<HookCompactionRequest | null>(null);
  const pendingTurnRef = useRef<IConversationTurnCompletedEvent | null>(null);
  const processingTurnRef = useRef(false);

  const compact = useCallback(
    (
      trigger: TContextCompactionTrigger = 'manual',
      targetTurnId?: string,
      budgetStatus?: TContextBudgetStatus
    ): Promise<CompactConversationContextResult | null> => {
      const request: HookCompactionRequest = {
        conversationId,
        workspace,
        trigger,
        targetTurnId,
        budgetStatus,
      };
      if (inFlightRef.current) {
        pendingRequestRef.current = request;
        return inFlightRef.current;
      }

      const run = async (): Promise<CompactConversationContextResult | null> => {
        setIsCompacting(true);
        let current: HookCompactionRequest | null = request;
        let result: CompactConversationContextResult | null = null;
        let firstError: unknown;
        while (current) {
          pendingRequestRef.current = null;
          try {
            // eslint-disable-next-line no-await-in-loop -- coalesced compactions must commit in request order
            result = await dependencies.runCompaction(current);
          } catch (error) {
            firstError ??= error;
          }
          current = pendingRequestRef.current;
        }
        if (firstError) throw firstError;
        return result;
      };

      const promise = run().finally(() => {
        inFlightRef.current = null;
        setIsCompacting(false);
      });
      inFlightRef.current = promise;
      return promise;
    },
    [conversationId, dependencies, workspace]
  );

  useEffect(() => {
    if (!enabled || !conversationId) return;

    let cancelled = false;
    void (async () => {
      const conversation = await dependencies.getConversation(conversationId);
      if (cancelled || inFlightRef.current || !isAionrsConversation(conversation)) return;

      const contextState = getConversationContextHandoffExtra(conversation);
      if (contextState.status !== 'updating') return;

      const pending = buildContextSnapshotStatePatch(conversation, {
        source: contextState.source,
        status: 'stale',
        turnsSinceCompaction: contextState.turns_since_compaction,
        updatedAt: dependencies.now(),
        lastErrorCode: 'interrupted',
        didPersistFileUpdate: false,
      });
      await dependencies.updateConversation({
        id: conversation.id,
        updates: { extra: pending as TChatConversation['extra'] },
        merge_extra: true,
      });
    })().catch((error) => {
      console.warn('[ContextHandoff] Interrupted compaction recovery failed:', errorCode(error, 'unknown'));
    });

    return () => {
      cancelled = true;
    };
  }, [conversationId, dependencies, enabled]);

  const handleCompletedTurn = useCallback(
    async (event: IConversationTurnCompletedEvent): Promise<void> => {
      const conversation = await dependencies.getConversation(conversationId);
      if (!isAionrsConversation(conversation)) return;

      const contextState = getConversationContextHandoffExtra(conversation);
      const turnsSinceCompaction = (contextState.turns_since_compaction ?? 0) + 1;
      const previousBudgetStatus = contextState.last_budget_status ?? 'healthy';
      const nextBudgetStatus = runtimeBudgetStatus(conversation, previousBudgetStatus);
      const hasContext = Boolean(contextState.snapshot || contextState.context_file_path);

      if (
        shouldAutoCompactContext({
          hasContext,
          turnsSinceCompaction,
          previousBudgetStatus,
          nextBudgetStatus,
        })
      ) {
        await compact('auto', event.turn_id, nextBudgetStatus);
        return;
      }

      const stale = buildContextSnapshotStatePatch(
        conversation,
        {
          source: contextState.source,
          status: 'stale',
          turnsSinceCompaction,
          updatedAt: dependencies.now(),
          lastErrorCode: null,
          didPersistFileUpdate: false,
        },
        { last_budget_status: nextBudgetStatus }
      );
      await dependencies.updateConversation({
        id: conversation.id,
        updates: { extra: stale as TChatConversation['extra'] },
        merge_extra: true,
      });
    },
    [compact, conversationId, dependencies]
  );

  useEffect(() => {
    if (!enabled || !conversationId) return;

    const processTurn = (event: IConversationTurnCompletedEvent): void => {
      if (event.session_id !== conversationId || !isMeaningfulContextTurn(event)) return;
      if (processingTurnRef.current) {
        pendingTurnRef.current = event;
        return;
      }

      processingTurnRef.current = true;
      void (async () => {
        let current: IConversationTurnCompletedEvent | null = event;
        while (current) {
          pendingTurnRef.current = null;
          try {
            // eslint-disable-next-line no-await-in-loop -- completed turns must update the shared cursor serially
            await handleCompletedTurn(current);
          } catch (error) {
            console.warn('[ContextHandoff] Automatic compaction failed:', errorCode(error, 'unknown'));
          }
          current = pendingTurnRef.current;
        }
      })().finally(() => {
        processingTurnRef.current = false;
      });
    };

    return dependencies.subscribeTurnCompleted(processTurn);
  }, [conversationId, dependencies, enabled, handleCompletedTurn]);

  return { compact, isCompacting };
};
