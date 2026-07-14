import {
  getLocalTokenUsageSummary,
  recordLocalTokenUsage,
  subscribeToLocalTokenUsage,
} from '@renderer/pages/conversation/utils/localTokenUsage';

const STORAGE_KEY = 'aionui.local-token-usage.v1';
const TEST_TIME_ZONE = 'Asia/Jerusalem';
const originalTimeZone = process.env.TZ;

function createStorage(initialValue?: string): Storage {
  let value = initialValue ?? null;

  return {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
    removeItem: () => {
      value = null;
    },
    clear: () => {
      value = null;
    },
    key: () => null,
    length: 0,
  };
}

function localDate(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour).getTime();
}

describe('local token usage ledger', () => {
  beforeEach(() => {
    process.env.TZ = TEST_TIME_ZONE;
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', createStorage());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  it('aggregates today, Monday-based week-to-date, and month-to-date in local time', () => {
    vi.setSystemTime(localDate(2026, 1, 12, 15));

    recordLocalTokenUsage({ id: 'today', inputTokens: 2, outputTokens: 3, occurredAt: localDate(2026, 1, 12, 9) });
    recordLocalTokenUsage({ id: 'sunday', inputTokens: 4, outputTokens: 1, occurredAt: localDate(2026, 1, 11, 9) });
    recordLocalTokenUsage({ id: 'last-week', inputTokens: 6, outputTokens: 1, occurredAt: localDate(2026, 1, 10, 9) });
    recordLocalTokenUsage({
      id: 'last-month',
      inputTokens: 8,
      outputTokens: 1,
      occurredAt: localDate(2025, 12, 31, 9),
    });

    expect(getLocalTokenUsageSummary()).toEqual({ today: 5, weekToDate: 5, monthToDate: 17 });
  });

  it('includes the Sunday endpoint in the current week and month', () => {
    vi.setSystemTime(localDate(2026, 1, 18, 15));

    recordLocalTokenUsage({ id: 'monday', inputTokens: 3, outputTokens: 2, occurredAt: localDate(2026, 1, 12, 9) });
    recordLocalTokenUsage({ id: 'today', inputTokens: 5, outputTokens: 1, occurredAt: localDate(2026, 1, 18, 9) });
    recordLocalTokenUsage({
      id: 'previous-week',
      inputTokens: 20,
      outputTokens: 0,
      occurredAt: localDate(2026, 1, 11, 23),
    });

    expect(getLocalTokenUsageSummary()).toEqual({ today: 6, weekToDate: 11, monthToDate: 31 });
  });

  it('starts a new month while retaining the current Monday-based week', () => {
    vi.setSystemTime(localDate(2026, 2, 1, 15));

    recordLocalTokenUsage({ id: 'prior-day', inputTokens: 4, outputTokens: 1, occurredAt: localDate(2026, 1, 31, 9) });
    recordLocalTokenUsage({ id: 'new-month', inputTokens: 7, outputTokens: 2, occurredAt: localDate(2026, 2, 1, 9) });

    expect(getLocalTokenUsageSummary()).toEqual({ today: 9, weekToDate: 14, monthToDate: 9 });
  });

  it('ignores invalid and zero-token events and keeps the first event with a duplicate id', () => {
    vi.setSystemTime(localDate(2026, 1, 12));

    recordLocalTokenUsage({ id: 'duplicate', inputTokens: 2, outputTokens: 3, occurredAt: localDate(2026, 1, 12) });
    recordLocalTokenUsage({ id: 'duplicate', inputTokens: 100, outputTokens: 100, occurredAt: localDate(2026, 1, 12) });
    recordLocalTokenUsage({ id: 'zero', inputTokens: 0, outputTokens: 0, occurredAt: localDate(2026, 1, 12) });
    recordLocalTokenUsage({ id: 'negative', inputTokens: -1, outputTokens: 4, occurredAt: localDate(2026, 1, 12) });
    recordLocalTokenUsage({
      id: 'infinite',
      inputTokens: Number.POSITIVE_INFINITY,
      outputTokens: 4,
      occurredAt: localDate(2026, 1, 12),
    });

    expect(getLocalTokenUsageSummary()).toEqual({ today: 5, weekToDate: 5, monthToDate: 5 });
  });

  it('normalizes duplicate ids from persisted events before aggregation', () => {
    vi.setSystemTime(localDate(2026, 1, 12));
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        events: [
          { id: 'persisted-duplicate', inputTokens: 2, outputTokens: 3, occurredAt: localDate(2026, 1, 12) },
          { id: 'persisted-duplicate', inputTokens: 100, outputTokens: 100, occurredAt: localDate(2026, 1, 12) },
        ],
      })
    );

    expect(getLocalTokenUsageSummary()).toEqual({ today: 5, weekToDate: 5, monthToDate: 5 });
  });

  it('uses Monday local midnight as the week start across daylight saving time', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(TEST_TIME_ZONE);
    vi.setSystemTime(localDate(2026, 3, 28, 12));
    recordLocalTokenUsage({
      id: 'previous-sunday',
      inputTokens: 8,
      outputTokens: 2,
      occurredAt: localDate(2026, 3, 22, 23) + 30 * 60 * 1000,
    });
    recordLocalTokenUsage({
      id: 'monday-early',
      inputTokens: 2,
      outputTokens: 1,
      occurredAt: localDate(2026, 3, 23, 0) + 30 * 60 * 1000,
    });

    expect(getLocalTokenUsageSummary()).toEqual({ today: 0, weekToDate: 3, monthToDate: 13 });
  });

  it('excludes future-dated persisted events from summaries', () => {
    vi.setSystemTime(localDate(2026, 1, 12, 12));
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        events: [{ id: 'future', inputTokens: 9, outputTokens: 1, occurredAt: localDate(2026, 1, 13) }],
      })
    );

    expect(getLocalTokenUsageSummary()).toEqual({ today: 0, weekToDate: 0, monthToDate: 0 });
  });

  it('ignores invalid entries from a structurally valid persisted ledger', () => {
    vi.setSystemTime(localDate(2026, 1, 12));
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        events: [
          { id: 'valid', inputTokens: 2, outputTokens: 3, occurredAt: localDate(2026, 1, 12) },
          { id: 'negative', inputTokens: -1, outputTokens: 1, occurredAt: localDate(2026, 1, 12) },
          { id: 'invalid-date', inputTokens: 1, outputTokens: 1, occurredAt: 'today' },
          { id: 3, inputTokens: 1, outputTokens: 1, occurredAt: localDate(2026, 1, 12) },
        ],
      })
    );

    expect(getLocalTokenUsageSummary()).toEqual({ today: 5, weekToDate: 5, monthToDate: 5 });
  });

  it('silently cleans expired and invalid persisted events during summary reads', () => {
    vi.setSystemTime(localDate(2026, 2, 20));
    const currentEvent = { id: 'current', inputTokens: 2, outputTokens: 3, occurredAt: localDate(2026, 2, 20) };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        events: [
          { id: 'expired', inputTokens: 8, outputTokens: 2, occurredAt: localDate(2026, 1, 10) },
          currentEvent,
          { id: 'current', inputTokens: 100, outputTokens: 100, occurredAt: localDate(2026, 2, 20) },
          { id: 'invalid', inputTokens: -1, outputTokens: 1, occurredAt: localDate(2026, 2, 20) },
          { id: 'future', inputTokens: 9, outputTokens: 1, occurredAt: localDate(2026, 2, 21) },
        ],
      })
    );
    const listener = vi.fn();
    const unsubscribe = subscribeToLocalTokenUsage(listener);

    expect(getLocalTokenUsageSummary()).toEqual({ today: 5, weekToDate: 5, monthToDate: 5 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').events).toEqual([currentEvent]);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('treats malformed or unavailable storage as an empty ledger', () => {
    vi.setSystemTime(localDate(2026, 1, 12));
    vi.stubGlobal('localStorage', createStorage('{broken'));

    expect(getLocalTokenUsageSummary()).toEqual({ today: 0, weekToDate: 0, monthToDate: 0 });

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    });

    expect(() =>
      recordLocalTokenUsage({ id: 'offline', inputTokens: 1, outputTokens: 1, occurredAt: Date.now() })
    ).not.toThrow();
    expect(getLocalTokenUsageSummary()).toEqual({ today: 0, weekToDate: 0, monthToDate: 0 });
  });

  it('notifies subscribers after a successful append and retains only 40 days', () => {
    vi.setSystemTime(localDate(2026, 2, 20));
    const oldEvent = { id: 'old', inputTokens: 9, outputTokens: 1, occurredAt: localDate(2026, 1, 10) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events: [oldEvent] }));
    const listener = vi.fn();
    const unsubscribe = subscribeToLocalTokenUsage(listener);

    recordLocalTokenUsage({ id: 'current', inputTokens: 2, outputTokens: 3, occurredAt: Date.now() });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').events).toEqual([
      { id: 'current', inputTokens: 2, outputTokens: 3, occurredAt: Date.now() },
    ]);
    unsubscribe();
    recordLocalTokenUsage({ id: 'next', inputTokens: 1, outputTokens: 1, occurredAt: Date.now() });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
