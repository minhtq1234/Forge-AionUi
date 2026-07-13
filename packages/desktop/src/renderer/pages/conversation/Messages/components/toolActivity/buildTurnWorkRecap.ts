import type { ToolCategory } from '@/common/chat/toolActivity/types';

export type TurnWorkRecapStatus = 'active' | 'completed' | 'recovered' | 'partial' | 'failed' | 'canceled';

export type TurnWorkCategoryCount = {
  category: ToolCategory;
  count: number;
};

export type TurnWorkRecap = {
  status: TurnWorkRecapStatus;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  canceled: number;
  unfinished: number;
  retries: number;
  categories: TurnWorkCategoryCount[];
  safeSubject?: string;
};

export type TurnWorkRecapRow = {
  category: ToolCategory;
  status: 'pending' | 'running' | 'completed' | 'error' | 'canceled';
  attempts?: number;
  hadError?: boolean;
  safeSubject?: string;
};

export const buildTurnWorkRecap = (rows: TurnWorkRecapRow[], isActive: boolean): TurnWorkRecap => {
  const categories: TurnWorkCategoryCount[] = [];
  const categoryIndex = new Map<ToolCategory, number>();
  let completed = 0;
  let failed = 0;
  let pending = 0;
  let canceled = 0;
  let retries = 0;
  let recovered = false;
  let safeSubject: string | undefined;

  for (const row of rows) {
    const index = categoryIndex.get(row.category);
    if (index === undefined) {
      categoryIndex.set(row.category, categories.length);
      categories.push({ category: row.category, count: 1 });
    } else {
      categories[index].count += 1;
    }

    if (row.status === 'completed') {
      completed += 1;
      recovered ||= row.hadError === true;
    } else if (row.status === 'error') {
      failed += 1;
    } else if (row.status === 'canceled') {
      canceled += 1;
    } else {
      pending += 1;
    }

    if (row.hadError) retries += Math.max((row.attempts ?? 1) - 1, 0);
    safeSubject ??= row.safeSubject;
  }

  const status: TurnWorkRecapStatus =
    isActive && pending > 0
      ? 'active'
      : failed > 0 && completed > 0
        ? 'partial'
        : failed > 0
          ? 'failed'
          : canceled > 0 || pending > 0
            ? 'canceled'
            : recovered
              ? 'recovered'
              : 'completed';

  return {
    status,
    total: rows.length,
    completed,
    failed,
    pending,
    canceled,
    unfinished: failed + pending + canceled,
    retries,
    categories,
    ...(safeSubject ? { safeSubject } : {}),
  };
};
