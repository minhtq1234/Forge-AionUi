import type { TContextBudgetStatus, TContextHandoffBudgetSnapshot, TContextHandoffItem } from '@/common/config/storage';

export type ContextHandoffPinnedItem = TContextHandoffItem;
export type ContextBudgetStatus = TContextBudgetStatus;
export type ContextBudgetSnapshot = TContextHandoffBudgetSnapshot;

export type ContextMarkdownSection =
  | 'Goal'
  | 'Current State'
  | 'Important Decisions'
  | 'Files / Artifacts'
  | 'Assistant Setup'
  | 'Pinned Context'
  | 'User Preferences'
  | 'Open Questions'
  | 'Next Step'
  | 'Do Not Forget';

export const CONTEXT_MARKDOWN_SECTIONS: ContextMarkdownSection[] = [
  'Goal',
  'Current State',
  'Important Decisions',
  'Files / Artifacts',
  'Assistant Setup',
  'Pinned Context',
  'User Preferences',
  'Open Questions',
  'Next Step',
  'Do Not Forget',
];
