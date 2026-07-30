import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type {
  AppOperationErrorCode,
  AppOperationMetadata,
  AppOperationResult,
  AppOperationsModelResponse,
} from '@/common/types/appOperations';
import type { z } from 'zod';

export type AppOperationMessage = { role: 'system' | 'user'; content: string };

export type AppOperationTaskDefinition<Input, Prepared, Output> = Readonly<{
  id: string;
  promptVersion: string;
  inputSchema: z.ZodType<Input>;
  prepare: (input: Input, context: { signal: AbortSignal }) => Promise<Prepared>;
  buildMessages: (prepared: Prepared) => AppOperationMessage[];
  parseOutput: (raw: string, input: Input) => Output;
  responseMode: 'text' | 'json';
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxTransientRetries: number;
}>;

export type AnyAppOperationTaskDefinition = AppOperationTaskDefinition<unknown, unknown, unknown>;

export type RunTaskOptions = { signal?: AbortSignal; dedupeKey?: string };

export type AppOperationsAuditEvent = AppOperationMetadata & {
  status: 'succeeded' | 'failed';
  error_code?: AppOperationErrorCode;
};

export type AppOperationsCompletion = {
  choices: Array<{ message: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type AppOperationsClient = {
  createChatCompletion: (
    params: {
      model: string;
      messages: AppOperationMessage[];
      max_tokens: number;
      temperature: number;
      response_format?: { type: 'json_object' };
    },
    options?: { signal?: AbortSignal; timeout?: number }
  ) => Promise<AppOperationsCompletion>;
};

export type AppOperationsClientOptions = {
  timeout: number;
  rotatingOptions: { maxRetries: number; retryDelay: number };
};

export type AppOperationsBrokerDependencies = {
  resolveModel: () => Promise<AppOperationsModelResponse>;
  listProviders: () => Promise<IProvider[]>;
  createClient: (provider: TProviderWithModel, options: AppOperationsClientOptions) => Promise<AppOperationsClient>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  jitter: () => number;
  emitAudit: (event: AppOperationsAuditEvent) => void;
};

export type AppOperationsBrokerOptions = {
  concurrency?: number;
  maxQueue?: number;
  dependencies?: Partial<AppOperationsBrokerDependencies>;
};

export type AppOperationsTaskResult<Output = unknown> = AppOperationResult<Output>;
