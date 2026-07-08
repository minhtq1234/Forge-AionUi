/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveToolAction } from '@/common/chat/toolActivity/resolveToolAction';
import type { CoalescedStep } from '@/common/chat/toolActivity/types';

type Form = 'running' | 'done' | 'failedTitle';

// Resolve a localized phrase: exact tool → category → generic, all via i18n
// defaultValue chaining so the UI never shows a raw tool id.
export const useToolActionText = () => {
  const { t } = useTranslation();
  return useMemo(() => {
    const resolveForm = (rawName: string, kind: string | undefined, form: Form): string => {
      const { toolKey, category } = resolveToolAction(rawName, kind);
      const generic = t(`messages.toolActivity.generic.${form}`);
      const cat = t(`messages.toolActivity.categories.${category}.${form}`, { defaultValue: generic });
      if (!toolKey) return cat;
      return t(`messages.toolActivity.tools.${toolKey}.${form}`, { defaultValue: cat });
    };

    return {
      label(step: CoalescedStep): string {
        if (step.status === 'canceled') return t('messages.toolActivity.status.stopped');
        const form: Form = step.status === 'completed' ? 'done' : 'running';
        const base = resolveForm(step.rawName, step.kind, form);
        if (step.attempts > 1 && step.status !== 'completed') {
          return `${base} ${t('messages.toolActivity.attempt', { n: step.attempts })}`;
        }
        return base;
      },
      failedTitle(step: CoalescedStep): string {
        return resolveForm(step.rawName, step.kind, 'failedTitle');
      },
      suggestion(): string {
        return t('messages.toolActivity.error.suggestion');
      },
    };
  }, [t]);
};
