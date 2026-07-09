import type { NormalizedToolCall, NormalizedToolStatus } from '@/common/chat/normalizeToolCall';

export type ToolCategory =
  | 'web'
  | 'search'
  | 'fileRead'
  | 'fileWrite'
  | 'data'
  | 'report'
  | 'export'
  | 'memory'
  | 'code'
  | 'office'
  | 'generic';

export type ResolvedToolAction = {
  toolKey?: string;
  category: ToolCategory;
};

export type CoalescedStep = {
  key: string;
  rawName: string;
  kind?: string;
  status: NormalizedToolStatus;
  attempts: number;
  calls: NormalizedToolCall[];
};
