/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CoalescedStep } from '@/common/chat/toolActivity/types';

type Form = 'running' | 'done' | 'failedTitle';

// Resolve a localized phrase: exact tool → category → generic, all via i18n
// defaultValue chaining so the UI never shows a raw tool id.
export const useToolActionText = () => {
  const { t } = useTranslation();
  return useMemo(() => {
    const resolveForm = (step: CoalescedStep, form: Form): string => {
      const { toolKey, category } = step.action;
      const generic = t(`messages.toolActivity.generic.${form}`);
      const categoryText = t(`messages.toolActivity.categories.${category}.${form}`, { defaultValue: generic });
      if (!toolKey) return categoryText;
      return t(`messages.toolActivity.tools.${toolKey}.${form}`, { defaultValue: categoryText });
    };

    return {
      label(step: CoalescedStep): string {
        if (step.status === 'canceled') return t('messages.toolActivity.status.stopped');
        const form: Form = step.status === 'completed' ? 'done' : 'running';
        const base = resolveForm(step, form);
        if (step.status === 'completed' && step.hadError) {
          return `${base} ${t('messages.toolActivity.status.recovered')}`;
        }
        if (step.attempts > 1 && step.status === 'running') {
          return `${base} ${t('messages.toolActivity.attempt', { n: step.attempts })}`;
        }
        return base;
      },
      failedTitle(step: CoalescedStep): string {
        return resolveForm(step, 'failedTitle');
      },
      suggestion(): string {
        return t('messages.toolActivity.error.suggestion');
      },
    };
  }, [t]);
};
