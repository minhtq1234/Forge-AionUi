/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation, TProviderWithModel } from '@/common/config/storage';
import { getKnownModelContextLimit } from '@/renderer/utils/model/modelContextLimits';

const positiveOrUndefined = (value: unknown): number | undefined =>
  typeof value === 'number' && value > 0 ? value : undefined;

/**
 * Resolve the context window (in tokens) used to compute a conversation's
 * context budget ratio.
 *
 * Resolution order, most authoritative first:
 *   1. `extra.last_context_limit` — the per-conversation window populated by the
 *      backend (ACP path).
 *   2. `model.context_limit` — the provider-advertised window, when the provider
 *      config supplies one.
 *   3. A per-model default from the known-model map.
 *
 * Returns `undefined` only when the window is genuinely unknown, so callers can
 * keep the graceful "--" instead of inventing a percentage. aionrs
 * conversations never receive a backend-populated `last_context_limit`, so the
 * per-model default is what lets their budget resolve a real percentage.
 */
export const resolveConversationContextLimit = (conversation: TChatConversation | null): number | undefined => {
  if (!conversation) return undefined;

  const extra = conversation.extra as { last_context_limit?: unknown } | undefined;
  const conversationLimit = positiveOrUndefined(extra?.last_context_limit);
  if (conversationLimit !== undefined) return conversationLimit;

  const model = (conversation as { model?: TProviderWithModel & { model?: string } }).model;
  const providerLimit = positiveOrUndefined(model?.context_limit);
  if (providerLimit !== undefined) return providerLimit;

  // aionrs conversations can surface the untransformed backend shape
  // ({ provider_id, model, use_model: null }), so read the model name from
  // either field before consulting the per-model map.
  const modelName = model?.use_model || model?.model;
  return getKnownModelContextLimit(modelName);
};
