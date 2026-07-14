import { describe, expect, it } from 'vitest';
import { formatCompactModelName } from '@/renderer/utils/model/agentLogo';

describe('formatCompactModelName', () => {
  it('shortens provider-prefixed model ids for compact composer controls', () => {
    expect(formatCompactModelName('minimax/minimax-m2.5')).toBe('MiniMax M2.5');
    expect(formatCompactModelName('anthropic/claude-sonnet-4-5')).toBe('Claude Sonnet 4.5');
  });

  it('keeps unknown model ids readable', () => {
    expect(formatCompactModelName('custom/my_model-v1')).toBe('My Model V1');
  });
});
