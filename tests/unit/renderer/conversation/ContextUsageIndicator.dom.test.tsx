/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ContextUsageIndicator from '@/renderer/components/agent/ContextUsageIndicator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { limit?: string | number; percent?: string | number; used?: string | number }) => {
      if (options && 'defaultValue' in options) {
        throw new Error('Translation fallbacks are not allowed');
      }

      const translations: Record<string, string> = {
        'conversation.contextUsage.contextWindow': 'Context window',
        'conversation.contextUsage.percentUsed': '{{percent}}% used',
        'conversation.contextUsage.tokenCount': '{{used}} of {{limit}} tokens',
        'conversation.contextUsage.localTokenUsage': 'Local token usage',
        'conversation.contextUsage.today': 'Today',
        'conversation.contextUsage.weekToDate': 'Week to date',
        'conversation.contextUsage.monthToDate': 'Month to date',
        'conversation.contextUsage.triggerLabel': 'Show context usage',
      };

      return (translations[key] ?? key).replace(
        /{{(limit|percent|used)}}/g,
        (_match, interpolationKey: 'limit' | 'percent' | 'used') => String(options?.[interpolationKey] ?? '')
      );
    },
  }),
}));

const localUsage = {
  today: 38_400,
  weekToDate: 214_800,
  monthToDate: 812_200,
};

describe('ContextUsageIndicator', () => {
  it('opens the context and local usage popover on keyboard focus', async () => {
    render(
      <ContextUsageIndicator tokenUsage={{ total_tokens: 122_700 }} context_limit={1_000_000} localUsage={localUsage} />
    );

    const trigger = screen.getByRole('button', { name: 'Show context usage' });
    fireEvent.focus(trigger);

    expect(await screen.findByText('Context window')).toBeInTheDocument();
    expect(screen.getByText('12% used')).toBeInTheDocument();
    expect(screen.getByText('122.7K of 1M tokens')).toBeInTheDocument();
    expect(screen.getByTestId('context-usage-progress')).toHaveStyle({ width: '12.27%' });
    expect(screen.getByText('Local token usage')).toBeInTheDocument();
    expect(screen.getByText('Today').parentElement).toHaveTextContent('38.4K');
    expect(screen.getByText('Week to date').parentElement).toHaveTextContent('214.8K');
    expect(screen.getByText('Month to date').parentElement).toHaveTextContent('812.2K');
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('caps only the visual progress when context usage exceeds its limit', async () => {
    render(
      <ContextUsageIndicator
        tokenUsage={{ total_tokens: 1_250_000 }}
        context_limit={1_000_000}
        localUsage={localUsage}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Show context usage' });
    fireEvent.mouseEnter(trigger);

    expect(await screen.findByText('125% used')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByTestId('context-usage-progress')).toHaveStyle({ width: '100%' });
    expect(trigger.querySelector('svg circle:last-of-type')).toHaveAttribute('stroke-dashoffset', '0');
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'renders no meter for invalid context usage %s',
    (totalTokens) => {
      render(<ContextUsageIndicator tokenUsage={{ total_tokens: totalTokens }} localUsage={localUsage} />);

      expect(screen.queryByRole('button', { name: 'Show context usage' })).not.toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }
  );

  it('renders no meter when finite inputs would produce a non-finite percentage', () => {
    render(
      <ContextUsageIndicator
        tokenUsage={{ total_tokens: Number.MAX_VALUE }}
        context_limit={Number.MIN_VALUE}
        localUsage={localUsage}
      />
    );

    expect(screen.queryByRole('button', { name: 'Show context usage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'renders no meter for an unknown or invalid context limit %s',
    (contextLimit) => {
      render(
        <ContextUsageIndicator
          tokenUsage={{ total_tokens: 102_400 }}
          context_limit={contextLimit}
          localUsage={localUsage}
        />
      );

      expect(screen.queryByRole('button', { name: 'Show context usage' })).not.toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }
  );

  it('renders no meter trigger when context usage is unavailable', () => {
    render(
      <>
        <ContextUsageIndicator tokenUsage={null} localUsage={localUsage} />
        <Button>Send</Button>
      </>
    );

    expect(screen.queryByRole('button', { name: 'Show context usage' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });
});
