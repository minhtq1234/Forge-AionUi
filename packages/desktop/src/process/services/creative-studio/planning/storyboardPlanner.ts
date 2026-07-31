/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import { ClientFactory } from '@/common/api';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { StudioTextModelOption, StudioTextModelRef } from '@/common/types/project/creativeStudioTypes';
import { hasSpecificModelCapability } from '@/common/utils/modelCapabilities';
import {
  buildStoryboardMessages,
  parseStoryboardDraftOutput,
  STUDIO_STORYBOARD_MAX_OUTPUT_TOKENS,
  STUDIO_STORYBOARD_PROMPT_VERSION,
  STUDIO_STORYBOARD_TEMPERATURE,
  STUDIO_STORYBOARD_TIMEOUT_MS,
  type StudioStoryboardDraftInput,
  type StudioStoryboardDraftOutput,
  type StudioStoryboardMessage,
} from './storyboardPrompt';

const MAX_ACTIVE_OPERATIONS = 2;
const RETRY_BASE_DELAY_MS = 500;

export type StudioStoryboardPlannerErrorCode =
  | 'model_unavailable'
  | 'busy'
  | 'provider_auth_failed'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_request_failed'
  | 'invalid_output'
  | 'canceled';

export class StudioStoryboardPlannerError extends Error {
  readonly code: StudioStoryboardPlannerErrorCode;

  constructor(code: StudioStoryboardPlannerErrorCode) {
    super(code);
    this.name = 'StudioStoryboardPlannerError';
    this.code = code;
  }
}

export type StudioStoryboardCompletion = {
  choices: Array<{ message: { content?: string | null } }>;
};

export type StudioStoryboardClient = {
  createChatCompletion: (
    params: {
      model: string;
      messages: StudioStoryboardMessage[];
      max_tokens: number;
      temperature: number;
      response_format: { type: 'json_object' };
    },
    options: { signal: AbortSignal; timeout: number }
  ) => Promise<StudioStoryboardCompletion>;
};

export type StudioStoryboardClientOptions = {
  timeout: number;
  rotatingOptions: { maxRetries: number; retryDelay: number };
};

export type StudioStoryboardAuditEvent = {
  promptVersion: string;
  providerId: string;
  model: string;
  status: 'succeeded' | 'failed';
  attempts: number;
  durationMs: number;
  errorCode?: StudioStoryboardPlannerErrorCode;
};

export type StudioStoryboardPlannerDeps = {
  listProviders: () => Promise<IProvider[]>;
  createClient: (
    provider: TProviderWithModel,
    options: StudioStoryboardClientOptions
  ) => Promise<StudioStoryboardClient>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  jitter: () => number;
  emitAudit: (event: StudioStoryboardAuditEvent) => void;
};

export type StudioStoryboardPlanner = {
  listModels(): Promise<StudioTextModelOption[]>;
  draft(input: StudioStoryboardDraftInput, model: StudioTextModelRef): Promise<StudioStoryboardDraftOutput>;
  dispose(): Promise<void>;
};

type ActiveOperation = {
  controller: AbortController;
  promise: Promise<StudioStoryboardDraftOutput>;
};

type NormalizedFailure = {
  code: StudioStoryboardPlannerErrorCode;
  transient: boolean;
};

const readStatus = (error: unknown): number | undefined =>
  error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;

const readName = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : undefined;

const normalizeProviderError = (error: unknown, timedOut: boolean): NormalizedFailure => {
  if (error instanceof StudioStoryboardPlannerError) {
    return { code: error.code, transient: false };
  }
  const name = readName(error);
  if (timedOut || name === 'TimeoutError' || name === 'APIConnectionTimeoutError') {
    return { code: 'provider_timeout', transient: true };
  }
  const status = readStatus(error);
  if (status === 401 || status === 403) return { code: 'provider_auth_failed', transient: false };
  if (status === 429) return { code: 'provider_rate_limited', transient: true };

  const transientNames = new Set(['APIConnectionError', 'ConnectionError', 'FetchError', 'NetworkError']);
  return {
    code: 'provider_request_failed',
    transient: (status !== undefined && status >= 500 && status < 600) || transientNames.has(name ?? ''),
  };
};

