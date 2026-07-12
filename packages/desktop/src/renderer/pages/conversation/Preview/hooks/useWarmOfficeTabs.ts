/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef } from 'react';

/**
 * Maximum number of office viewers (word/excel/ppt) kept mounted ("warm") at
 * once. Each warm viewer holds a live `officecli watch` + lease, so this caps
 * concurrent resource use. Office tabs beyond the cap go cold (unmounted →
 * lease released) and re-initialize when reactivated.
 * 同时保持挂载（warm）的 Office 预览器上限；超过上限的标签页会被卸载并释放租约。
 */
export const WARM_OFFICE_TAB_LIMIT = 3;

/**
 * Track the `WARM_OFFICE_TAB_LIMIT` most-recently-active office tabs.
 *
 * Returns the set of office tab ids that should stay mounted. The currently
 * active office tab is always included (it becomes the most-recently-used
 * entry); closed tabs (ids no longer present in `officeTabIds`) drop out.
 *
 * MRU order is maintained in a ref and re-derived on every render purely from
 * `(activeTabId, officeTabIds, previous order)` — no timestamps or randomness —
 * so the computation is deterministic and idempotent: rendering twice with the
 * same inputs yields the same order and the same warm set. That makes it safe
 * to update the ref during render (e.g. under React StrictMode double renders).
 *
 * @param activeTabId The active preview tab id (may be a non-office tab or null).
 * @param officeTabIds Ids of the currently open office tabs.
 * @returns The set of office tab ids that should remain warm (mounted).
 */
export function useWarmOfficeTabs(activeTabId: string | null, officeTabIds: string[]): Set<string> {
  // MRU order of office tab ids; index 0 = most recently active.
  const mruRef = useRef<string[]>([]);

  const officeIdSet = new Set(officeTabIds);
  const activeOfficeId = activeTabId !== null && officeIdSet.has(activeTabId) ? activeTabId : null;

  // Rebuild the MRU order deterministically:
  //   1. the active office tab first (most recent),
  //   2. then the previous order (existing office tabs only),
  //   3. then any newly opened office tabs, in their listed order.
  // Every candidate is filtered against the current id set so closed tabs are
  // dropped, and de-duplicated so each id appears once.
  const next: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (officeIdSet.has(id) && !seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  };

  if (activeOfficeId !== null) push(activeOfficeId);
  for (const id of mruRef.current) push(id);
  for (const id of officeTabIds) push(id);

  mruRef.current = next;

  // The warm set is the K most-recently-active ids. Since the active office tab
  // is placed first, it is always warm when the limit is >= 1.
  return new Set(next.slice(0, WARM_OFFICE_TAB_LIMIT));
}
