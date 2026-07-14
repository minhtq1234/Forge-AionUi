/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Divider, Popover } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TokenUsageData } from '@/common/config/storage';
import type { LocalTokenUsageSummary } from '@/renderer/pages/conversation/utils/localTokenUsage';

type ContextUsageIndicatorProps = {
  tokenUsage: TokenUsageData | null;
  localUsage: LocalTokenUsageSummary;
  context_limit?: number;
  className?: string;
  size?: number;
};

const CONTEXT_TRACK_COLOR = 'var(--color-fill-3)';

const ContextUsageIndicator: React.FC<ContextUsageIndicatorProps> = ({
  tokenUsage,
  localUsage,
  context_limit,
  className = '',
  size = 24,
}) => {
  const { t } = useTranslation();

  const contextUsage = useMemo(() => {
    const total = tokenUsage?.total_tokens;
    if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) return null;
    if (typeof context_limit !== 'number' || !Number.isFinite(context_limit) || context_limit <= 0) return null;

    const pct = (total / context_limit) * 100;
    if (!Number.isFinite(pct)) return null;

    return {
      percentage: pct,
      displayTotal: formatTokenCount(total),
      displayLimit: formatTokenCount(context_limit, true),
      isWarning: pct > 70,
      isDanger: pct > 90,
    };
  }, [tokenUsage, context_limit]);

  if (!contextUsage) return null;

  const { percentage, displayTotal, displayLimit, isWarning, isDanger } = contextUsage;

  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const visualPercentage = Math.min(Math.max(percentage, 0), 100);
  const strokeDashoffset = circumference - (visualPercentage / 100) * circumference;

  const getStrokeColor = () => {
    if (isDanger) return 'rgb(var(--danger-6))';
    if (isWarning) return 'rgb(var(--warning-6))';
    return 'rgb(var(--primary-6))';
  };

  const percentageLabel = t('conversation.contextUsage.percentUsed', {
    percent: Math.round(percentage),
  });

  const popoverContent = (
    <div className='min-w-240px p-12px'>
      <div className='flex items-baseline justify-between gap-12px'>
        <span className='text-13px text-t-secondary'>{t('conversation.contextUsage.contextWindow')}</span>
        <span className='text-13px font-medium text-t-primary whitespace-nowrap'>{percentageLabel}</span>
      </div>
      <div className='mt-3px text-12px text-t-secondary'>
        {t('conversation.contextUsage.tokenCount', { used: displayTotal, limit: displayLimit })}
      </div>
      <div
        aria-label={percentageLabel}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={visualPercentage}
        className='mt-8px h-5px overflow-hidden rounded-full bg-3'
        role='progressbar'
      >
        <div
          className='h-full rounded-full'
          data-testid='context-usage-progress'
          style={{ backgroundColor: getStrokeColor(), width: `${visualPercentage}%` }}
        />
      </div>
      <Divider className='my-12px!' />
      <div className='text-12px text-t-secondary'>{t('conversation.contextUsage.localTokenUsage')}</div>
      <UsageRow label={t('conversation.contextUsage.today')} value={localUsage.today} />
      <UsageRow label={t('conversation.contextUsage.weekToDate')} value={localUsage.weekToDate} />
      <UsageRow label={t('conversation.contextUsage.monthToDate')} value={localUsage.monthToDate} />
    </div>
  );

  return (
    <Popover
      content={popoverContent}
      position='top'
      trigger={['hover', 'focus']}
      triggerProps={{ focusDelay: 0, mouseEnterDelay: 0 }}
      className='context-usage-popover'
    >
      <Button
        aria-label={t('conversation.contextUsage.triggerLabel')}
        className={`context-usage-indicator flex items-center justify-center ${className}`}
        shape='circle'
        size='mini'
        style={{ height: size, width: size }}
        type='text'
      >
        <svg
          aria-hidden='true'
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill='none'
            stroke={CONTEXT_TRACK_COLOR}
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill='none'
            stroke={getStrokeColor()}
            strokeWidth={strokeWidth}
            strokeLinecap='round'
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
          />
        </svg>
      </Button>
    </Popover>
  );
};

type UsageRowProps = {
  label: string;
  value: number;
};

function UsageRow({ label, value }: UsageRowProps): React.ReactNode {
  return (
    <div className='mt-10px flex items-baseline justify-between gap-12px'>
      <span className='text-12px text-t-secondary'>{label}</span>
      <span className='text-12px font-medium text-t-primary whitespace-nowrap'>{formatTokenCount(value)}</span>
    </div>
  );
}

/**
 * 格式化 token 数量显示
 * @param count token 数量
 * @param hideZeroDecimals 是否隐藏小数点为0的情况（如 1.0M 显示为 1M），默认为 false
 * @returns 格式化后的字符串，如 "37.0K" 或 "1.2M"，当 hideZeroDecimals 为 true 时 "1.0M" 显示为 "1M"
 */
export function formatTokenCount(count: number, hideZeroDecimals = false): string {
  if (count >= 1_000_000) {
    const value = count / 1_000_000;
    const formatted = value.toFixed(1);
    return hideZeroDecimals && formatted.endsWith('.0') ? `${Math.floor(value)}M` : `${formatted}M`;
  }
  if (count >= 1_000) {
    const value = count / 1_000;
    const formatted = value.toFixed(1);
    return hideZeroDecimals && formatted.endsWith('.0') ? `${Math.floor(value)}K` : `${formatted}K`;
  }
  return count.toString();
}

export default ContextUsageIndicator;
