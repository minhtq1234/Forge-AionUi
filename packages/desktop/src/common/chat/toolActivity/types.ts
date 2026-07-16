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
  | 'verify'
  | 'office'
  | 'generic';

export type ToolActivityPurpose = 'discovering' | 'reviewing' | 'changing' | 'running' | 'verifying' | 'delivering';

export type ResolvedToolAction = {
  toolKey?: string;
  category: ToolCategory;
  purpose: ToolActivityPurpose;
};

export type CoalescedStep = {
  key: string;
  rawName: string;
  kind?: string;
  status: NormalizedToolStatus;
  hadError: boolean;
  attempts: number;
  calls: NormalizedToolCall[];
  action: ResolvedToolAction;
};
