/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { StudioConnectionBinding } from '@/common/types/project/creativeStudioTypes';
import {
  createCreativeStudioRuntime,
  shouldEnableStudioE2EFakeAdapter,
  resumeCreativeStudioAfterBackendReady,
  type CreativeStudioRuntimeFactories,
} from '@process/services/creative-studio/runtime';
import type { CreativeStudioProtocolInstallation } from '@process/services/creative-studio/mediaProtocol';
import {
  createStudioE2EFakeBundle,
  STUDIO_E2E_FAKE_PROVIDER_ID,
  STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL,
  STUDIO_E2E_RAW_OUTPUT_PATH_SENTINEL,
} from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import type { GenerationProviderAdapterRegistry } from '@process/services/creative-studio/adapters';
import type { StudioJobManager } from '@process/services/creative-studio/jobManager';
import type { StudioMediaStore } from '@process/services/creative-studio/mediaStore';
import type { StudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import type { CreativeStudioService } from '@process/services/creative-studio/creativeStudioService';
import type { CreativeStudioStore } from '@process/services/creative-studio/store';
import type { StudioStoryboardPlanner } from '@process/services/creative-studio/planning/storyboardPlanner';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

const provider = (id = 'provider_1'): IProvider => ({
  id,
  platform: 'openai',
  name: 'Provider',
  base_url: 'https://provider.example.test/v1',
  api_key: 'secret',
  models: ['model_1'],
});

type RuntimeHarness = {
  runtime: ReturnType<typeof createCreativeStudioRuntime>;
  calls: string[];
  captures: {
    mediaStoreInput?: { store: CreativeStudioStore };
    resolverInput?: {
      listProviders: () => Promise<IProvider[]>;
      listConnections: () => Promise<StudioConnectionBinding[]>;
    };
    plannerInput?: {
      listProviders: () => Promise<IProvider[]>;
    };
    managerInput?: {
      store: CreativeStudioStore;
      mediaStore: StudioMediaStore;
      providerResolver: StudioProviderResolver;
      adapters: GenerationProviderAdapterRegistry;
      listProviders: () => Promise<IProvider[]>;
    };
    serviceInput?: {
      store: CreativeStudioStore;
      mediaStore: StudioMediaStore;
      providerResolver: StudioProviderResolver;
      adapterRegistry: GenerationProviderAdapterRegistry;
      jobManager: StudioJobManager;
      storyboardPlanner: StudioStoryboardPlanner;
    };
  };
  resumePendingJobs: ReturnType<typeof vi.fn<() => Promise<void>>>;
  disposeJobs: ReturnType<typeof vi.fn<() => Promise<void>>>;
  disposePlanner: ReturnType<typeof vi.fn<() => Promise<void>>>;
  uninstallProtocol: ReturnType<
    typeof vi.fn<(installation: CreativeStudioProtocolInstallation | null) => Promise<void>>
  >;
};

const createHarness = (
  environment: Record<string, string | undefined> = {},
  overrides: {
    resumePendingJobs?: () => Promise<void>;
    disposeJobs?: () => Promise<void>;
    disposePlanner?: () => Promise<void>;
    installProtocol?: (
      resolver: StudioMediaStore
    ) => Promise<CreativeStudioProtocolInstallation> | CreativeStudioProtocolInstallation;
    uninstallProtocol?: (installation: CreativeStudioProtocolInstallation | null) => Promise<void>;
    rootDir?: string;
    isPackaged?: boolean;
    createE2EFakeBundle?: CreativeStudioRuntimeFactories['createE2EFakeBundle'];
  } = {}
): RuntimeHarness => {
  const calls: string[] = [];
  const captures: RuntimeHarness['captures'] = {};
  const store = {
    listConnections: async () => [],
  } as unknown as CreativeStudioStore;
  const mediaStore = {
    cleanupOrphanParts: async () => {
      calls.push('cleanup-parts');
    },
  } as unknown as StudioMediaStore;
  const adapters = new Map() as GenerationProviderAdapterRegistry;
  const providerResolver = {} as StudioProviderResolver;
  const disposePlanner = vi.fn(overrides.disposePlanner ?? (async () => calls.push('dispose-planner')));
  const storyboardPlanner = {
    dispose: disposePlanner,
  } as unknown as StudioStoryboardPlanner;
  const resumePendingJobs = vi.fn(overrides.resumePendingJobs ?? (async () => calls.push('resume-jobs')));
  const disposeJobs = vi.fn(overrides.disposeJobs ?? (async () => calls.push('dispose-jobs')));
  const jobManager = {
    resumePendingJobs,
    dispose: disposeJobs,
  } as unknown as StudioJobManager;
  const service = {} as CreativeStudioService;
  const protocolInstallation: CreativeStudioProtocolInstallation = {
    dispose: vi.fn(async () => {}),
  };
  const uninstallProtocol = vi.fn(
    overrides.uninstallProtocol ??
      (async (installation: CreativeStudioProtocolInstallation | null) => {
        calls.push('uninstall-protocol');
        await installation?.dispose();
      })
  );

  const factories: CreativeStudioRuntimeFactories = {
    createStore: () => store,
    createMediaStore: (input) => {
      captures.mediaStoreInput = input;
      return mediaStore;
    },
    createAdapters: () => adapters,
    createPlanner: (input) => {
      captures.plannerInput = input;
      return storyboardPlanner;
    },
    createProviderResolver: (input) => {
      captures.resolverInput = input;
      return providerResolver;
    },
    createJobManager: (input) => {
      captures.managerInput = input;
      return jobManager;
    },
    createService: (input) => {
      captures.serviceInput = input;
      return service;
    },
    createE2EFakeBundle:
      overrides.createE2EFakeBundle ??
      (() => {
        throw new Error('fake bundle was not expected');
      }),
  };

  const runtime = createCreativeStudioRuntime({
    rootDir: overrides.rootDir ?? '/tmp/creative-studio-runtime-test',
    environment,
    isPackaged: overrides.isPackaged ?? false,
    factories,
    listProviders: async () => [provider()],
    onProjectUpdated: vi.fn(),
    protocol: {
      install:
        overrides.installProtocol ??
        ((resolver) => {
          expect(resolver).toBe(mediaStore);
          calls.push('install-protocol');
          return protocolInstallation;
        }),
      uninstall: uninstallProtocol,
    },
  });

  return { runtime, calls, captures, resumePendingJobs, disposeJobs, disposePlanner, uninstallProtocol };
};

describe('Creative Studio runtime identity and lifecycle', () => {
  it('assembles one shared store, media store, resolver, adapter registry, manager, and service graph', async () => {
    const { runtime, captures } = createHarness();

    expect(captures.mediaStoreInput?.store).toBe(runtime.store);
    expect(captures.managerInput).toMatchObject({
      store: runtime.store,
      mediaStore: runtime.mediaStore,
      providerResolver: runtime.providerResolver,
      adapters: runtime.adapterRegistry,
    });
    expect(captures.serviceInput).toMatchObject({
      store: runtime.store,
      mediaStore: runtime.mediaStore,
      providerResolver: runtime.providerResolver,
      adapterRegistry: runtime.adapterRegistry,
      jobManager: runtime.jobManager,
      storyboardPlanner: runtime.storyboardPlanner,
    });
    await expect(captures.managerInput?.listProviders()).resolves.toEqual([provider()]);
    await expect(captures.plannerInput?.listProviders()).resolves.toEqual([provider()]);
  });

  it('cleans stale parts before installing the protocol and starts only once', async () => {
    const { runtime, calls } = createHarness();

    await Promise.all([runtime.start(), runtime.start()]);

    expect(calls).toEqual(['cleanup-parts', 'install-protocol']);
  });

  it('shares normal and late backend-ready calls and resumes jobs exactly once', async () => {
    let releaseResume: (() => void) | undefined;
    let markResumeStarted: (() => void) | undefined;
    const resumeStarted = new Promise<void>((resolve) => {
      markResumeStarted = resolve;
    });
    const { runtime, calls, resumePendingJobs } = createHarness(
      {},
      {
        resumePendingJobs: () =>
          new Promise<void>((resolve) => {
            calls.push('resume-jobs-start');
            markResumeStarted?.();
            releaseResume = resolve;
          }),
      }
    );

    const normalReady = runtime.onBackendReady();
    const lateReady = runtime.onBackendReady();
    await resumeStarted;

    expect(calls).toEqual(['cleanup-parts', 'install-protocol', 'resume-jobs-start']);
    expect(resumePendingJobs).toHaveBeenCalledTimes(1);

    releaseResume?.();
    await Promise.all([normalReady, lateReady]);
    await runtime.onBackendReady();
    expect(resumePendingJobs).toHaveBeenCalledTimes(1);
  });

  it('disposes planner, jobs, and protocol references once even when cleanup rejects', async () => {
    const jobFailure = new Error('job-dispose-failed');
    const plannerFailure = new Error('planner-dispose-failed');
    const protocolFailure = new Error('protocol-uninstall-failed');
    const { runtime, disposeJobs, disposePlanner, uninstallProtocol } = createHarness(
      {},
      {
        disposeJobs: async () => {
          throw jobFailure;
        },
        disposePlanner: async () => {
          throw plannerFailure;
        },
        uninstallProtocol: async () => {
          throw protocolFailure;
        },
      }
    );

    await runtime.start();
    const first = runtime.dispose();
    const second = runtime.dispose();

    await expect(first).rejects.toBeInstanceOf(AggregateError);
    await expect(second).rejects.toBeInstanceOf(AggregateError);
    expect(disposeJobs).toHaveBeenCalledTimes(1);
    expect(disposePlanner).toHaveBeenCalledTimes(1);
    expect(uninstallProtocol).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight protocol install and removes the handler before disposal completes', async () => {
    let releaseInstall: (() => void) | undefined;
    const calls: string[] = [];
    const { runtime, uninstallProtocol } = createHarness(
      {},
      {
        installProtocol: () =>
          new Promise<CreativeStudioProtocolInstallation>((resolve) => {
            calls.push('install-protocol-start');
            releaseInstall = () => resolve({ dispose: async () => {} });
          }),
      }
    );

    const start = runtime.start();
    await Promise.resolve();
    await Promise.resolve();
    const dispose = runtime.dispose();
    await Promise.resolve();

    expect(uninstallProtocol).not.toHaveBeenCalled();
    releaseInstall?.();
    await Promise.all([start, dispose]);
    expect(uninstallProtocol).toHaveBeenCalledTimes(1);
  });

  it('passes the installed protocol controller to uninstall and awaits its disposal', async () => {
    const calls: string[] = [];
    const installation: CreativeStudioProtocolInstallation = {
      dispose: vi.fn(async () => {
        calls.push('dispose-protocol-controller');
      }),
    };
    const { runtime } = createHarness(
      {},
      {
        installProtocol: () => installation,
        uninstallProtocol: async (received) => {
          calls.push('unhandle-protocol');
          expect(received).toBe(installation);
          await received?.dispose();
        },
      }
    );

    await runtime.start();
    await runtime.dispose();

    expect(calls).toEqual(['unhandle-protocol', 'dispose-protocol-controller']);
  });

  it('does not finish disposal while backend-ready recovery is still in flight', async () => {
    let releaseRecovery: (() => void) | undefined;
    let markRecoveryStarted: (() => void) | undefined;
    const recoveryStarted = new Promise<void>((resolve) => {
      markRecoveryStarted = resolve;
    });
    const { runtime } = createHarness(
      {},
      {
        resumePendingJobs: () =>
          new Promise<void>((resolve) => {
            markRecoveryStarted?.();
            releaseRecovery = resolve;
          }),
      }
    );
    const backendReady = runtime.onBackendReady();
    await recoveryStarted;

    let disposalFinished = false;
    const disposal = runtime.dispose().then(() => {
      disposalFinished = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(disposalFinished).toBe(false);
    releaseRecovery?.();
    await Promise.all([backendReady, disposal]);
  });

  it('logs only a stable error name when backend-ready recovery rejects', async () => {
    const logError = vi.fn();

    resumeCreativeStudioAfterBackendReady(
      {
        onBackendReady: async () => {
          throw new Error('signed-url-or-provider-body-must-not-be-logged');
        },
      },
      logError
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(logError).toHaveBeenCalledWith('[CreativeStudio] Failed to resume pending jobs:', 'Error');
  });
});

describe('Creative Studio E2E fake gate', () => {
  it.each([
    [{}, false],
    [{ AIONUI_E2E_TEST: '1' }, false],
    [{ AIONUI_E2E_STUDIO_FAKE: '1' }, false],
    [{ AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' }, true],
  ] as const)('requires both explicit flags for %o', (environment, expected) => {
    expect(shouldEnableStudioE2EFakeAdapter(environment, { isPackaged: false })).toBe(expected);
  });

  it('cannot enable the fake adapter in a packaged production runtime', () => {
    expect(
      shouldEnableStudioE2EFakeAdapter({ AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' }, { isPackaged: true })
    ).toBe(false);
  });

  it.each([{ AIONUI_E2E_TEST: '1' }, { AIONUI_E2E_STUDIO_FAKE: '1' }] as const)(
    'does not install the fake bundle when only one gate flag is present: %o',
    async (environment) => {
      const { runtime, captures } = createHarness(environment);

      expect(runtime.adapterRegistry.size).toBe(0);
      await expect(captures.resolverInput?.listProviders()).resolves.toEqual([provider()]);
      await expect(captures.resolverInput?.listConnections()).resolves.toEqual([]);
    }
  );

  it('does not construct or expose the fake provider in a packaged runtime even with both flags', async () => {
    const { captures } = createHarness({ AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' }, { isPackaged: true });

    await expect(captures.resolverInput?.listProviders()).resolves.toEqual([provider()]);
    await expect(captures.resolverInput?.listConnections()).resolves.toEqual([]);
  });

  it('constructs the fake bundle only when both flags are present', async () => {
    const calls: string[] = [];
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-studio-runtime-'));
    temporaryDirectories.push(rootDir);
    const fakeBundle = createStudioE2EFakeBundle({ rootDir });
    const { captures } = createHarness(
      { AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' },
      {
        rootDir,
        createE2EFakeBundle: (input) => {
          calls.push(`fake:${input.rootDir}`);
          return fakeBundle;
        },
      }
    );

    const providers = await captures.resolverInput?.listProviders();
    const plannerProviders = await captures.plannerInput?.listProviders();
    const connections = await captures.resolverInput?.listConnections();

    expect(calls).toEqual([`fake:${rootDir}`]);
    expect(providers?.map((item) => item.id)).toEqual(['provider_1', STUDIO_E2E_FAKE_PROVIDER_ID]);
    expect(plannerProviders?.map((item) => item.id)).toEqual(['provider_1', STUDIO_E2E_FAKE_PROVIDER_ID]);
    expect(connections).toEqual(fakeBundle.connections);
  });
});

describe('Creative Studio E2E fake adapter', () => {
  it('reports queued and running before returning a tiny managed-output fixture', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-studio-fake-'));
    temporaryDirectories.push(rootDir);
    const bundle = createStudioE2EFakeBundle({ rootDir });
    const adapter = bundle.adapters.get('weprompt-media-gateway-v1');
    const fakeProvider = {
      ...bundle.provider,
      use_model: 'weprompt-e2e-video',
    } satisfies TProviderWithModel;
    const request = {
      prompt: 'A safe E2E video',
      mediaKind: 'video' as const,
      aspectRatio: '16:9' as const,
      resolution: '720p' as const,
      durationSeconds: 4,
      idempotencyKey: 'e2e_key_1',
    };

    const submitted = await adapter?.submit(request, fakeProvider, new AbortController().signal);
    expect(submitted?.kind).toBe('remote');
    if (!submitted || submitted.kind !== 'remote') throw new Error('expected remote fake task');

    await expect(adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal)).resolves.toEqual(
      {
        status: 'queued',
      }
    );
    await expect(adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal)).resolves.toEqual(
      {
        status: 'running',
        progress: 50,
      }
    );
    const completed = await adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal);
    expect(completed).toMatchObject({
      status: 'succeeded',
      outputs: [{ mediaKind: 'video', role: 'primary', mimeType: 'video/mp4' }],
    });
    if (!completed || completed.status !== 'succeeded') throw new Error('expected successful fake task');
    const output = completed.outputs[0];
    if (!output || output.source.kind !== 'file') throw new Error('expected file-backed fake output');
    await expect(stat(output.source.path)).resolves.toMatchObject({
      size: 24 + Buffer.byteLength(STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL),
    });
    const outputBytes = await readFile(output.source.path);
    expect(outputBytes.subarray(0, 24)).toEqual(Buffer.from('000000186674797069736f6d0000000069736f6d69736f32', 'hex'));
    expect(outputBytes.toString()).toContain(STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL);
  });

  it('confirms queued cancellation without creating an output fixture', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'weprompt-studio-fake-cancel-'));
    temporaryDirectories.push(rootDir);
    const bundle = createStudioE2EFakeBundle({ rootDir });
    const adapter = bundle.adapters.get('weprompt-media-gateway-v1');
    const fakeProvider = {
      ...bundle.provider,
      use_model: 'weprompt-e2e-video',
    } satisfies TProviderWithModel;
    const submitted = await adapter?.submit(
      {
        prompt: 'Cancel this E2E video',
        mediaKind: 'video',
        aspectRatio: '16:9',
        resolution: '720p',
        durationSeconds: 4,
        idempotencyKey: 'e2e_key_2',
      },
      fakeProvider,
      new AbortController().signal
    );
    if (!submitted || submitted.kind !== 'remote') throw new Error('expected remote fake task');

    await expect(
      adapter?.cancel?.(submitted.providerJobId, fakeProvider, new AbortController().signal)
    ).resolves.toEqual({
      kind: 'cancelled',
    });
    await expect(adapter?.poll?.(submitted.providerJobId, fakeProvider, new AbortController().signal)).resolves.toEqual(
      {
        status: 'cancelled',
        error: { code: 'unknown' },
      }
    );
    await expect(stat(path.join(rootDir, STUDIO_E2E_RAW_OUTPUT_PATH_SENTINEL))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