const isEligibleTextModel = (provider: IProvider, model: string): boolean =>
  provider.enabled !== false &&
  provider.api_key.trim().length > 0 &&
  provider.models.includes(model) &&
  provider.model_enabled?.[model] !== false &&
  provider.model_health?.[model]?.status !== 'unhealthy' &&
  hasSpecificModelCapability(provider, model, 'excludeFromPrimary') !== true &&
  hasSpecificModelCapability(provider, model, 'image_generation') !== true &&
  hasSpecificModelCapability(provider, model, 'embedding') !== true &&
  hasSpecificModelCapability(provider, model, 'rerank') !== true;

const defaultDependencies: StudioStoryboardPlannerDeps = {
  listProviders: () => httpRequest<IProvider[]>('GET', '/api/providers'),
  createClient: async (provider, options) => {
    const created = await ClientFactory.createRotatingClient(provider, options);
    return created as unknown as StudioStoryboardClient;
  },
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => Date.now(),
  jitter: () => Math.floor(Math.random() * 100),
  emitAudit: (event) => console.info('[CreativeStudioStoryboard]', event),
};

/** Creates the main-process Studio planner with bounded provider execution. */
export const createStudioStoryboardPlanner = (
  deps: StudioStoryboardPlannerDeps = defaultDependencies
): StudioStoryboardPlanner => {
  const dependencies = { ...defaultDependencies, ...deps };
  const active = new Map<string, ActiveOperation>();
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  const listModels = async (): Promise<StudioTextModelOption[]> => {
    const providers = await dependencies.listProviders();
    return providers.flatMap((provider) =>
      provider.models
        .filter((model) => isEligibleTextModel(provider, model))
        .map((model) => ({
          providerId: provider.id,
          providerName: provider.name,
          model,
          health: provider.model_health?.[model]?.status === 'healthy' ? ('available' as const) : ('unknown' as const),
        }))
    );
  };

  const execute = async (
    input: StudioStoryboardDraftInput,
    model: StudioTextModelRef,
    controller: AbortController
  ): Promise<StudioStoryboardDraftOutput> => {
    const startedAt = dependencies.now();
    let attempts = 0;
    let timedOut = false;
    const deadlineId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STUDIO_STORYBOARD_TIMEOUT_MS);

    const abortFailure = (): StudioStoryboardPlannerError =>
      new StudioStoryboardPlannerError(timedOut ? 'provider_timeout' : 'canceled');

    const waitForAbort = <T>(promise: Promise<T>): Promise<T> => {
      if (controller.signal.aborted) return Promise.reject(abortFailure());
      return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(abortFailure());
        const cleanup = (): void => controller.signal.removeEventListener('abort', onAbort);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        void promise.then(
          (value) => {
            cleanup();
            resolve(value);
          },
          (error: unknown) => {
            cleanup();
            reject(error);
          }
        );
      });
    };

    let status: StudioStoryboardAuditEvent['status'] = 'failed';
    let errorCode: StudioStoryboardPlannerErrorCode | undefined;
    try {
      let providers: IProvider[];
      try {
        providers = await waitForAbort(dependencies.listProviders());
      } catch (error) {
        if (error instanceof StudioStoryboardPlannerError) throw error;
        throw new StudioStoryboardPlannerError('provider_request_failed');
      }
      const provider = providers.find((candidate) => candidate.id === model.providerId);
      if (!provider || !isEligibleTextModel(provider, model.model)) {
        throw new StudioStoryboardPlannerError('model_unavailable');
      }
      const selectedProvider: TProviderWithModel = { ...provider, use_model: model.model };
      let client: StudioStoryboardClient;
      try {
        client = await waitForAbort(
          dependencies.createClient(selectedProvider, {
            timeout: STUDIO_STORYBOARD_TIMEOUT_MS,
            rotatingOptions: { maxRetries: 1, retryDelay: 0 },
          })
        );
      } catch (error) {
        if (error instanceof StudioStoryboardPlannerError) throw error;
        const failure = normalizeProviderError(error, timedOut);
        throw new StudioStoryboardPlannerError(failure.code);
      }

      for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
        attempts += 1;
        try {
          // Retries are intentionally sequential and remain on the exact selected model.
          // eslint-disable-next-line no-await-in-loop
          const completion = await waitForAbort(
            client.createChatCompletion(
              {
                model: model.model,
                messages: buildStoryboardMessages(input),
                max_tokens: STUDIO_STORYBOARD_MAX_OUTPUT_TOKENS,
                temperature: STUDIO_STORYBOARD_TEMPERATURE,
                response_format: { type: 'json_object' },
              },
              { signal: controller.signal, timeout: STUDIO_STORYBOARD_TIMEOUT_MS }
            )
          );
          const raw = completion.choices[0]?.message.content ?? '';
          let output: StudioStoryboardDraftOutput;
          try {
            output = parseStoryboardDraftOutput(raw, input);
          } catch {
            throw new StudioStoryboardPlannerError('invalid_output');
          }
          status = 'succeeded';
          return output;
        } catch (error) {
          if (error instanceof StudioStoryboardPlannerError) throw error;
          const failure = normalizeProviderError(error, timedOut);
          if (!failure.transient || attemptIndex === 1) {
            throw new StudioStoryboardPlannerError(failure.code);
          }
          const delay = RETRY_BASE_DELAY_MS * 2 ** attemptIndex + Math.max(0, dependencies.jitter());
          // Backoff must finish within the shared deadline before the retry begins.
          // eslint-disable-next-line no-await-in-loop
          await waitForAbort(dependencies.sleep(delay));
        }
      }
      throw new StudioStoryboardPlannerError('provider_request_failed');
    } catch (error) {
      const normalized =
        error instanceof StudioStoryboardPlannerError
          ? error
          : new StudioStoryboardPlannerError(normalizeProviderError(error, timedOut).code);
      errorCode = normalized.code;
      throw normalized;
    } finally {
      clearTimeout(deadlineId);
      dependencies.emitAudit({
        promptVersion: STUDIO_STORYBOARD_PROMPT_VERSION,
        providerId: model.providerId,
        model: model.model,
        status,
        attempts,
        durationMs: Math.max(0, dependencies.now() - startedAt),
        ...(errorCode ? { errorCode } : {}),
      });
    }
  };

  const draft = (
    input: StudioStoryboardDraftInput,
    model: StudioTextModelRef
  ): Promise<StudioStoryboardDraftOutput> => {
    const key = `${input.projectId}:${input.projectRevision}:${model.providerId}:${model.model}`;
    const existing = active.get(key);
    if (existing) return existing.promise;
    if (disposed) return Promise.reject(new StudioStoryboardPlannerError('canceled'));
    if (active.size >= MAX_ACTIVE_OPERATIONS) {
      return Promise.reject(new StudioStoryboardPlannerError('busy'));
    }

    const controller = new AbortController();
    const operation: ActiveOperation = {
      controller,
      promise: Promise.resolve(undefined as never),
    };
    operation.promise = execute(input, model, controller).finally(() => {
      if (active.get(key) === operation) active.delete(key);
    });
    active.set(key, operation);
    return operation.promise;
  };

  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposed = true;
    const operations = [...active.values()];
    for (const operation of operations) operation.controller.abort();
    disposePromise = Promise.allSettled(operations.map((operation) => operation.promise)).then(
      (): undefined => undefined
    );
    return disposePromise;
  };

  return { listModels, draft, dispose };
};
