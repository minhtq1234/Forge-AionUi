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
