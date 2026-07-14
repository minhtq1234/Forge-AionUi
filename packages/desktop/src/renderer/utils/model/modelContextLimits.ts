/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 已知模型的 context window 大小配置
 */
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Gemini 系列
  'gemini-3.1-pro-preview': 1_048_576,
  'gemini-3-pro-preview': 1_048_576,
  'gemini-3-flash-preview': 1_048_576,
  'gemini-3-pro-image-preview': 65_536,
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.5-flash-lite': 1_048_576,
  'gemini-2.5-flash-image': 32_768,
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.0-flash-lite': 1_048_576,
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576,

  // OpenAI 系列
  'gpt-5.1': 400_000,
  'gpt-5.1-chat': 128_000,
  'gpt-5': 400_000,
  'gpt-5-chat': 128_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4-turbo-preview': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  'gpt-3.5-turbo-16k': 16_385,
  o1: 200_000,
  'o1-preview': 128_000,
  'o1-mini': 128_000,
  o3: 200_000,
  'o3-mini': 200_000,

  // Claude 系列
  'claude-opus-4.5': 200_000,
  'claude-haiku-4.5': 200_000,
  'claude-sonnet-4.5': 1_000_000,
  'claude-opus-4.1': 200_000,
  'claude-opus-4': 200_000,
  'claude-sonnet-4': 1_000_000,
  'claude-3.7-sonnet': 200_000,
  'claude-3.5-haiku': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-haiku': 200_000,

  // MiniMax 系列
  'minimax-m2.5': 192_000,
};

/**
 * 默认 context limit（当无法确定模型时使用）
 */
export const DEFAULT_CONTEXT_LIMIT = 1_048_576;

/**
 * 根据模型名称获取已知的 context limit，未命中时返回 undefined
 * 支持模糊匹配，例如 "gemini-2.5-pro-latest" 会匹配 "gemini-2.5-pro"
 *
 * Returns the mapped context window for a known model, or `undefined` when the
 * model is not recognized. Callers that need a graceful "--" (e.g. the context
 * budget indicator) use this so an unknown model stays truly unknown instead of
 * silently inheriting the default window.
 */
export function getKnownModelContextLimit(modelName: string | undefined | null): number | undefined {
  if (!modelName) return undefined;

  const lowerModelName = modelName.toLowerCase();

  // 精确匹配 / exact match
  if (MODEL_CONTEXT_LIMITS[lowerModelName]) {
    return MODEL_CONTEXT_LIMITS[lowerModelName];
  }

  // 模糊匹配：查找最长匹配的模型名 / fuzzy match: longest matching key wins
  let bestMatch = '';
  let bestLimit: number | undefined;

  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (lowerModelName.includes(key) && key.length > bestMatch.length) {
      bestMatch = key;
      bestLimit = limit;
    }
  }

  return bestLimit;
}

/**
 * 根据模型名称获取 context limit，未知模型回退到默认值
 * 支持模糊匹配，例如 "gemini-2.5-pro-latest" 会匹配 "gemini-2.5-pro"
 */
export function getModelContextLimit(modelName: string | undefined | null): number {
  return getKnownModelContextLimit(modelName) ?? DEFAULT_CONTEXT_LIMIT;
}
