import { httpRequest } from '@/common/adapter/httpBridge';
import { appOperationsModel } from '@/common/adapter/ipcBridge';
import { ClientFactory } from '@/common/api';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { AppOperationErrorCode, AppOperationMetadata, AppOperationResult } from '@/common/types/appOperations';
import type { AppOperationTaskRegistry } from './taskRegistry';
import type {
  AnyAppOperationTaskDefinition,
  AppOperationsBrokerDependencies,
  AppOperationsBrokerOptions,
  AppOperationsClient,
  AppOperationsCompletion,
  AppOperationsTaskResult,
  RunTaskOptions,
} from './types';

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_QUEUE = 50;
const RETRY_BASE_DELAY_MS = 500;

type SharedStatus = 'queued' | 'running' | 'settled';

type Joiner = {
  deduplicated: boolean;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (result: AppOperationResult<unknown>) => void;
};

type SharedOperation = {
  id: number;
  dedupeId?: string;
  task: AnyAppOperationTaskDefinition;
  input: unknown;
  admittedAt: number;
  startedAt?: number;
  status: SharedStatus;
  controller: AbortController;
  joiners: Map<number, Joiner>;
  nextJoinerId: number;
  hadDeduplicatedJoiner: boolean;
  providerId?: string;
  modelId?: string;
  attempts: number;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type AttemptFailure = {
  code: AppOperationErrorCode;
  transient: boolean;
};

const retryableByCode = (code: AppOperationErrorCode): boolean =>
  code === 'provider_rate_limited' ||
  code === 'provider_timeout' ||
  code === 'provider_request_failed' ||
  code === 'queue_full';

const readStatus = (error: unknown): number | undefined =>
  error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;

const readName = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : undefined;

const normalizeProviderError = (error: unknown, timedOut: boolean): AttemptFailure => {
  const name = readName(error);
  if (timedOut || name === 'AbortError' || name === 'TimeoutError' || name === 'APIConnectionTimeoutError') {
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

const defaultDependencies: AppOperationsBrokerDependencies = {
  resolveModel: () => appOperationsModel.get.invoke(),
  listProviders: () => httpRequest<IProvider[]>('GET', '/api/providers'),
  createClient: async (provider, options) => {
    const client = await ClientFactory.createRotatingClient(provider, options);
    return client as unknown as AppOperationsClient;
  },
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => Date.now(),
  jitter: () => Math.floor(Math.random() * 100),
  emitAudit: (event) => console.info('[AppOperations]', event),
};

export class AppOperationsBroker {
  private readonly registry: AppOperationTaskRegistry;
  private readonly concurrency: number;
  private readonly maxQueue: number;
  private readonly dependencies: AppOperationsBrokerDependencies;
  private readonly queue: SharedOperation[] = [];
  private readonly deduplicatedOperations = new Map<string, SharedOperation>();
  private readonly runningOperations = new Set<SharedOperation>();
  private runningCount = 0;
  private nextOperationId = 1;

  constructor(registry: AppOperationTaskRegistry, options: AppOperationsBrokerOptions = {}) {
    this.registry = registry;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.dependencies = { ...defaultDependencies, ...options.dependencies };

    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) throw new Error('invalid_concurrency');
    if (!Number.isInteger(this.maxQueue) || this.maxQueue < 0) throw new Error('invalid_max_queue');
  }

  runTask<Output = unknown>(
    taskId: string,
    input: unknown,
    options: RunTaskOptions = {}
  ): Promise<AppOperationsTaskResult<Output>> {
    let task: AnyAppOperationTaskDefinition;
    try {
      task = this.registry.get(taskId);
    } catch {
      return Promise.resolve(
        this.immediateFailure(taskId, 'unknown', 'invalid_input', false) as AppOperationsTaskResult<Output>
      );
    }

    const parsedInput = task.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return Promise.resolve(
        this.immediateFailure(task.id, task.promptVersion, 'invalid_input', false) as AppOperationsTaskResult<Output>
      );
    }

    if (options.signal?.aborted) {
      return Promise.resolve(
        this.immediateFailure(task.id, task.promptVersion, 'canceled', false) as AppOperationsTaskResult<Output>
      );
    }

    const dedupeId = options.dedupeKey === undefined ? undefined : `${task.id}\u0000${options.dedupeKey}`;
    if (dedupeId) {
      const existing = this.deduplicatedOperations.get(dedupeId);
      if (existing && existing.status !== 'settled' && !existing.controller.signal.aborted) {
        return this.attachJoiner(existing, options.signal, true) as Promise<AppOperationsTaskResult<Output>>;
      }
      if (existing) this.removeDedupeEntry(existing);
    }

    if (this.runningCount >= this.concurrency && this.queue.length >= this.maxQueue) {
      return Promise.resolve(
        this.immediateFailure(task.id, task.promptVersion, 'queue_full', false) as AppOperationsTaskResult<Output>
      );
    }

    const shared: SharedOperation = {
      id: this.nextOperationId,
      dedupeId,
      task,
      input: parsedInput.data,
      admittedAt: this.dependencies.now(),
      status: this.runningCount < this.concurrency ? 'running' : 'queued',
      controller: new AbortController(),
      joiners: new Map(),
      nextJoinerId: 1,
      hadDeduplicatedJoiner: false,
      attempts: 0,
    };
    this.nextOperationId += 1;
    if (dedupeId) this.deduplicatedOperations.set(dedupeId, shared);

    const result = this.attachJoiner(shared, options.signal, false) as Promise<AppOperationsTaskResult<Output>>;
    if (shared.status === 'running') this.start(shared);
    else this.queue.push(shared);
    return result;
  }

  cancelAll(): void {
    const queued = this.queue.splice(0);
    for (const shared of queued) {
      this.finalize(shared, this.failure(shared, 'canceled'));
    }
    for (const shared of this.runningOperations) shared.controller.abort();
  }

  private immediateFailure(
    taskId: string,
    promptVersion: string,
    code: AppOperationErrorCode,
    deduplicated: boolean
  ): AppOperationResult<unknown> {
    const operation: AppOperationMetadata = {
      task_id: taskId,
      prompt_version: promptVersion,
      duration_ms: 0,
      queue_wait_ms: 0,
      attempts: 0,
      deduplicated,
    };
    const result: AppOperationResult<unknown> = {
      ok: false,
      error: { code, retryable: retryableByCode(code) },
      operation,
    };
    this.dependencies.emitAudit({ ...operation, status: 'failed', error_code: code });
    return result;
  }

  private attachJoiner(
    shared: SharedOperation,
    signal: AbortSignal | undefined,
    deduplicated: boolean
  ): Promise<AppOperationResult<unknown>> {
    if (deduplicated) shared.hadDeduplicatedJoiner = true;

    return new Promise((resolve) => {
      const joinerId = shared.nextJoinerId;
      shared.nextJoinerId += 1;
      const joiner: Joiner = { deduplicated, signal, resolve };

      const cancelJoiner = (): void => {
        if (!shared.joiners.delete(joinerId)) return;
        if (joiner.onAbort && signal) signal.removeEventListener('abort', joiner.onAbort);
        resolve(this.cloneForJoiner(this.failure(shared, 'canceled'), deduplicated));

        if (shared.joiners.size > 0 || shared.status === 'settled') return;
        this.removeDedupeEntry(shared);
        if (shared.status === 'queued') {
          const queueIndex = this.queue.indexOf(shared);
          if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
          this.finalize(shared, this.failure(shared, 'canceled'));
          return;
        }
        shared.controller.abort();
      };

      joiner.onAbort = cancelJoiner;
      shared.joiners.set(joinerId, joiner);
      if (signal) signal.addEventListener('abort', cancelJoiner, { once: true });
    });
  }

  private start(shared: SharedOperation): void {
    if (shared.controller.signal.aborted || shared.status === 'settled') return;
    shared.status = 'running';
    shared.startedAt = this.dependencies.now();
    this.runningCount += 1;
    this.runningOperations.add(shared);

    void this.execute(shared)
      .then((result) => this.finalize(shared, result))
      .catch(() =>
        this.finalize(
          shared,
          this.failure(shared, shared.controller.signal.aborted ? 'canceled' : 'provider_request_failed')
        )
      )
      .finally(() => {
        this.runningOperations.delete(shared);
        this.runningCount -= 1;
        this.drainQueue();
      });
  }

  private drainQueue(): void {
    while (this.runningCount < this.concurrency) {
      const next = this.queue.shift();
      if (!next) return;
      if (next.status === 'settled' || next.controller.signal.aborted || next.joiners.size === 0) continue;
      this.start(next);
    }
  }

  private async execute(shared: SharedOperation): Promise<AppOperationResult<unknown>> {
    let resolution;
    try {
      resolution = await this.dependencies.resolveModel();
    } catch (error) {
      if (shared.controller.signal.aborted) return this.failure(shared, 'canceled');
      const status = readStatus(error);
      return this.failure(shared, status === 404 || status === 501 ? 'not_configured' : 'provider_request_failed');
    }

    if (shared.controller.signal.aborted) return this.failure(shared, 'canceled');
    if (resolution.health === 'setup_required') return this.failure(shared, 'not_configured');
    if (resolution.health === 'unavailable' || !resolution.resolved_model) {
      return this.failure(shared, 'model_unavailable');
    }

    const { provider_id: providerId, model_id: modelId } = resolution.resolved_model;
    shared.providerId = providerId;
    shared.modelId = modelId;

    let providers: IProvider[];
    try {
      providers = await this.dependencies.listProviders();
    } catch {
      if (shared.controller.signal.aborted) return this.failure(shared, 'canceled');
      return this.failure(shared, 'provider_request_failed');
    }
    if (shared.controller.signal.aborted) return this.failure(shared, 'canceled');

    const provider = providers.find((candidate) => candidate.id === providerId);
    if (
      !provider ||
      provider.enabled === false ||
      !provider.models.includes(modelId) ||
      provider.model_enabled?.[modelId] === false
    ) {
      return this.failure(shared, 'model_unavailable');
    }
    const selectedProvider: TProviderWithModel = { ...provider, use_model: modelId };

    let prepared: unknown;
    let messages;
    try {
      prepared = await shared.task.prepare(shared.input, { signal: shared.controller.signal });
      if (shared.controller.signal.aborted) return this.failure(shared, 'canceled');
      messages = shared.task.buildMessages(prepared);
    } catch {
      return this.failure(shared, shared.controller.signal.aborted ? 'canceled' : 'provider_request_failed');
    }

    let client: AppOperationsClient;
    try {
      client = await this.dependencies.createClient(selectedProvider, {
        timeout: shared.task.timeoutMs,
        rotatingOptions: { maxRetries: 1, retryDelay: 0 },
      });
    } catch (error) {
      if (shared.controller.signal.aborted) return this.failure(shared, 'canceled');
      const failure = normalizeProviderError(error, false);
      return this.failure(shared, failure.code, failure.transient && retryableByCode(failure.code));
    }

    const maxAttempts = 1 + shared.task.maxTransientRetries;
    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      if (shared.controller.signal.aborted) return this.failure(shared, 'canceled');
      shared.attempts += 1;

      // Provider retries are intentionally sequential and remain on the captured client.
      // eslint-disable-next-line no-await-in-loop
      const attempt = await this.requestOnce(shared, client, messages);
      if ('completion' in attempt) {
        const raw = attempt.completion.choices[0]?.message.content ?? '';
        let output: unknown;
        try {
          output = shared.task.parseOutput(raw, shared.input);
        } catch {
          return this.failure(shared, 'invalid_output');
        }
        shared.usage = this.mapUsage(attempt.completion);
        return { ok: true, output, operation: this.metadata(shared, false) };
      }

      if (attempt.code === 'canceled') return this.failure(shared, 'canceled');
      const hasRetry = attemptIndex < maxAttempts - 1;
      if (!hasRetry || !attempt.transient) {
        return this.failure(shared, attempt.code, attempt.transient && retryableByCode(attempt.code));
      }

      const delay = RETRY_BASE_DELAY_MS * 2 ** attemptIndex + Math.max(0, this.dependencies.jitter());
      // Backoff must complete before the next sequential provider attempt.
      // eslint-disable-next-line no-await-in-loop
      const completedSleep = await this.sleepUntilRetry(delay, shared.controller.signal);
      if (!completedSleep) return this.failure(shared, 'canceled');
    }

    return this.failure(shared, 'provider_request_failed');
  }

  private async requestOnce(
    shared: SharedOperation,
    client: AppOperationsClient,
    messages: ReturnType<AnyAppOperationTaskDefinition['buildMessages']>
  ): Promise<{ completion: AppOperationsCompletion } | (AttemptFailure & { code: AppOperationErrorCode })> {
    const attemptController = new AbortController();
    const abortAttempt = (): void => attemptController.abort();
    shared.controller.signal.addEventListener('abort', abortAttempt, { once: true });
    let didTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const providerRequest = client.createChatCompletion(
        {
          model: shared.modelId ?? '',
          messages,
          max_tokens: shared.task.maxOutputTokens,
          temperature: shared.task.temperature,
          ...(shared.task.responseMode === 'json' ? { response_format: { type: 'json_object' as const } } : {}),
        },
        { signal: attemptController.signal, timeout: shared.task.timeoutMs }
      );
      const deadline = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          didTimeout = true;
          attemptController.abort();
          reject(Object.assign(new Error(), { name: 'TimeoutError' }));
        }, shared.task.timeoutMs);
      });
      const completion = await Promise.race([providerRequest, deadline]);
      return { completion };
    } catch (error) {
      if (shared.controller.signal.aborted) return { code: 'canceled', transient: false };
      return normalizeProviderError(error, didTimeout);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      shared.controller.signal.removeEventListener('abort', abortAttempt);
    }
  }

  private async sleepUntilRetry(milliseconds: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<false>((resolve) => {
      onAbort = () => resolve(false);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([this.dependencies.sleep(milliseconds).then(() => true), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private mapUsage(completion: AppOperationsCompletion): { input_tokens?: number; output_tokens?: number } | undefined {
    if (!completion.usage) return undefined;
    return {
      input_tokens: completion.usage.prompt_tokens,
      output_tokens: completion.usage.completion_tokens,
    };
  }

  private metadata(shared: SharedOperation, deduplicated: boolean): AppOperationMetadata {
    return {
      task_id: shared.task.id,
      prompt_version: shared.task.promptVersion,
      provider_id: shared.providerId,
      model_id: shared.modelId,
      duration_ms: Math.max(0, this.dependencies.now() - shared.admittedAt),
      queue_wait_ms: Math.max(0, (shared.startedAt ?? this.dependencies.now()) - shared.admittedAt),
      attempts: shared.attempts,
      deduplicated,
      usage: shared.usage,
    };
  }

  private failure(
    shared: SharedOperation,
    code: AppOperationErrorCode,
    retryable = retryableByCode(code)
  ): AppOperationResult<unknown> {
    return {
      ok: false,
      error: { code, retryable },
      operation: this.metadata(shared, false),
    };
  }

  private cloneForJoiner(result: AppOperationResult<unknown>, deduplicated: boolean): AppOperationResult<unknown> {
    return { ...result, operation: { ...result.operation, deduplicated } };
  }

  private removeDedupeEntry(shared: SharedOperation): void {
    if (shared.dedupeId && this.deduplicatedOperations.get(shared.dedupeId) === shared) {
      this.deduplicatedOperations.delete(shared.dedupeId);
    }
  }

  private finalize(shared: SharedOperation, result: AppOperationResult<unknown>): void {
    if (shared.status === 'settled') return;
    shared.status = 'settled';
    this.removeDedupeEntry(shared);

    for (const joiner of shared.joiners.values()) {
      if (joiner.onAbort && joiner.signal) joiner.signal.removeEventListener('abort', joiner.onAbort);
      joiner.resolve(this.cloneForJoiner(result, joiner.deduplicated));
    }
    shared.joiners.clear();

    const operation = { ...result.operation, deduplicated: shared.hadDeduplicatedJoiner };
    if ('error' in result) {
      this.dependencies.emitAudit({ ...operation, status: 'failed', error_code: result.error.code });
    } else {
      this.dependencies.emitAudit({ ...operation, status: 'succeeded' });
    }
  }
}
