/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';

/**
 * Single source of truth for which assistants appear in a *selection* list
 * (home pill bar, team creation, scheduled-task dropdown, …) and in what order.
 *
 * Rules (see PRD F-AHM-06 / F-AHM-07):
 *  - Only enabled assistants are selectable.
 *  - Groups are ordered: bare CLI first, then user-created, managed, then
 *    official (builtin). This keeps user-owned agents first while giving every
 *    source a stable cross-group position that is not user-adjustable.
 *  - Within a group, order follows `sort_order` (which the user controls for
 *    CLI/user via drag; managed and official order is backend-owned).
 *
 * Note: a bare CLI assistant surfaces with `source === 'generated'`.
 */

/** Group weight — lower comes first. Bare CLI < user-created < managed < official. */
const SOURCE_GROUP_WEIGHT: Record<Assistant['source'], number> = {
  generated: 0,
  user: 1,
  managed: 2,
  builtin: 3,
};

/**
 * Return the enabled assistants ordered for a selection list:
 * bare → user → managed → builtin, each group sorted by `sort_order`.
 */
export const selectableAssistants = (assistants: Assistant[]): Assistant[] =>
  [...assistants]
    .filter((assistant) => assistant.enabled !== false)
    .sort((left, right) => {
      const groupDelta = SOURCE_GROUP_WEIGHT[left.source] - SOURCE_GROUP_WEIGHT[right.source];
      if (groupDelta !== 0) return groupDelta;
      return left.sort_order - right.sort_order;
    });
