import { describe, expect, it } from 'vitest';
import { coalesceToolCalls } from '@/common/chat/toolActivity/coalesceToolCalls';
import type { NormalizedToolCall } from '@/common/chat/normalizeToolCall';

const call = (over: Partial<NormalizedToolCall>): NormalizedToolCall => ({
  key: 'k',
  name: 'render_report',
  status: 'completed',
  ...over,
});

describe('coalesceToolCalls', () => {
  it('returns [] for no calls', () => {
    expect(coalesceToolCalls([])).toEqual([]);
  });
  it('keeps a single call as one step with attempts 1', () => {
    const steps = coalesceToolCalls([call({ key: 'a' })]);
    expect(steps).toHaveLength(1);
    expect(steps[0].attempts).toBe(1);
    expect(steps[0].status).toBe('completed');
  });
  it('merges consecutive same-tool retries and takes the last status', () => {
    const steps = coalesceToolCalls([
      call({ key: 'a', status: 'error' }),
      call({ key: 'b', status: 'error' }),
      call({ key: 'c', status: 'completed' }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].attempts).toBe(3);
    expect(steps[0].status).toBe('completed');
    expect(steps[0].key).toBe('a');
  });
  it('keeps interleaved different tools separate and ordered', () => {
    const steps = coalesceToolCalls([
      call({ key: 'a', name: 'data_open' }),
      call({ key: 'b', name: 'render_report' }),
      call({ key: 'c', name: 'data_open' }),
    ]);
    expect(steps.map((s) => s.rawName)).toEqual(['data_open', 'render_report', 'data_open']);
    expect(steps.every((s) => s.attempts === 1)).toBe(true);
  });
  it('reflects a running tail as running', () => {
    const steps = coalesceToolCalls([call({ key: 'a', status: 'error' }), call({ key: 'b', status: 'running' })]);
    expect(steps[0].status).toBe('running');
    expect(steps[0].attempts).toBe(2);
  });
});
