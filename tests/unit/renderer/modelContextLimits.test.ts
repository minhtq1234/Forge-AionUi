import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_LIMIT,
  getKnownModelContextLimit,
  getModelContextLimit,
} from '@/renderer/utils/model/modelContextLimits';

const COMMON_MODEL_LIMITS = [
  ['gemini-3.1-pro-preview', 1_048_576],
  ['gemini-3-flash-preview', 1_048_576],
  ['gemini-2.5-pro', 1_048_576],
  ['gemini-2.5-flash', 1_048_576],
  ['gemini-2.5-flash-lite', 1_048_576],
  ['gemini-2.0-flash', 1_048_576],
  ['gemini-2.0-flash-lite', 1_048_576],
  ['gemini-1.5-pro', 2_097_152],
  ['gpt-5.1', 400_000],
  ['gpt-5', 400_000],
  ['gpt-5-mini', 400_000],
  ['gpt-5-nano', 400_000],
  ['gpt-4.1', 1_047_576],
  ['gpt-4.1-mini', 1_047_576],
  ['gpt-4.1-nano', 1_047_576],
  ['gpt-4o', 128_000],
  ['gpt-4o-mini', 128_000],
  ['gpt-4-turbo', 128_000],
  ['o1', 200_000],
  ['o1-mini', 128_000],
  ['o3', 200_000],
  ['o3-mini', 200_000],
  ['o4-mini', 200_000],
  ['claude-fable-5', 1_000_000],
  ['claude-opus-4-8', 1_000_000],
  ['claude-opus-4-7', 1_000_000],
  ['claude-opus-4-6', 1_000_000],
  ['claude-sonnet-5', 1_000_000],
  ['claude-sonnet-4-6', 1_000_000],
  ['claude-haiku-4-5', 200_000],
  ['claude-sonnet-4-5', 200_000],
  ['claude-opus-4-5', 200_000],
  ['claude-3-7-sonnet', 200_000],
  ['minimax-m3', 1_000_000],
  ['minimax-m2.7', 204_800],
  ['minimax-m2.5', 204_800],
  ['minimax-m2.1', 204_800],
  ['minimax-m2', 204_800],
  ['deepseek-chat', 128_000],
  ['deepseek-reasoner', 128_000],
  ['grok-4.5', 500_000],
  ['grok-4.3', 1_000_000],
  ['grok-build-0.1', 256_000],
  ['mistral-large-3', 256_000],
  ['mistral-medium-3.5', 256_000],
  ['mistral-small-4', 256_000],
  ['codestral', 128_000],
  ['devstral-2', 256_000],
  ['qwen3-235b-a22b-instruct-2507', 262_144],
  ['qwen2.5-turbo', 1_000_000],
] as const;

describe('getKnownModelContextLimit', () => {
  it('records context windows for 50 common model aliases', () => {
    expect(COMMON_MODEL_LIMITS).toHaveLength(50);

    for (const [model, expectedLimit] of COMMON_MODEL_LIMITS) {
      expect(getKnownModelContextLimit(model), model).toBe(expectedLimit);
    }
  });

  it('returns the mapped window for a known model', () => {
    expect(getKnownModelContextLimit('gpt-4o')).toBe(128_000);
  });

  it.each(['minimax-m2', 'minimax-m2.1', 'minimax-m2.5', 'minimax-m2.7'])(
    'returns the official 204.8K window for %s',
    (model) => {
      expect(getKnownModelContextLimit(model)).toBe(204_800);
    }
  );

  it('returns the MiniMax M3 window advertised for supported plans', () => {
    expect(getKnownModelContextLimit('minimax-m3')).toBe(1_000_000);
  });

  it('matches known models case-insensitively and via provider suffixes', () => {
    expect(getKnownModelContextLimit('MiniMax-M2.5-preview')).toBe(204_800);
  });

  it('returns undefined when the model is unknown so the budget can stay "--"', () => {
    expect(getKnownModelContextLimit('totally-made-up-model')).toBeUndefined();
  });

  it('returns undefined for missing model names', () => {
    expect(getKnownModelContextLimit(undefined)).toBeUndefined();
    expect(getKnownModelContextLimit(null)).toBeUndefined();
    expect(getKnownModelContextLimit('')).toBeUndefined();
  });
});

describe('getModelContextLimit', () => {
  it('still resolves known models', () => {
    expect(getModelContextLimit('minimax-m2.5')).toBe(204_800);
  });

  it('falls back to the default window for unknown models', () => {
    expect(getModelContextLimit('totally-made-up-model')).toBe(DEFAULT_CONTEXT_LIMIT);
    expect(getModelContextLimit(undefined)).toBe(DEFAULT_CONTEXT_LIMIT);
  });
});
