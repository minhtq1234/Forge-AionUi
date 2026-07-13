import type { BadgeProps } from '@arco-design/web-react';
import { Badge, Button, Message, Tooltip } from '@arco-design/web-react';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import { Attention, CheckOne, Download, LoadingOne, Right } from '@icon-park/react';
import { theme } from '@office-ai/platform';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getAcpImageFileName } from '@/common/chat/acpToolCallOutput';
import { coalesceToolCalls } from '@/common/chat/toolActivity/coalesceToolCalls';
import type { CoalescedStep } from '@/common/chat/toolActivity/types';
import type { NormalizedToolCall, NormalizedToolStatus, ToolMessage } from '@/common/chat/normalizeToolCall';
import { isDiagnosticTelemetryText, normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import LocalImageView from '@/renderer/components/media/LocalImageView';
import type { WorkJournalSourceMessage } from '@/renderer/pages/conversation/Messages/types';
import { iconColors } from '@/renderer/styles/colors';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import { buildTurnWorkRecap } from './toolActivity/buildTurnWorkRecap';
import ToolActivityError from './toolActivity/ToolActivityError';
import { useToolActionText } from './toolActivity/useToolActionText';
import './MessageToolGroupSummary.css';

const statusToBadge = (status: NormalizedToolStatus): BadgeProps['status'] => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    case 'canceled':
      return 'default';
    case 'pending':
    default:
      return 'default';
  }
};

type JournalRow =
  | {
      key: string;
      kind: 'narration';
      label: string;
      status: NormalizedToolStatus;
      isFallback?: boolean;
      fallbackDoneLabel?: string;
    }
  | { key: string; kind: 'tool'; step: CoalescedStep; status: NormalizedToolStatus };

const planStatus: Record<'pending' | 'in_progress' | 'completed', NormalizedToolStatus> = {
  pending: 'pending',
  in_progress: 'running',
  completed: 'completed',
};

const PROVIDER_NARRATION_MAX_LENGTH = 180;
const SHELL_COMMAND =
  '(?:aws|az|bash|bunx?|cat|cargo|cmake|cmd|cp|curl|deno|docker|dotnet|echo|env|fd|find|fish|gcloud|gh|git|go|gradle|grep|helm|java|jq|just|kubectl|make|mkdir|mv|mvn|node|npm|npx|perl|pip3?|pnpm|podman|powershell|pwd|pwsh|pytest|python(?:3(?:\\.\\d+)?)?|rg|rm|ruby|sed|sh|sudo|swift|terraform|test|vitest|wget|xcodebuild|yarn|yq|zsh)';
const SHELL_COMMAND_WORD = new RegExp(`^${SHELL_COMMAND}$`, 'i');
const NATURAL_COMMAND_VERBS = new Set(['echo', 'find', 'test']);
const NATURAL_COMMAND_DETERMINERS = new Set(['a', 'an', 'our', 'the', 'these', 'this', 'those', 'your']);
const LABELED_SHELL_COMMAND = new RegExp(
  `^(?:(?:first|next|then|now|finally)\\s*[:,]?\\s+)?(?:(?:i(?:'m| am)?|we(?:'re| are)?)\\s+)?(?:check(?:ed|ing)?|command|complet(?:ed|ing)?|execute|executed|executing|finish(?:ed|ing)?|run|running|test(?:ed|ing)?)(?:\\s+(?:(?:the\\s+)?command|execute|executing|run|running|test|testing))?\\s*:?\\s+(?:(?:sudo|env)\\s+)?${SHELL_COMMAND}(?:\\s|$)`,
  'i'
);
const COMMAND_LABEL_SHELL_COMMAND = new RegExp(
  `\\bcommand\\b[^:\\r\\n]{0,30}:\\s*(?:(?:sudo|env)\\s+)?${SHELL_COMMAND}(?:\\s|$)`,
  'i'
);
const DIAGNOSTIC_NARRATION = /\b(?:local_estimate|token\s+watermark|microcompact)\b/i;
const TELEMETRY_IDENTIFIER = /\b(?:request|trace|session|provider|token)(?:[\s_-]*(?:id|identifier))?\s*[:=]\s*\S+/i;
const FILE_PATH_TOKEN =
  /\b[\w@.-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|css|scss|less|html?|py|rs|go|java|kt|swift|sh|bash|zsh|fish|sql|lock)\b/i;
