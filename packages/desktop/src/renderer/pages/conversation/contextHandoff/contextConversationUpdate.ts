import type { TChatConversation, TContextHandoffExtra } from '@/common/config/storage';
import { mergeContextSnapshotState, type MergeContextSnapshotStateInput } from './contextSnapshot';
import { getConversationContextHandoffExtra } from './pinnedContext';

type AionrsConversation = Extract<TChatConversation, { type: 'aionrs' }>;

export type ContextHandoffExtraPatch = {
  context_handoff: TContextHandoffExtra;
};

export type MutableContextHandoffExtraUpdates = Pick<
  TContextHandoffExtra,
  'pinned_context' | 'context_file_path' | 'context_file_name' | 'last_budget_status' | 'last_exported_at'
>;

export type ContextSnapshotStatePatchMutableUpdates = Pick<
  TContextHandoffExtra,
  'context_file_path' | 'context_file_name' | 'last_budget_status' | 'last_exported_at'
>;

const mergeMutableContextHandoffExtra = (
  current: TContextHandoffExtra,
  updates: Partial<MutableContextHandoffExtraUpdates>
): TContextHandoffExtra => {
  return {
    ...current,
    ...(updates.pinned_context !== undefined ? { pinned_context: updates.pinned_context } : {}),
    ...(updates.context_file_path !== undefined ? { context_file_path: updates.context_file_path } : {}),
    ...(updates.context_file_name !== undefined ? { context_file_name: updates.context_file_name } : {}),
    ...(updates.last_budget_status !== undefined ? { last_budget_status: updates.last_budget_status } : {}),
    ...(updates.last_exported_at !== undefined ? { last_exported_at: updates.last_exported_at } : {}),
  };
};

export const buildContextHandoffExtraPatch = (
  conversation: AionrsConversation,
  updates: Partial<MutableContextHandoffExtraUpdates>
): ContextHandoffExtraPatch => ({
  context_handoff: mergeMutableContextHandoffExtra(getConversationContextHandoffExtra(conversation), updates),
});

export const buildContextSnapshotStatePatch = (
  conversation: AionrsConversation,
  update: MergeContextSnapshotStateInput,
  mutableUpdates: Partial<ContextSnapshotStatePatchMutableUpdates> = {}
): ContextHandoffExtraPatch => ({
  context_handoff: mergeMutableContextHandoffExtra(
    mergeContextSnapshotState(getConversationContextHandoffExtra(conversation), update),
    mutableUpdates
  ),
});
