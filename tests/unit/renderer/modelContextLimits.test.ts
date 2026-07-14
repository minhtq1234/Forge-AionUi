import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_LIMIT,
  getKnownModelContextLimit,
  getModelContextLimit,
} from '@/renderer/utils/model/modelContextLimits';

describe('getKnownModelContextLimit', () => {
  it('returns the mapped window for a known model', () => {
    expect(getKnownModelContextLimit('gpt-4o')).toBe(128_000);
  });

  it('returns the MiniMax M2.5 window so aionrs budgets resolve a real limit', () => {
    expect(getKnownModelContextLimit('minimax-m2.5')).toBe(192_000);
  });

  it('matches known models case-insensitively and via provider suffixes', () => {
    expect(getKnownModelContextLimit('MiniMax-M2.5-preview')).toBe(192_000);
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
    expect(getModelContextLimit('minimax-m2.5')).toBe(192_000);
  });

  it('falls back to the default window for unknown models', () => {
    expect(getModelContextLimit('totally-made-up-model')).toBe(DEFAULT_CONTEXT_LIMIT);
    expect(getModelContextLimit(undefined)).toBe(DEFAULT_CONTEXT_LIMIT);
  });
});