const ROOTED_PATH =
  /(?:^|\s)(?:(?:\.{1,2}|~)?[\\/]|[a-z]:[\\/]|\\\\|(?:src|packages|tests?|docs?|app|lib|components|server|client)[\\/])\S+/i;
const NESTED_PATH = /(?:^|\s)(?:[\w@.-]+[\\/]){2,}[\w@.-]+|(?:^|\s)[\w@.-]+[\\/][\w@.-]+\.[a-z0-9]{1,10}\b/i;
const NATURAL_SLASH_PHRASE = /\b(?:and\/or|input\/output|read\/write|ui\/ux)\b/gi;
const NATURAL_NARRATION_START =
  /^(?:i(?:'m| am| will|'ll)|we(?:'re| are| will|'ll)|first|next|then|now|finally|active|queued|finished|completed|pending|add(?:ing)?|analyz(?:e|ing)|apply(?:ing)?|build(?:ing)?|check(?:ing)?|choos(?:e|ing)|compar(?:e|ing)|complet(?:e|ing)|creat(?:e|ing)|decid(?:e|ing)|echo(?:ing)?|explor(?:e|ing)|find(?:ing)?|finish(?:ing)?|fix(?:ing)?|generat(?:e|ing)|identif(?:y|ying)|implement(?:ing)?|inspect(?:ing)?|investigat(?:e|ing)|keep(?:ing)?|load(?:ing)?|locat(?:e|ing)|open(?:ing)?|plan(?:ning)?|prepar(?:e|ing)|read(?:ing)?|review(?:ing)?|run(?:ning)?|search(?:ing)?|settle|settling|summariz(?:e|ing)|test(?:ing)?|trac(?:e|ing)|understand(?:ing)?|updat(?:e|ing)|validat(?:e|ing)|verif(?:y|ying)|writ(?:e|ing))\b/i;
