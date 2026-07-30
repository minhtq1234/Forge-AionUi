import type { TContextSnapshot } from '@/common/config/storage';
import type { AppOperationResult, AppOperationsContextCompactOutput } from '@/common/types/appOperations';
import { AppOperationsBroker } from './broker';
import { contextCompactTask, type ContextCompactInput } from './contextCompactTask';
import {
  storyboardDraftTask,
  type StudioStoryboardDraftTaskInput,
  type StudioStoryboardDraftOutput,
} from './storyboardDraftTask';
import { createTaskRegistry } from './taskRegistry';
import type { RunTaskOptions } from './types';

const appOperationsRegistry = createTaskRegistry();
appOperationsRegistry.register(contextCompactTask);
appOperationsRegistry.register(storyboardDraftTask);

export const appOperationsBroker = new AppOperationsBroker(appOperationsRegistry);

export const runContextCompact = async (
  input: ContextCompactInput,
  options: Omit<RunTaskOptions, 'dedupeKey'> = {}
): Promise<AppOperationResult<AppOperationsContextCompactOutput>> => {
  const result = await appOperationsBroker.runTask<TContextSnapshot>('context.compact', input, {
    ...options,
    dedupeKey: `${input.conversation_id}:${input.target_turn_id ?? input.last_compacted_turn_id ?? 'latest'}`,
  });
  if ('error' in result) return result;

  return {
    ...result,
    output: {
      snapshot: result.output,
      through_turn_id: input.target_turn_id || input.last_compacted_turn_id || '',
    },
  };
};

/** Runs the only Studio planning task through the app-wide operations broker. */
export const runStudioStoryboardDraft = (
  input: StudioStoryboardDraftTaskInput,
  options: Omit<RunTaskOptions, 'dedupeKey'> = {}
): Promise<AppOperationResult<StudioStoryboardDraftOutput>> =>
  appOperationsBroker.runTask<StudioStoryboardDraftOutput>('studio.storyboard-draft', input, {
    ...options,
    dedupeKey: `${input.projectId}:${input.projectRevision}`,
  });

export { AppOperationsBroker } from './broker';
export { createTaskRegistry, type AppOperationTaskRegistry } from './taskRegistry';
export type {
  AppOperationTaskDefinition,
  AppOperationsAuditEvent,
  AppOperationsBrokerDependencies,
  AppOperationsBrokerOptions,
  RunTaskOptions,
} from './types';
