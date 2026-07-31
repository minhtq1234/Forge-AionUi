/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import type { IProvider } from '@/common/config/storage';
import {
  createStudioStoryboardPlanner,
  type StudioStoryboardClient,
  type StudioStoryboardPlannerDeps,
  type StudioStoryboardDraftInput,
} from '@process/services/creative-studio/planning';
import { afterEach, describe, expect, it, vi } from 'vitest';

const input: StudioStoryboardDraftInput = {
  projectId: 'project_1',
  projectRevision: 3,
  brief: 'UNTRUSTED_STUDIO_BRIEF must-not-leak authorization',
  aspectRatio: '16:9',
  targetDurationSeconds: 6,
};

const selected = { providerId: 'provider_1', model: 'gpt-4o' };

const validOutput = {
  projectSummary: 'A focused product story.',
  scenes: [
    {
      title: 'Opening',
      purpose: 'Introduce the product.',
      visualPrompt: 'A product on a clean table.',
      narration: 'Meet the product.',
      onScreenText: 'A better choice.',
      mediaKind: 'video' as const,
      durationSeconds: 2,
    },
    {
      title: 'Detail',
      purpose: 'Show the product detail.',
      visualPrompt: 'A close-up of the product.',
      narration: '',
      onScreenText: 'Designed for life.',
      mediaKind: 'image' as const,
      durationSeconds: 2,
    },
    {
      title: 'Payoff',
      purpose: 'Close with the benefit.',
      visualPrompt: 'A customer enjoying the product.',
      narration: 'Choose better every day.',
      onScreenText: 'Make it yours.',
      mediaKind: 'video' as const,
      durationSeconds: 2,
    },
  ],
};

const provider = (overrides: Partial<IProvider> = {}): IProvider => ({
  id: 'provider_1',
  platform: 'openai',
  name: 'Provider One',
  base_url: 'https://must-not-leak.example/v1',
  api_key: 'must-not-leak',
  models: ['gpt-4o'],
  ...overrides,
});

const completion = (content: string) => ({ choices: [{ message: { content } }] });