const AMBIGUOUS_COMMAND_NARRATION_START = /^(?:build|echo|find|run|test)\b/i;
const NATURAL_SENTENCE_CONNECTOR = /\b(?:a|an|and|after|before|for|the|to|while|with|without)\b/i;
const UNSAFE_PROVIDER_NARRATION = [
  LABELED_SHELL_COMMAND,
  COMMAND_LABEL_SHELL_COMMAND,
  /[\r\n`]|~~~|&&|\|\||[|;<>]|(?:^|\s)&(?:\s|$)|\$\(|\$\{/,
  /\b(?:https?|file|ftp):|(?:^|\s)www\./i,
  /\b[a-z_][\w.-]*\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/i,
  /(?:[{}]|\[|\])|=>/,
  /(?:^|\s)--?[a-z][\w-]*(?:\s|=|$)/i,
  /^\s*[$#>%]\s*\S+/,
  TELEMETRY_IDENTIFIER,
  FILE_PATH_TOKEN,
  ROOTED_PATH,
  NESTED_PATH,
];

const containsShellCommandPhrase = (narration: string): boolean => {
  const words: string[] = narration.match(/[a-z][a-z0-9.+-]*/gi) ?? [];
  return words.some((word, index) => {
    const command = word.toLowerCase();
    if (!SHELL_COMMAND_WORD.test(command)) return false;
    const nextWord = words[index + 1]?.toLowerCase();
    return !(NATURAL_COMMAND_VERBS.has(command) && nextWord && NATURAL_COMMAND_DETERMINERS.has(nextWord));
  });
};

const isSentenceLikeNarration = (narration: string): boolean => {
  const firstLetter = narration.match(/\p{L}/u)?.[0];
  if (!firstLetter) return false;

  const hasLetterCase = firstLetter.toLocaleLowerCase() !== firstLetter.toLocaleUpperCase();
  if (!hasLetterCase) return narration.length >= 4;
  if (firstLetter !== firstLetter.toLocaleUpperCase()) return false;

  const words = narration.match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? [];
  if (words.length < 2) return false;
  const hasNaturalStart = NATURAL_NARRATION_START.test(narration);
  const hasSentenceStructure = words.length >= 5 && NATURAL_SENTENCE_CONNECTOR.test(narration);
  if (AMBIGUOUS_COMMAND_NARRATION_START.test(narration)) return hasNaturalStart && hasSentenceStructure;
  return hasNaturalStart || hasSentenceStructure;
};

const getSafeProviderNarration = (value: string | undefined): string | undefined => {
  const narration = value?.trim();
  const narrationWithoutNaturalSlashPhrases = narration?.replace(NATURAL_SLASH_PHRASE, '');
  if (
    !narration ||
    isDiagnosticTelemetryText(narration) ||
    DIAGNOSTIC_NARRATION.test(narration) ||
    containsShellCommandPhrase(narration) ||
    UNSAFE_PROVIDER_NARRATION.some((pattern) => pattern.test(narration)) ||
    /[\\/]/.test(narrationWithoutNaturalSlashPhrases ?? '') ||
    !isSentenceLikeNarration(narration)
  ) {
    return undefined;
  }
  if (narration.length <= PROVIDER_NARRATION_MAX_LENGTH) return narration;
  return `${narration.slice(0, PROVIDER_NARRATION_MAX_LENGTH - 1)}…`;
};

const isToolMessage = (message: WorkJournalSourceMessage): message is ToolMessage =>
  message.type === 'tool_group' || message.type === 'acp_tool_call' || message.type === 'tool_call';

const buildJournalRows = (
  messages: WorkJournalSourceMessage[],
  planFallback: { running: string; done: string }
): JournalRow[] => {
  const rows: JournalRow[] = [];
  let bufferedTools: ToolMessage[] = [];

  const pushNarration = (row: Extract<JournalRow, { kind: 'narration' }>) => {
    const previous = rows[rows.length - 1];
    if (
      row.isFallback &&
      previous?.kind === 'narration' &&
      previous.isFallback &&
      previous.label === row.label &&
      previous.status === row.status
    ) {
      return;
    }
    rows.push(row);
  };

  const flushTools = () => {
    for (const step of coalesceToolCalls(normalizeToolMessages(bufferedTools))) {
      rows.push({ key: `tool-${step.key}`, kind: 'tool', step, status: step.status });
    }
    bufferedTools = [];
  };

  for (const message of messages) {
    if (isToolMessage(message)) {
      bufferedTools.push(message);
      continue;
    }

    flushTools();
    if (message.type === 'plan') {
      message.content.entries.forEach((entry, index) => {
        const status = planStatus[entry.status];
        const narration = getSafeProviderNarration(entry.content);
        pushNarration({
          key: `plan-${message.id}-${index}`,
          kind: 'narration',
          label: narration ?? (status === 'completed' ? planFallback.done : planFallback.running),
          status,
          isFallback: narration === undefined,
          fallbackDoneLabel: narration === undefined ? planFallback.done : undefined,
        });
      });
      continue;
    }

    const subject = getSafeProviderNarration(message.content.subject);
    if (subject) {
      pushNarration({
        key: `thinking-${message.id}`,
        kind: 'narration',
        label: subject,
        status: message.content.status === 'done' ? 'completed' : 'running',
      });
    }
  }

  flushTools();
  return rows;
};

const settleJournalRows = (rows: JournalRow[], isActive: boolean): JournalRow[] => {
  let activeRowIndex = -1;
  if (isActive) {
    for (let index = rows.length - 1; index >= 0; index--) {
      if (rows[index].status !== 'pending') {
        activeRowIndex = index;
        break;
      }
    }
  }

  return rows.map((row, index) => {
    if (row.status !== 'running' || index === activeRowIndex) return row;
    if (row.kind === 'tool') {
      if (row.step.hadError) {
        return { ...row, status: 'canceled', step: { ...row.step, status: 'canceled' } };
      }
      return { ...row, status: 'completed', step: { ...row.step, status: 'completed', hadError: false } };
    }
    return { ...row, label: row.fallbackDoneLabel ?? row.label, status: 'completed' };
  });
};

type LoadedToolItem = {
  sourceVersion: string;
  item: NormalizedToolCall;
};

const getToolItemVersion = (item: NormalizedToolCall): string =>
  JSON.stringify([
    item.status,
    item.name,
    item.description,
    item.input,
    item.output,
    item.truncated,
    item.imagePath,
    item.messageId,
    item.conversationId,
  ]);

const ToolItemDetail: React.FC<{ item: NormalizedToolCall }> = ({ item }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [fullItem, setFullItem] = useState<LoadedToolItem | null>(null);
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null);
  const [loadErrorVersion, setLoadErrorVersion] = useState<string | null>(null);
  const detailPanelId = useId();
  const { conversationId, key, messageId, truncated } = item;
  const itemVersion = getToolItemVersion(item);
  const latestItemVersionRef = useRef(itemVersion);
  const activeRequestVersionRef = useRef<string | undefined>(undefined);
  latestItemVersionRef.current = itemVersion;
  const displayItem = fullItem?.sourceVersion === itemVersion ? fullItem.item : item;
  const imagePath = displayItem.imagePath;
  const loadingFull = loadingVersion === itemVersion;
  const loadError = loadErrorVersion === itemVersion;
  const hasDetail = displayItem.input || displayItem.output || item.truncated || imagePath;
  const accessibleName =
    displayItem.description && displayItem.description !== displayItem.name
      ? `${displayItem.name} ${displayItem.description}`
      : displayItem.name;
  const [messageApi, messageContext] = Message.useMessage();
  const handleDownloadImage = useCallback(
    async (path: string) => {
      try {
        await downloadFileFromPath(path, getAcpImageFileName(path));
        messageApi.success(t('acp.image.download_success'));
      } catch (error) {
        console.error('[MessageToolGroupSummary] Failed to download image:', error);
        messageApi.error(t('acp.image.download_error'));
      }
    },
    [messageApi, t]
  );

  const loadFullItem = useCallback(async () => {
    if (
      !truncated ||
      fullItem?.sourceVersion === itemVersion ||
      activeRequestVersionRef.current === itemVersion ||
      !conversationId ||
      !messageId
    ) {
      return;
    }

    const requestVersion = itemVersion;
    activeRequestVersionRef.current = requestVersion;
    setLoadingVersion(requestVersion);
    setLoadErrorVersion(null);
    try {
      const message = await ipcBridge.database.getConversationMessage.invoke({
        conversation_id: conversationId,
        message_id: messageId,
      });
      const next = normalizeToolMessages([message as ToolMessage]).find((candidate) => candidate.key === key);
      if (next && latestItemVersionRef.current === requestVersion) {
        setFullItem({ sourceVersion: requestVersion, item: next });
      }
    } catch {
      if (latestItemVersionRef.current === requestVersion) {
        setLoadErrorVersion(requestVersion);
      }
    } finally {
      if (activeRequestVersionRef.current === requestVersion) {
        activeRequestVersionRef.current = undefined;
        setLoadingVersion((current) => (current === requestVersion ? null : current));
      }
    }
  }, [conversationId, fullItem?.sourceVersion, itemVersion, key, messageId, truncated]);

  useEffect(() => {
    if (expanded) void loadFullItem();
  }, [expanded, loadFullItem]);

  const toggleExpanded = () => {
    setExpanded((value) => !value);
  };

  const toolLabel = (
    <span className={'flex-1 min-w-0' + (expanded ? ' break-all' : ' truncate')}>
      <span className='font-medium text-13px'>{displayItem.name}</span>
      {displayItem.description && displayItem.description !== displayItem.name && (
        <span className='m-l-4px opacity-80 text-13px'>{displayItem.description}</span>
      )}
    </span>
  );

  return (
    <div className='flex flex-col'>
      {messageContext}
      <div className='flex flex-row text-t-secondary gap-12px items-center'>
        <Badge status={statusToBadge(item.status)} className={item.status === 'running' ? 'badge-breathing' : ''} />
        {hasDetail ? (
          <Button
            type='text'
            size='mini'
            className='!flex flex-1 items-center justify-between gap-12px !min-w-0 !w-auto !h-auto !p-0 !text-left !text-t-secondary !whitespace-normal hover:!text-t-primary'
            aria-label={accessibleName}
            aria-expanded={expanded}
            aria-controls={detailPanelId}
            onClick={toggleExpanded}
          >
            {toolLabel}
            <span className='inline-flex items-center shrink-0'>
              {expanded ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />}
            </span>
          </Button>
        ) : (
          toolLabel
        )}
      </div>
      {expanded && hasDetail && (
        <div id={detailPanelId} className='tool-detail-panel m-l-20px m-t-4px'>
          {loadingFull && <div className='tool-detail-label'>{t('common.loading')}</div>}
          {loadError && <div className='tool-detail-label'>{t('common.failed')}</div>}
          {displayItem.input && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>{t('tools.labels.arguments')}</div>
              <pre className='tool-detail-content'>{displayItem.input}</pre>
            </div>
          )}
          {displayItem.output && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>{t('tools.labels.result')}</div>
              <pre className='tool-detail-content'>{displayItem.output}</pre>
            </div>
          )}
        </div>
      )}
      {imagePath && (
        <div className='group relative m-l-20px m-t-8px overflow-hidden rounded border bg-1 p-2 max-w-280px'>
          <LocalImageView
            src={imagePath}
            alt={getAcpImageFileName(imagePath)}
            className='max-w-full max-h-320px object-contain rounded'
          />
          <Tooltip content={t('acp.image.download')}>
            <Button
              aria-label={t('acp.image.download_aria')}
              className='!absolute right-10px top-10px !h-28px !w-28px !p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-90 focus:opacity-100'
              type='secondary'
              size='mini'
              shape='circle'
              icon={<Download theme='outline' size='14' />}
              onClick={() => void handleDownloadImage(imagePath)}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
};

const StepRow: React.FC<{ label: string; status: Exclude<NormalizedToolStatus, 'error'> }> = ({ label, status }) => {
  const icon = (() => {
    switch (status) {
      case 'running':
        return (
          <span data-status-icon='running'>
            <LoadingOne theme='outline' size='14' fill={iconColors.primary} className='loading' />
          </span>
        );
      case 'completed':
        return (
          <CheckOne theme='filled' size='14' fill={theme.Color.FunctionalColor.success} data-status-icon='completed' />
        );
      case 'canceled':
        return (
          <Attention
            theme='filled'
            size='14'
            strokeLinejoin='bevel'
            fill={theme.Color.FunctionalColor.warn}
            data-status-icon='canceled'
          />
        );
      case 'pending':
        return <Badge status='default' data-status-icon='pending' />;
    }
  })();

  return (
    <div
      className='flex flex-row items-center gap-8px text-t-secondary'
      data-status={status}
      role={status === 'running' ? 'status' : undefined}
      aria-live={status === 'running' ? 'polite' : undefined}
    >
      <span className='flex-shrink-0 flex items-center'>{icon}</span>
      <span className='text-13px'>{label}</span>
    </div>
  );
};

const formatCategorySummary = (
  categories: Array<{ category: string; count: number }>,
  t: ReturnType<typeof useTranslation>['t']
): string => {
  const clauses = categories.map(({ category, count }) =>
    t(`messages.toolActivity.recap.category.${category}`, { count })
  );
  const joinClauses = (items: string[]): string => {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2)
      return t('messages.toolActivity.recap.connector.pair', { first: items[0], second: items[1] });
    return t('messages.toolActivity.recap.connector.series', {
      first: items[0],
      rest: joinClauses(items.slice(1)),
    });
  };

  return joinClauses(clauses);
};

const MessageToolGroupSummary: React.FC<{ messages: WorkJournalSourceMessage[]; isActive?: boolean }> = ({
  messages,
  isActive = false,
}) => {
  const { t } = useTranslation();
  const action = useToolActionText();
  const toolMessages = useMemo(() => messages.filter(isToolMessage), [messages]);
  const tools = useMemo(() => normalizeToolMessages(toolMessages), [toolMessages]);
  const sourceRows = useMemo(
    () =>
      buildJournalRows(messages, {
        running: t('messages.toolActivity.generic.running'),
        done: t('messages.toolActivity.generic.done'),
      }),
    [messages, t]
  );
  const rows = useMemo(() => settleJournalRows(sourceRows, isActive), [isActive, sourceRows]);
  const recap = useMemo(
    () =>
      buildTurnWorkRecap(
        rows.map((row) =>
          row.kind === 'tool'
            ? {
                category: row.step.action.category,
                status: row.status,
                attempts: row.step.attempts,
                hadError: row.step.hadError,
              }
            : {
                category: 'generic',
                status: row.status,
                safeSubject: row.isFallback ? undefined : row.label,
              }
        ),
        isActive
      ),
    [isActive, rows]
  );
  const categorySummary = useMemo(() => formatCategorySummary(recap.categories, t), [recap.categories, t]);
  const outcome = useMemo(() => {
    switch (recap.status) {
      case 'active':
        return t('messages.toolActivity.recap.outcome.active', recap);
      case 'recovered':
        return t('messages.toolActivity.recap.outcome.recovered', recap);
      case 'partial':
        return t('messages.toolActivity.recap.outcome.partial', recap);
      case 'failed':
        return t('messages.toolActivity.recap.outcome.failed', recap);
      case 'canceled':
        return t('messages.toolActivity.recap.outcome.canceled', recap);
      case 'completed':
        return t('messages.toolActivity.recap.outcome.completed', recap);
    }
  }, [recap, t]);
  const [showDetails, setShowDetails] = useState(false);

  if (rows.length === 0 && tools.length === 0) return null;

  return (
    <div className='tool-group-summary flex flex-col gap-6px'>
      <div className='flex flex-col gap-2px' role={recap.status === 'active' ? 'status' : undefined} aria-live='polite'>
        <div className='font-500 text-t-primary'>{t(`messages.toolActivity.recap.headline.${recap.status}`)}</div>
        <div className='text-13px text-t-secondary'>
          {t('messages.toolActivity.recap.activity', { categories: categorySummary })}
        </div>
        <div className='text-13px text-t-secondary'>{outcome}</div>
      </div>
      {rows.length > 0 && (
        <Button
          type='text'
          size='mini'
          className='tool-group-summary__header'
          aria-expanded={showDetails}
          onClick={() => setShowDetails((value) => !value)}
        >
          <span className='tool-group-summary__label'>{t('common.technical_details')}</span>
          <Right
            theme='outline'
            size='12'
            className={`tool-group-summary__arrow${showDetails ? ' tool-group-summary__arrow--open' : ''}`}
          />
        </Button>
      )}
      <div className='tool-group-summary__body' hidden={!showDetails} aria-hidden={!showDetails}>
        {rows.map((row) => {
          if (row.status === 'error') {
            return row.kind === 'tool' ? <ToolActivityError key={row.key} step={row.step} /> : null;
          }
          return (
            <StepRow
              key={row.key}
              label={row.kind === 'tool' ? action.label(row.step) : row.label}
              status={row.status}
            />
          );
        })}
        {showDetails && tools.map((item) => <ToolItemDetail key={item.key} item={item} />)}
      </div>
    </div>
  );
};

export default React.memo(MessageToolGroupSummary);
