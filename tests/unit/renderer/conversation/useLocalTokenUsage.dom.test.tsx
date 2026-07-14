import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocalTokenUsage } from '@/renderer/hooks/useLocalTokenUsage';
import { recordLocalTokenUsage } from '@/renderer/pages/conversation/utils/localTokenUsage';

describe('useLocalTokenUsage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 14, 12));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zero totals when the ledger is empty', () => {
    const { result } = renderHook(() => useLocalTokenUsage());

    expect(result.current).toEqual({ today: 0, weekToDate: 0, monthToDate: 0 });
  });

  it('reads the existing ledger summary at mount', () => {
    recordLocalTokenUsage({
      id: 'existing-turn',
      inputTokens: 10,
      outputTokens: 5,
      occurredAt: Date.now(),
    });

    const { result } = renderHook(() => useLocalTokenUsage());

    expect(result.current).toEqual({ today: 15, weekToDate: 15, monthToDate: 15 });
  });

  it('rerenders when a recorded event publishes a ledger update', () => {
    const { result } = renderHook(() => useLocalTokenUsage());

    act(() => {
      recordLocalTokenUsage({
        id: 'published-turn',
        inputTokens: 7,
        outputTokens: 3,
        occurredAt: Date.now(),
      });
    });

    expect(result.current).toEqual({ today: 10, weekToDate: 10, monthToDate: 10 });
  });

  it('keeps the snapshot reference stable when ledger totals are unchanged', () => {
    const { result, rerender } = renderHook(() => useLocalTokenUsage());
    const snapshot = result.current;

    rerender();

    expect(result.current).toBe(snapshot);
  });

  it('recomputes today at the next local midnight without a ledger write', () => {
    vi.setSystemTime(new Date(2026, 6, 14, 23, 59, 59, 500));
    recordLocalTokenUsage({
      id: 'tuesday-turn',
      inputTokens: 10,
      outputTokens: 5,
      occurredAt: Date.now(),
    });
    const { result } = renderHook(() => useLocalTokenUsage());

    expect(result.current).toEqual({ today: 15, weekToDate: 15, monthToDate: 15 });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toEqual({ today: 0, weekToDate: 15, monthToDate: 15 });
  });

  it('recomputes week to date from Monday local midnight without a ledger write', () => {
    vi.setSystemTime(new Date(2026, 6, 19, 23, 59, 59, 500));
    recordLocalTokenUsage({
      id: 'sunday-turn',
      inputTokens: 20,
      outputTokens: 5,
      occurredAt: Date.now(),
    });
    const { result } = renderHook(() => useLocalTokenUsage());

    expect(result.current).toEqual({ today: 25, weekToDate: 25, monthToDate: 25 });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toEqual({ today: 0, weekToDate: 0, monthToDate: 25 });
  });

  it('recomputes month to date at the next local month boundary without a ledger write', () => {
    vi.setSystemTime(new Date(2026, 6, 31, 23, 59, 59, 500));
    recordLocalTokenUsage({
      id: 'july-turn',
      inputTokens: 30,
      outputTokens: 5,
      occurredAt: Date.now(),
    });
    const { result } = renderHook(() => useLocalTokenUsage());

    expect(result.current).toEqual({ today: 35, weekToDate: 35, monthToDate: 35 });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toEqual({ today: 0, weekToDate: 35, monthToDate: 0 });
  });

  it('installs the midnight timer only while a consumer is subscribed', () => {
    const timerCountWithoutSubscriber = vi.getTimerCount();

    const { unmount } = renderHook(() => useLocalTokenUsage());

    expect(vi.getTimerCount()).toBe(timerCountWithoutSubscriber + 1);

    unmount();

    expect(vi.getTimerCount()).toBe(timerCountWithoutSubscriber);
  });
});