const client = (content = JSON.stringify(validOutput)): StudioStoryboardClient => ({
  createChatCompletion: vi.fn().mockResolvedValue(completion(content)),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const clientFrom = (promise: Promise<string>): StudioStoryboardClient => ({
  createChatCompletion: vi.fn(async () => completion(await promise)),
});

const dependencies = (overrides: Partial<StudioStoryboardPlannerDeps> = {}): StudioStoryboardPlannerDeps => ({
  listProviders: vi.fn().mockResolvedValue([provider()]),
  createClient: vi.fn().mockResolvedValue(client()),
  sleep: vi.fn().mockResolvedValue(undefined),
  now: () => 1_000,
  jitter: () => 0,
  emitAudit: vi.fn(),
  ...overrides,
});

const providerError = (status?: number, name = 'Error'): Error & { status?: number } =>
  Object.assign(new Error('raw provider response must-not-leak'), { name, status });

afterEach(() => {
  vi.useRealTimers();
});

describe('Studio storyboard planner model eligibility', () => {
  it('lists enabled text-capable models without exposing provider secrets', async () => {
    const planner = createStudioStoryboardPlanner(
      dependencies({
        listProviders: async () => [
          provider({
            models: ['gpt-4o', 'text-embedding-3-small', 'flux-1', 'custom-writer'],
            model_health: { 'gpt-4o': { status: 'healthy' } },
          }),
        ],
      })
    );

    expect(await planner.listModels()).toEqual([
      { providerId: 'provider_1', providerName: 'Provider One', model: 'gpt-4o', health: 'available' },
      { providerId: 'provider_1', providerName: 'Provider One', model: 'custom-writer', health: 'unknown' },
    ]);
  });

  it('normalizes provider discovery failures without exposing backend details', async () => {
    const planner = createStudioStoryboardPlanner(
      dependencies({
        listProviders: async () => {
          throw new Error('must-not-leak raw backend response');
        },
      })
    );

    await expect(planner.listModels()).rejects.toMatchObject({
      code: 'provider_request_failed',
      message: 'provider_request_failed',
    });
  });

  it.each([
    ['deleted', []],
    ['disabled provider', [provider({ enabled: false })]],
    ['missing credentials', [provider({ api_key: '  ' })]],
    ['missing model', [provider({ models: ['gpt-4.1'] })]],
    ['disabled model', [provider({ model_enabled: { 'gpt-4o': false } })]],
    ['unhealthy model', [provider({ model_health: { 'gpt-4o': { status: 'unhealthy' } } })]],
    ['image model', [provider({ models: ['flux-1'] })]],
    ['embedding model', [provider({ models: ['text-embedding-3-small'] })]],
    ['reranking model', [provider({ models: ['bge-reranker-v2'] })]],
  ])('rejects a %s selection after fresh provider discovery', async (_label, providers) => {
    const planner = createStudioStoryboardPlanner(dependencies({ listProviders: async () => providers }));

    await expect(
      planner.draft(input, {
        providerId: 'provider_1',
        model:
          providers[0]?.models[0] === 'flux-1'
            ? 'flux-1'
            : providers[0]?.models[0] === 'text-embedding-3-small'
              ? 'text-embedding-3-small'
              : providers[0]?.models[0] === 'bge-reranker-v2'
                ? 'bge-reranker-v2'
                : 'gpt-4o',
      })
    ).rejects.toMatchObject({ code: 'model_unavailable' });
  });
});

describe('Studio storyboard planner execution', () => {
  it('uses the exact selected provider and model with the bounded request contract', async () => {
    const createClient = vi.fn(async () => client());
    const planner = createStudioStoryboardPlanner(dependencies({ createClient }));

    await expect(planner.draft(input, selected)).resolves.toEqual(validOutput);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider_1', use_model: 'gpt-4o' }),
      expect.objectContaining({ rotatingOptions: { maxRetries: 1, retryDelay: 0 } })
    );
    const createdClient = await createClient.mock.results[0]?.value;
    expect(createdClient.createChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        max_tokens: 2_000,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    [401, 'provider_auth_failed'],
    [403, 'provider_auth_failed'],
    [429, 'provider_rate_limited'],
    [400, 'provider_request_failed'],
  ] as const)('normalizes status %s without leaking provider details', async (status, code) => {
    const request = vi.fn().mockRejectedValue(providerError(status));
    const planner = createStudioStoryboardPlanner(
      dependencies({ createClient: async () => ({ createChatCompletion: request }) })
    );

    await expect(planner.draft(input, selected)).rejects.toMatchObject({ code, message: code });
    expect(request).toHaveBeenCalledTimes(status === 429 ? 2 : 1);
  });

  it('retries a transient server failure once after bounded backoff', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(providerError(503))
      .mockResolvedValueOnce(completion(JSON.stringify(validOutput)));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const planner = createStudioStoryboardPlanner(
      dependencies({
        createClient: async () => ({ createChatCompletion: request }),
        jitter: () => 7,
        sleep,
      })
    );

    await expect(planner.draft(input, selected)).resolves.toEqual(validOutput);
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(507);
  });

  it('does not retry a non-transient network response', async () => {
    const request = vi.fn().mockRejectedValue(providerError(400));
    const planner = createStudioStoryboardPlanner(
      dependencies({ createClient: async () => ({ createChatCompletion: request }) })
    );

    await expect(planner.draft(input, selected)).rejects.toMatchObject({ code: 'provider_request_failed' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid output without a repair request', async () => {
    const request = vi.fn().mockResolvedValue(completion('raw provider response'));
    const planner = createStudioStoryboardPlanner(
      dependencies({ createClient: async () => ({ createChatCompletion: request }) })
    );

    await expect(planner.draft(input, selected)).rejects.toMatchObject({ code: 'invalid_output' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('Studio storyboard planner bounds', () => {
  it('shares an identical in-flight draft and rejects a third distinct draft as busy', async () => {
    const request = deferred<string>();
    const planner = createStudioStoryboardPlanner(
      dependencies({ createClient: async () => clientFrom(request.promise) })
    );

    const first = planner.draft(input, selected);
    const duplicate = planner.draft(input, selected);
    const second = planner.draft({ ...input, projectId: 'project_2' }, selected);
    expect(duplicate).toBe(first);
    await expect(planner.draft({ ...input, projectId: 'project_3' }, selected)).rejects.toMatchObject({
      code: 'busy',
    });

    request.resolve(JSON.stringify(validOutput));
    await expect(Promise.all([first, duplicate, second])).resolves.toHaveLength(3);
  });

  it('uses one 30-second deadline across retry and backoff', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValue(providerError(503));
    const sleep = vi.fn(() => new Promise<void>(() => undefined));
    const planner = createStudioStoryboardPlanner(
      dependencies({ createClient: async () => ({ createChatCompletion: request }), sleep })
    );

    const result = planner.draft(input, selected);
    const rejected = expect(result).rejects.toMatchObject({ code: 'provider_timeout' });
    await vi.advanceTimersByTimeAsync(30_000);

    await rejected;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('dispose aborts and awaits active operations and is idempotent', async () => {
    const never = deferred<string>();
    const planner = createStudioStoryboardPlanner(
      dependencies({ createClient: async () => clientFrom(never.promise) })
    );
    const first = planner.draft(input, selected);
    const second = planner.draft({ ...input, projectId: 'project_2' }, selected);

    const disposing = planner.dispose();
    await expect(Promise.allSettled([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ code: 'canceled' }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ code: 'canceled' }) }),
    ]);
    await expect(disposing).resolves.toBeUndefined();
    await expect(planner.dispose()).resolves.toBeUndefined();
  });

  it('emits only safe operational metadata', async () => {
    const emitAudit = vi.fn();
    const planner = createStudioStoryboardPlanner(dependencies({ emitAudit }));

    await planner.draft(input, selected);

    expect(JSON.stringify(emitAudit.mock.calls)).not.toMatch(
      /must-not-leak|UNTRUSTED_STUDIO_BRIEF|raw provider response|authorization/i
    );
    expect(emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'provider_1',
        model: 'gpt-4o',
        promptVersion: 'studio.storyboard-draft.v1',
        status: 'succeeded',
      })
    );
  });

  it('does not let a throwing audit sink reject a successful draft', async () => {
    const planner = createStudioStoryboardPlanner(
      dependencies({
        emitAudit: () => {
          throw new Error('audit sink unavailable');
        },
      })
    );

    await expect(planner.draft(input, selected)).resolves.toEqual(validOutput);
  });

  it('does not let a throwing audit sink replace a normalized planner error', async () => {
    const planner = createStudioStoryboardPlanner(
      dependencies({
        createClient: async () => ({
          createChatCompletion: vi.fn().mockRejectedValue(providerError(401)),
        }),
        emitAudit: () => {
          throw new Error('audit sink unavailable');
        },
      })
    );

    await expect(planner.draft(input, selected)).rejects.toMatchObject({
      code: 'provider_auth_failed',
      message: 'provider_auth_failed',
    });
  });
});
