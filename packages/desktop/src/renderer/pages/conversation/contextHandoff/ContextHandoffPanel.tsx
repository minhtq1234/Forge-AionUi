import { ipcBridge } from '@/common';
import type {
  IConversationMcpStatus,
  TChatConversation,
  TContextHandoffExtra,
  TContextHandoffItem,
  TokenUsageData,
} from '@/common/config/storage';
import { uuid } from '@/common/utils';
import { useMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { Button, Input, Message, Modal, Progress, Space, Tooltip, Typography } from '@arco-design/web-react';
import { Add, Attention, Delete, Edit, FileText, Pin } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { estimateContextBudget } from './contextBudget';
import { buildContextHandoffExtraPatch } from './contextConversationUpdate';
import { resolveContextFile } from './contextFile';
import { resolveConversationContextLimit } from './contextLimit';
import { buildContextMarkdown } from './contextMarkdown';
import { loadContextHandoffMessages, selectContextHandoffMessages } from './contextMessages';
import {
  addPinnedContext,
  getConversationContextHandoffExtra,
  getConversationPinnedContext,
  removePinnedContext,
  updatePinnedContext,
} from './pinnedContext';
import type { CompactConversationContextResult } from './useContextCompaction';

type ContextHandoffPanelProps = {
  conversationId: string;
  workspace: string;
  loadedSkills?: string[];
  loadedMcpStatuses?: IConversationMcpStatus[];
  onCreateContext?: () => Promise<CompactConversationContextResult | null>;
  onPreviewOpen?: () => void;
  isCompacting?: boolean;
};

type PinDraft = {
  id?: string;
  title: string;
  content: string;
};

type AionrsConversation = Extract<TChatConversation, { type: 'aionrs' }>;

const EMPTY_PIN_DRAFT: PinDraft = { title: '', content: '' };

const formatBudgetRatio = (ratio: number | null): string => {
  if (ratio === null) return '--';
  const percent = ratio * 100;
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
};

const budgetPercent = (ratio: number | null): number => {
  if (ratio === null) return 0;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
};

const isAionrsConversation = (conversation: TChatConversation | null): conversation is AionrsConversation => {
  return conversation?.type === 'aionrs';
};

const getConversationTokenUsage = (conversation: TChatConversation | null): TokenUsageData | null => {
  if (!conversation || !('last_token_usage' in conversation.extra)) return null;
  const usage = conversation.extra.last_token_usage;
  return usage && usage.total_tokens > 0 ? usage : null;
};

const getGenerationStateKey = (contextState: TContextHandoffExtra) => {
  // A failed update is surfaced as a hover-able "!" badge, not as inline text.
  // Successful AI updates intentionally show no status — the file tile just
  // reads "Active handoff".
  if (contextState.status === 'updating') return 'conversation.contextHandoff.status.updating' as const;
  if (contextState.status === 'stale') return 'conversation.contextHandoff.status.stale' as const;
  if (contextState.source === 'rules') return 'conversation.contextHandoff.status.rulesFallback' as const;
  if (contextState.source === 'user' && contextState.status === 'fresh') {
    return 'conversation.contextHandoff.status.edited' as const;
  }
  return null;
};

const CONTEXT_ERROR_KEYS = {
  invalid_model_output: 'conversation.contextHandoff.status.error.invalidModelOutput',
  provider_request_failed: 'conversation.contextHandoff.status.error.providerRequestFailed',
  provider_not_found: 'conversation.contextHandoff.status.error.providerNotFound',
  interrupted: 'conversation.contextHandoff.status.error.interrupted',
} as const;

const getContextErrorKey = (code?: string) =>
  code && code in CONTEXT_ERROR_KEYS
    ? CONTEXT_ERROR_KEYS[code as keyof typeof CONTEXT_ERROR_KEYS]
    : ('conversation.contextHandoff.status.error.unknown' as const);

const ContextHandoffPanel: React.FC<ContextHandoffPanelProps> = ({
  conversationId,
  workspace,
  loadedSkills = [],
  loadedMcpStatuses = [],
  onCreateContext,
  onPreviewOpen,
  isCompacting = false,
}) => {
  const { t } = useTranslation();
  const liveMessages = useMessageList();
  const preview = usePreviewContext();
  const [conversation, setConversation] = useState<TChatConversation | null>(null);
  const [loadedMessages, setLoadedMessages] = useState(() => [] as ReturnType<typeof useMessageList>);
  const [loading, setLoading] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState<PinDraft>(EMPTY_PIN_DRAFT);

  const refreshConversation = useCallback(async () => {
    setConversation(await getConversationOrNull(conversationId));
  }, [conversationId]);

  const refreshMessages = useCallback(async () => {
    try {
      setLoadedMessages(await loadContextHandoffMessages(conversationId));
    } catch (error) {
      console.error('[ContextHandoff] Failed to load conversation messages:', error);
      setLoadedMessages([]);
    }
  }, [conversationId]);

  useEffect(() => {
    void refreshConversation();
    void refreshMessages();
  }, [refreshConversation, refreshMessages]);

  useAddEventListener(
    'aionrs.context-usage.refresh',
    (updatedConversationId) => {
      if (updatedConversationId === conversationId) {
        void refreshConversation();
        void refreshMessages();
      }
    },
    [conversationId, refreshConversation, refreshMessages]
  );

  const messages = useMemo(
    () => selectContextHandoffMessages(liveMessages, loadedMessages),
    [liveMessages, loadedMessages]
  );
  const pinnedContext = useMemo(() => getConversationPinnedContext(conversation), [conversation]);
  const currentContextFile = getConversationContextHandoffExtra(conversation);
  const generationStateKey = isCompacting
    ? ('conversation.contextHandoff.status.updating' as const)
    : getGenerationStateKey(currentContextFile);
  const hasContextFile = Boolean(currentContextFile.context_file_path);
  const hasContextError = !isCompacting && currentContextFile.status === 'failed';
  const contextErrorMessage = t(getContextErrorKey(currentContextFile.last_error_code));
  const contextFileName = currentContextFile.context_file_name || resolveContextFile(workspace).fileName;
  const contextLimit = resolveConversationContextLimit(conversation);
  const runtimeTokenUsage = getConversationTokenUsage(conversation);
  const contextMarkdown = useMemo(
    () =>
      conversation
        ? buildContextMarkdown({
            conversation,
            messages,
          })
        : '',
    [conversation, messages]
  );

  const budget = useMemo(
    () =>
      estimateContextBudget({
        messages,
        pinnedContext,
        contextMarkdown,
        contextLimit,
        runtimeTokenUsage,
        skillNames: loadedSkills,
        toolNames: loadedMcpStatuses.map((status) => status.name),
      }),
    [contextLimit, contextMarkdown, loadedMcpStatuses, loadedSkills, messages, pinnedContext, runtimeTokenUsage]
  );

  const updateContextHandoff = useCallback(
    async (source: AionrsConversation, updates: Partial<TContextHandoffExtra>) => {
      const ok = await ipcBridge.conversation.update.invoke({
        id: source.id,
        updates: {
          extra: buildContextHandoffExtraPatch(source, updates) as TChatConversation['extra'],
        },
        merge_extra: true,
      });
      if (ok) {
        setConversation({
          ...source,
          extra: {
            ...source.extra,
            context_handoff: {
              ...getConversationContextHandoffExtra(source),
              ...updates,
            },
          },
        });
      }
      return Boolean(ok);
    },
    []
  );

  const openContextPreview = useCallback(
    (content: string, fileName: string, filePath: string) => {
      preview.openPreview(content, 'markdown', {
        title: fileName,
        file_name: fileName,
        file_path: filePath,
        workspace,
        editable: true,
      });
    },
    [preview, workspace]
  );

  const handleNewContext = useCallback(async () => {
    const source = await getConversationOrNull(conversationId);
    if (!isAionrsConversation(source)) return;
    setLoading(true);
    try {
      if (onCreateContext) {
        const result = await onCreateContext();
        if (!result) throw new Error(t('conversation.contextHandoff.exportFailed'));
        openContextPreview(result.markdown, result.fileName, result.filePath);
        await Promise.all([refreshConversation(), refreshMessages()]);
        Message.success(t('conversation.contextHandoff.replaceSuccess'));
        onPreviewOpen?.();
        return;
      }

      const { fileName, filePath } = resolveContextFile(workspace);
      const markdown = buildContextMarkdown({ conversation: source, messages });
      const saved = await ipcBridge.fs.writeFile.invoke({ path: filePath, data: markdown, workspace });
      if (!saved) throw new Error(t('conversation.contextHandoff.exportFailed'));
      await updateContextHandoff(source, {
        context_file_path: filePath,
        context_file_name: fileName,
        last_budget_status: budget.status,
        last_exported_at: Date.now(),
      });
      openContextPreview(markdown, fileName, filePath);
      emitter.emit('aionrs.workspace.refresh');
      Message.success(t('conversation.contextHandoff.replaceSuccess'));
      onPreviewOpen?.();
    } catch (error) {
      console.error('[ContextHandoff] Failed to write Context.md:', error);
      Message.error(error instanceof Error ? error.message : t('conversation.contextHandoff.exportFailed'));
    } finally {
      setLoading(false);
    }
  }, [
    budget.status,
    conversationId,
    messages,
    onCreateContext,
    onPreviewOpen,
    openContextPreview,
    refreshConversation,
    refreshMessages,
    t,
    updateContextHandoff,
    workspace,
  ]);

  const handleOpenContext = useCallback(async () => {
    const filePath = currentContextFile.context_file_path;
    const fileName = currentContextFile.context_file_name || resolveContextFile(workspace).fileName;
    if (!filePath) {
      await handleNewContext();
      return;
    }
    const content = await ipcBridge.fs.readFile.invoke({ path: filePath, workspace });
    if (content === null) {
      await handleNewContext();
      return;
    }
    openContextPreview(content, fileName, filePath);
    onPreviewOpen?.();
  }, [
    currentContextFile.context_file_name,
    currentContextFile.context_file_path,
    handleNewContext,
    onPreviewOpen,
    openContextPreview,
    workspace,
  ]);

  const handleSavePin = useCallback(async () => {
    if (!isAionrsConversation(conversation)) return;
    const now = Date.now();
    const nextPinnedContext = pinDraft.id
      ? updatePinnedContext({
          items: pinnedContext,
          id: pinDraft.id,
          title: pinDraft.title,
          content: pinDraft.content,
          now,
        })
      : addPinnedContext({
          items: pinnedContext,
          title: pinDraft.title,
          content: pinDraft.content,
          source: 'manual',
          now,
          createId: uuid,
        });
    await updateContextHandoff(conversation, { pinned_context: nextPinnedContext });
    setPinModalOpen(false);
    setPinDraft(EMPTY_PIN_DRAFT);
  }, [conversation, pinDraft, pinnedContext, updateContextHandoff]);

  const handleRemovePin = useCallback(
    async (item: TContextHandoffItem) => {
      if (!isAionrsConversation(conversation)) return;
      await updateContextHandoff(conversation, { pinned_context: removePinnedContext(pinnedContext, item.id) });
    },
    [conversation, pinnedContext, updateContextHandoff]
  );

  return (
    <div className='context-handoff-panel'>
      <div className='context-handoff-summary'>
        <div className='context-handoff-summary-row'>
          <Tooltip content={t('conversation.contextHandoff.openTooltip')}>
            <Button
              className='context-handoff-file'
              type='text'
              loading={loading || isCompacting}
              onClick={() => void handleOpenContext()}
            >
              <span className='context-handoff-file-icon'>
                <FileText theme='outline' size='15' />
              </span>
              <div className='context-handoff-file-copy'>
                <div className='context-handoff-file-name'>{contextFileName}</div>
                <div className='context-handoff-file-state'>
                  {generationStateKey
                    ? t(generationStateKey)
                    : hasContextFile
                      ? t('conversation.contextHandoff.activeFileDescription')
                      : t('conversation.contextHandoff.emptyFileDescription')}
                </div>
              </div>
            </Button>
          </Tooltip>
          {hasContextError && (
            <Tooltip content={contextErrorMessage}>
              <span className='context-handoff-file-alert' role='img' aria-label={contextErrorMessage}>
                <Attention theme='outline' size='16' />
              </span>
            </Tooltip>
          )}
        </div>
        <div className='context-handoff-budget'>
          <div className='context-handoff-budget-label'>
            <span>{t('conversation.contextHandoff.budgetLabel')}</span>
            <span>{formatBudgetRatio(budget.ratio)}</span>
          </div>
          <Progress
            percent={budgetPercent(budget.ratio)}
            showText={false}
            size='small'
            color={`rgb(var(--${budget.status === 'too_large' ? 'danger' : budget.status === 'compress' ? 'warning' : 'primary'}-6))`}
          />
        </div>
      </div>

      <div className='context-handoff-pinned-header'>
        <div className='context-handoff-pinned-title'>
          <Pin theme='outline' size='14' />
          <span>{t('conversation.contextHandoff.pinnedTitle')}</span>
        </div>
        <Tooltip content={t('conversation.contextHandoff.addPinned')}>
          <Button
            size='mini'
            type='text'
            aria-label={t('conversation.contextHandoff.addPinned')}
            icon={<Add theme='outline' size='14' />}
            onClick={() => {
              setPinDraft(EMPTY_PIN_DRAFT);
              setPinModalOpen(true);
            }}
          />
        </Tooltip>
      </div>

      {pinnedContext.length > 0 ? (
        <div className='context-handoff-pin-list'>
          {pinnedContext.map((item) => (
            <div key={item.id} className='context-handoff-pin-item'>
              <Typography.Paragraph className='!m-0 flex-1 !text-12px' ellipsis={{ rows: 2 }}>
                {item.title ? `${item.title}: ${item.content}` : item.content}
              </Typography.Paragraph>
              <Space size={2}>
                <Tooltip content={t('common.edit')}>
                  <Button
                    size='mini'
                    type='text'
                    icon={<Edit theme='outline' size='14' />}
                    onClick={() => {
                      setPinDraft({ id: item.id, title: item.title, content: item.content });
                      setPinModalOpen(true);
                    }}
                  />
                </Tooltip>
                <Tooltip content={t('common.delete')}>
                  <Button
                    size='mini'
                    type='text'
                    status='danger'
                    icon={<Delete theme='outline' size='14' />}
                    onClick={() => void handleRemovePin(item)}
                  />
                </Tooltip>
              </Space>
            </div>
          ))}
        </div>
      ) : (
        <div className='context-handoff-empty'>{t('conversation.contextHandoff.emptyPinned')}</div>
      )}

      <Modal
        visible={pinModalOpen}
        title={t(pinDraft.id ? 'conversation.contextHandoff.editPinned' : 'conversation.contextHandoff.addPinned')}
        onOk={() => void handleSavePin()}
        onCancel={() => setPinModalOpen(false)}
        okButtonProps={{ disabled: !pinDraft.content.trim() }}
      >
        <Space direction='vertical' size='medium' className='w-full'>
          <Input
            value={pinDraft.title}
            placeholder={t('conversation.contextHandoff.pinTitlePlaceholder')}
            onChange={(value) => setPinDraft((prev) => ({ ...prev, title: value }))}
          />
          <Input.TextArea
            value={pinDraft.content}
            placeholder={t('conversation.contextHandoff.pinContentPlaceholder')}
            autoSize={{ minRows: 4, maxRows: 8 }}
            onChange={(value) => setPinDraft((prev) => ({ ...prev, content: value }))}
          />
        </Space>
      </Modal>
    </div>
  );
};

export default ContextHandoffPanel;
