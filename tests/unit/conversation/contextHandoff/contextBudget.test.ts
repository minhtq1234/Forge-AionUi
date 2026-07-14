import { describe, expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import type { TContextHandoffItem } from '@/common/config/storage';
import { estimateContextBudget } from '@/renderer/pages/conversation/contextHandoff/contextBudget';

const textMessage = (content: string): TMessage => ({
  id: content,
  msg_id: content,
  conversation_id: 'conv-1',
  type: 'text',
  position: 'right',
  content: { content },
});

const tipMessage = (content: string): TMessage => ({
  id: content,
  msg_id: content,
  conversation_id: 'conv-1',
  type: 'tips',
  position: 'center',
  content: { content, type: 'success' },
});

describe('estimateContextBudget', () => {
  it('groups estimated tokens by context source', () => {
    const pinnedContext: TContextHandoffItem[] = [
      {
        id: 'pin-1',
        title: 'Reporting unit',
        content: 'Use VND millions.',
        source: 'manual',
        created_at: 1,
        updated_at: 1,
      },
    ];

    const snapshot = estimateContextBudget({
      messages: [textMessage('Build the dashboard from data.csv.')],
      pinnedContext,
      contextMarkdown: '# Conversation Context\n\n## Goal\nContinue.',
      contextLimit: 1_000,
    });

    expect(snapshot.buckets.messages.estimatedTokens).toBeGreaterThan(0);
    expect(snapshot.buckets.files.estimatedTokens).toBeGreaterThan(0);
    expect(snapshot.buckets.memory.estimatedTokens).toBeGreaterThan(0);
    expect(snapshot.totalEstimatedTokens).toBe(
      snapshot.buckets.messages.estimatedTokens +
        snapshot.buckets.files.estimatedTokens +
        snapshot.buckets.skills.estimatedTokens +
        snapshot.buckets.memory.estimatedTokens +
        snapshot.buckets.tools.estimatedTokens
    );
  });

  it('uses warning states without blocking send', () => {
    expect(estimateContextBudget({ messages: [textMessage('x'.repeat(2_000))], contextLimit: 1_000 }).status).toBe(
      'compress'
    );
    expect(estimateContextBudget({ messages: [textMessage('x'.repeat(3_600))], contextLimit: 1_000 }).status).toBe(
      'too_large'
    );
  });

  it('does not invent a precise percentage when backend capacity is unknown', () => {
    const snapshot = estimateContextBudget({ messages: [textMessage('Summarize this conversation.')] });

    expect(snapshot.contextLimit).toBeUndefined();
    expect(snapshot.ratio).toBeNull();
  });

  it('uses backend token watermark telemetry as the minimum message usage estimate', () => {
    const snapshot = estimateContextBudget({
      messages: [
        textMessage('Short compact transcript.'),
        tipMessage('Token watermark override: provider=0, local_estimate=19756, using=92412'),
      ],
      contextLimit: 100_000,
    });

    expect(snapshot.totalEstimatedTokens).toBe(92412);
    expect(snapshot.buckets.messages.estimatedTokens).toBe(92412);
    expect(snapshot.status).toBe('too_large');
  });

  it('uses persisted runtime token usage when telemetry tips are filtered from messages', () => {
    const snapshot = estimateContextBudget({
      messages: [textMessage('Short compact transcript.')],
      runtimeTokenUsage: { total_tokens: 42_000 },
      contextLimit: 100_000,
    });

    expect(snapshot.totalEstimatedTokens).toBe(42_000);
    expect(snapshot.buckets.messages.estimatedTokens).toBe(42_000);
    expect(snapshot.status).toBe('watch');
  });
});
