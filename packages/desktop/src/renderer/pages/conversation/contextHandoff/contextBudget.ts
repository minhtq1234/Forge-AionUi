import { extractDiagnosticTokenEstimate, type TMessage } from '@/common/chat/chatLib';
import type { TContextHandoffItem, TContextHandoffBudgetSnapshot, TokenUsageData } from '@/common/config/storage';
import { readMessageContent } from '@/renderer/utils/chat/conversationExport';

type EstimateContextBudgetInput = {
  messages?: TMessage[];
  pinnedContext?: TContextHandoffItem[];
  contextMarkdown?: string;
  contextLimit?: number;
  runtimeTokenUsage?: TokenUsageData | null;
  skillNames?: string[];
  toolNames?: string[];
};

const EMPTY_BUCKETS: TContextHandoffBudgetSnapshot['buckets'] = {
  messages: { estimatedTokens: 0 },
  files: { estimatedTokens: 0 },
  skills: { estimatedTokens: 0 },
  memory: { estimatedTokens: 0 },
  tools: { estimatedTokens: 0 },
};

const FILE_REFERENCE_RE =
  /(?:^|\s)([~./\w-][^\s"'`<>]*\.(?:md|txt|json|csv|xlsx?|docx?|pptx?|pdf|png|jpe?g|gif|svg|html|css|tsx?|jsx?))/gi;

const estimateTokens = (value: string): number => Math.ceil(value.trim().length / 4);

const fileReferenceTokenEstimate = (messages: TMessage[]): number => {
  const refs = new Set<string>();
  messages.forEach((message) => {
    const content = readMessageContent(message);
    for (const match of content.matchAll(FILE_REFERENCE_RE)) {
      const filePath = match[1]?.trim();
      if (filePath) refs.add(filePath);
    }
  });
  return Array.from(refs).reduce((sum, ref) => sum + estimateTokens(ref), 0);
};

const messageTokenWatermarkEstimate = (messages: TMessage[]): number =>
  messages.reduce((currentMax, message) => {
    const estimate = extractDiagnosticTokenEstimate(readMessageContent(message));
    return estimate === null ? currentMax : Math.max(currentMax, estimate);
  }, 0);

const resolveStatus = (ratio: number | null): TContextHandoffBudgetSnapshot['status'] => {
  if (ratio === null) return 'healthy';
  if (ratio >= 0.9) return 'too_large';
  if (ratio >= 0.5) return 'compress';
  if (ratio >= 0.35) return 'watch';
  return 'healthy';
};

export const estimateContextBudget = (input: EstimateContextBudgetInput): TContextHandoffBudgetSnapshot => {
  const messages = input.messages ?? [];
  const pinnedContext = input.pinnedContext ?? [];
  const messageEstimate = messages.reduce((sum, message) => sum + estimateTokens(readMessageContent(message)), 0);
  const buckets: TContextHandoffBudgetSnapshot['buckets'] = {
    messages: { estimatedTokens: messageEstimate },
    files: { estimatedTokens: fileReferenceTokenEstimate(messages) + estimateTokens(input.contextMarkdown ?? '') },
    skills: { estimatedTokens: estimateTokens((input.skillNames ?? []).join('\n')) },
    memory: {
      estimatedTokens: pinnedContext.reduce((sum, item) => sum + estimateTokens(`${item.title}\n${item.content}`), 0),
    },
    tools: { estimatedTokens: estimateTokens((input.toolNames ?? []).join('\n')) },
  };

  const rawTotalEstimatedTokens = Object.values(buckets).reduce((sum, bucket) => sum + bucket.estimatedTokens, 0);
  const runtimeTokenEstimate = input.runtimeTokenUsage?.total_tokens ?? 0;
  const knownTokenEstimate = Math.max(messageTokenWatermarkEstimate(messages), runtimeTokenEstimate);
  if (knownTokenEstimate > rawTotalEstimatedTokens) {
    buckets.messages.estimatedTokens += knownTokenEstimate - rawTotalEstimatedTokens;
  }

  const totalEstimatedTokens = Object.values(buckets).reduce((sum, bucket) => sum + bucket.estimatedTokens, 0);
  const contextLimit = input.contextLimit;
  const ratio = contextLimit && contextLimit > 0 ? totalEstimatedTokens / contextLimit : null;

  return {
    status: resolveStatus(ratio),
    ratio,
    totalEstimatedTokens,
    contextLimit,
    buckets: totalEstimatedTokens > 0 ? buckets : EMPTY_BUCKETS,
  };
};
