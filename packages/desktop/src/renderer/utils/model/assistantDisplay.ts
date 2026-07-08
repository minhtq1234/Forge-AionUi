/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { TFunction } from 'i18next';

type AssistantNameSource = Pick<Assistant, 'id' | 'name' | 'name_i18n'>;

/**
 * Resolve the localized catalog name of an assistant.
 *
 * This is the raw, backend-provided name and is safe to persist (e.g. into a
 * scheduled-task config). For user-facing display, prefer
 * {@link resolveAssistantDisplayName}, which layers the Forge brand override on
 * top of this.
 */
export function resolveAssistantName(
  assistant: AssistantNameSource | null | undefined,
  localeKey: string,
  fallback = 'Assistant'
): string {
  if (!assistant) {
    return fallback;
  }

  const localizedName = assistant.name_i18n?.[localeKey] || assistant.name_i18n?.['en-US'];
  return localizedName?.trim() || assistant.name?.trim() || assistant.id || fallback;
}

export type ForgeAssistantBrandKey = 'agent.brand.forgeChat' | 'agent.brand.forgeCode' | 'agent.brand.forgeAssistant';

type AssistantBrandSource = Pick<Assistant, 'id' | 'source' | 'agent'>;

/**
 * Return the Forge brand i18n key for the three built-in agents whose
 * backend-provided catalog names still use legacy AionUi branding, or `null`
 * for every other assistant.
 *
 * Matches on stable Assistant fields, never on the dynamic hash ids of the bare
 * agents. Kept pure (no i18n dependency) so it is trivially unit-testable and
 * reusable by any display site.
 */
export function getForgeAssistantBrandKey(
  assistant: AssistantBrandSource | null | undefined
): ForgeAssistantBrandKey | null {
  if (!assistant) return null;
  const id = assistant.id ?? '';

  // AionUi Butler → Forge Assistant. Keyed on the stable id (also tolerating a
  // `builtin-aionui-assistant` prefix variant), not the agent type.
  if (id === 'aionui-assistant' || id.startsWith('builtin-aionui-assistant')) {
    return 'agent.brand.forgeAssistant';
  }

  // OpenCode → Forge Code. `acp_backend` is the unambiguous discriminator:
  // Gemini is also an ACP agent, so `agent.type === 'acp'` alone is not enough.
  if (assistant.agent?.acp_backend === 'opencode') {
    return 'agent.brand.forgeCode';
  }

  // Aion CLI → Forge Chat. Only the bare/generated aionrs agent; the ~20
  // builtin aionrs assistants are `source === 'builtin'` and keep their names.
  if (assistant.agent?.type === 'aionrs' && assistant.source === 'generated') {
    return 'agent.brand.forgeChat';
  }

  return null;
}

type AssistantDisplaySource = AssistantNameSource & AssistantBrandSource;

/**
 * Resolve the user-facing display name of an assistant.
 *
 * Applies the Forge brand override for the three rebranded built-in agents and
 * otherwise falls back to {@link resolveAssistantName}. This is a display-only
 * concern: do NOT use it on persistence paths (stored config, snapshots) or for
 * the editable assistant-name field — those must keep the real catalog name.
 */
export function resolveAssistantDisplayName(
  assistant: AssistantDisplaySource | null | undefined,
  localeKey: string,
  t: TFunction,
  fallback?: string
): string {
  const brandKey = getForgeAssistantBrandKey(assistant);
  if (brandKey) return t(brandKey);
  return resolveAssistantName(assistant, localeKey, fallback ?? assistant?.name ?? 'Assistant');
}
