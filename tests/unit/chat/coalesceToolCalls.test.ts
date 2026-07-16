import { describe, expect, it } from 'vitest';
import { coalesceToolCalls } from '@/common/chat/toolActivity/coalesceToolCalls';
import type { NormalizedToolCall } from '@/common/chat/normalizeToolCall';
import { buildTurnWorkRecap } from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnWorkRecap';

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
  it('merges repeated updates for the same logical call and takes the last status', () => {
    const steps = coalesceToolCalls([
      call({ key: 'a', status: 'error' }),
      call({ key: 'a', status: 'error' }),
      call({ key: 'a', status: 'completed' }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].attempts).toBe(3);
    expect(steps[0].status).toBe('completed');
    expect(steps[0].key).toBe('a');
  });
  it('retains error history when the same logical call later completes', () => {
    const steps = coalesceToolCalls([call({ key: 'a', status: 'error' }), call({ key: 'a', status: 'completed' })]);

    expect(steps[0].status).toBe('completed');
    expect(steps[0].hadError).toBe(true);
  });
  it('coalesces an interleaved stable call in first-seen order and reports recovery', () => {
    const steps = coalesceToolCalls([
      call({ key: 'a', name: 'render_report', status: 'error' }),
      call({ key: 'b', name: 'data_open', status: 'completed' }),
      call({ key: 'a', name: 'render_report', status: 'completed' }),
    ]);
    const recap = buildTurnWorkRecap(
      steps.map((step) => ({
        category: step.action.category,
        status: step.status,
        attempts: step.attempts,
        hadError: step.hadError,
      })),
      false
    );

    expect(steps.map((step) => step.key)).toEqual(['a', 'b']);
    expect(steps[0]).toMatchObject({ attempts: 2, status: 'completed', hadError: true });
    expect(steps[0].calls.map((item) => item.status)).toEqual(['error', 'completed']);
    expect(recap).toMatchObject({ status: 'recovered', total: 2, completed: 2, failed: 0, retries: 1 });
  });
  it('coalesces stable snapshots across a planning-style buffered call', () => {
    const steps = coalesceToolCalls([
      call({ key: 'a', name: 'render_report', status: 'running' }),
      call({ key: 'plan', name: 'update_plan', status: 'completed' }),
      call({ key: 'a', name: 'render_report', status: 'completed' }),
    ]);

    expect(steps.map((step) => step.key)).toEqual(['a', 'plan']);
    expect(steps[0]).toMatchObject({ attempts: 2, status: 'completed', hadError: false });
    expect(steps[0].calls.map((item) => item.status)).toEqual(['running', 'completed']);
  });
  it('keeps adjacent independent completed calls with the same purpose as separate steps', () => {
    const steps = coalesceToolCalls([call({ key: 'a', status: 'completed' }), call({ key: 'b', status: 'completed' })]);

    expect(steps).toHaveLength(2);
    expect(steps.every((step) => step.attempts === 1)).toBe(true);
  });
  it('keeps calls without stable IDs independent', () => {
    const steps = coalesceToolCalls([call({ key: '', status: 'error' }), call({ key: '', status: 'completed' })]);

    expect(steps).toHaveLength(2);
    expect(steps.every((step) => step.attempts === 1)).toBe(true);
  });
  it('reports partial work when one call fails and an independent same-purpose call succeeds', () => {
    const steps = coalesceToolCalls([call({ key: 'a', status: 'error' }), call({ key: 'b', status: 'completed' })]);
    const recap = buildTurnWorkRecap(
      steps.map((step) => ({
        category: step.action.category,
        status: step.status,
        attempts: step.attempts,
        hadError: step.hadError,
      })),
      false
    );

    expect(steps).toHaveLength(2);
    expect(recap).toMatchObject({ status: 'partial', total: 2, completed: 1, failed: 1, retries: 0 });
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
    const steps = coalesceToolCalls([call({ key: 'a', status: 'error' }), call({ key: 'a', status: 'running' })]);
    expect(steps[0].status).toBe('running');
    expect(steps[0].attempts).toBe(2);
  });
  it('keeps different search calls separate even when they serve the same purpose', () => {
    const steps = coalesceToolCalls([
      call({ key: 'a', name: 'exec_command', kind: 'execute', input: 'rg -n journal packages' }),
      call({ key: 'b', name: 'find', kind: 'search', input: 'journal' }),
    ]);
    expect(steps).toHaveLength(2);
    expect(steps.every((step) => step.action.purpose === 'discovering')).toBe(true);
    expect(steps.every((step) => step.attempts === 1)).toBe(true);
  });
  it('starts a new phase when work changes from discovery to verification', () => {
    const steps = coalesceToolCalls([
      call({ key: 'a', name: 'exec_command', kind: 'execute', input: 'rg -n journal packages' }),
      call({ key: 'b', name: 'exec_command', kind: 'execute', input: 'bun run test tests/unit/chat' }),
    ]);
    expect(steps.map((step) => step.action.purpose)).toEqual(['discovering', 'verifying']);
  });
  it('creates a new discovery phase after verification changes direction', () => {
    const steps = coalesceToolCalls([
      call({ key: 'a', name: 'find', kind: 'search' }),
      call({ key: 'b', name: 'exec_command', kind: 'execute', input: 'bun run test tests/unit/chat' }),
      call({ key: 'c', name: 'rg', kind: 'search' }),
    ]);
    expect(steps.map((step) => step.action.purpose)).toEqual(['discovering', 'verifying', 'discovering']);
  });
});
