import { useSyncExternalStore } from 'react';
import {
  getLocalTokenUsageSummary,
  subscribeToLocalTokenUsage,
  type LocalTokenUsageSummary,
} from '@/renderer/pages/conversation/utils/localTokenUsage';

const EMPTY_SUMMARY: LocalTokenUsageSummary = { today: 0, weekToDate: 0, monthToDate: 0 };
let cachedSummary = EMPTY_SUMMARY;

function getSnapshot(): LocalTokenUsageSummary {
  const nextSummary = getLocalTokenUsageSummary();
  if (
    cachedSummary.today === nextSummary.today &&
    cachedSummary.weekToDate === nextSummary.weekToDate &&
    cachedSummary.monthToDate === nextSummary.monthToDate
  ) {
    return cachedSummary;
  }
  cachedSummary = nextSummary;
  return cachedSummary;
}

function subscribeToSnapshot(onStoreChange: () => void): () => void {
  const unsubscribeFromLedger = subscribeToLocalTokenUsage(onStoreChange);
  let midnightTimer: number | undefined;

  const scheduleNextMidnight = () => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnightTimer = window.setTimeout(() => {
      onStoreChange();
      scheduleNextMidnight();
    }, nextMidnight.getTime() - now.getTime());
  };

  scheduleNextMidnight();

  return () => {
    unsubscribeFromLedger();
    if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
  };
}

export function useLocalTokenUsage(): LocalTokenUsageSummary {
  return useSyncExternalStore(subscribeToSnapshot, getSnapshot, () => EMPTY_SUMMARY);
}
