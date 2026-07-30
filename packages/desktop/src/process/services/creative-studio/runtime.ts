/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { httpRequest } from '@/common/adapter/httpBridge';
import { appOperationsModel } from '@/common/adapter/ipcBridge';
import type { IProvider } from '@/common/config/storage';
import { app, protocol } from 'electron';
import {
  createCreativeStudioService,
  type CreativeStudioService,
  type CreativeStudioServiceDeps,
} from './creativeStudioService';
import { createCreativeStudioStore, type CreativeStudioStore } from './store';
import { createStudioMediaStore, getAvailableStudioDiskBytes, type StudioMediaStore } from './mediaStore';
import {
  createStudioProviderResolver,
  type StudioProviderResolver,
  type StudioProviderResolverDeps,
} from './providerResolver';
import { createGenerationProviderAdapterRegistry, type GenerationProviderAdapterRegistry } from './adapters';
import {
  createStudioE2EFakeBundle,
  type StudioE2EFakeBundle,
  type StudioE2EFakeBundleDeps,
} from './adapters/e2eFakeAdapter';
import { createStudioJobManager, type StudioJobManager } from './jobManager';
import { installCreativeStudioProtocol, type CreativeStudioProtocolInstallation } from './mediaProtocol';
import { getCreativeStudioRootDir } from '@process/utils/initStorage';

type RuntimeEnvironment = {
  AIONUI_E2E_TEST?: string;
  AIONUI_E2E_STUDIO_FAKE?: string;
};

export type CreativeStudioRuntimeProtocol = {
  install(resolver: StudioMediaStore): Promise<CreativeStudioProtocolInstallation> | CreativeStudioProtocolInstallation;
  uninstall(installation: CreativeStudioProtocolInstallation | null): Promise<void> | void;
};

type RuntimeServiceDeps = CreativeStudioServiceDeps & {
  jobManager: StudioJobManager;
};

export type CreativeStudioRuntimeFactories = {
  createStore(input: { rootDir: string }): CreativeStudioStore;
  createMediaStore(input: { store: CreativeStudioStore }): StudioMediaStore;
  createAdapters(input: { rootDir: string }): GenerationProviderAdapterRegistry;
  createProviderResolver(input: StudioProviderResolverDeps): StudioProviderResolver;
  createJobManager(input: Parameters<typeof createStudioJobManager>[0]): StudioJobManager;
  createService(input: RuntimeServiceDeps): CreativeStudioService;
  createE2EFakeBundle(input: StudioE2EFakeBundleDeps): StudioE2EFakeBundle;
};

export type CreativeStudioRuntimeDeps = {
  rootDir: string;
  environment?: RuntimeEnvironment;
  isPackaged: boolean;
  factories?: CreativeStudioRuntimeFactories;
  listProviders(): Promise<IProvider[]>;
  getClientSettings(): Promise<Record<string, unknown>>;
  getPlanningReadiness: StudioProviderResolverDeps['getPlanningReadiness'];
  onProjectUpdated(projectId: string): void;
  protocol: CreativeStudioRuntimeProtocol;
};

export type CreativeStudioRuntime = {
  readonly store: CreativeStudioStore;
  readonly mediaStore: StudioMediaStore;
  readonly adapterRegistry: GenerationProviderAdapterRegistry;
  readonly providerResolver: StudioProviderResolver;
  readonly jobManager: StudioJobManager;
  readonly service: CreativeStudioService;
  start(): Promise<void>;
  onBackendReady(): Promise<void>;
  dispose(): Promise<void>;
};

const defaultFactories: CreativeStudioRuntimeFactories = {
  createStore: ({ rootDir }) => createCreativeStudioStore({ rootDir }),
  createMediaStore: ({ store }) =>
    createStudioMediaStore({
      store,
      getAvailableDiskBytes: getAvailableStudioDiskBytes,
    }),
  createAdapters: ({ rootDir }) =>
    createGenerationProviderAdapterRegistry({
      image: { workspaceDir: rootDir },
    }),
  createProviderResolver: createStudioProviderResolver,
  createJobManager: createStudioJobManager,
  createService: createCreativeStudioService,
  createE2EFakeBundle: createStudioE2EFakeBundle,
};

/** E2E generation is never enabled by a broad test mode or Studio flag alone. */
export const shouldEnableStudioE2EFakeAdapter = (
  environment: RuntimeEnvironment,
  runtime: { isPackaged: boolean }
): boolean => !runtime.isPackaged && environment.AIONUI_E2E_TEST === '1' && environment.AIONUI_E2E_STUDIO_FAKE === '1';

const mergeProviders = (
  listProviders: () => Promise<IProvider[]>,
  fakeBundle: StudioE2EFakeBundle | null
): (() => Promise<IProvider[]>) => {
  if (!fakeBundle) return listProviders;
  return async () => [
    ...(await listProviders()).filter((provider) => provider.id !== fakeBundle.provider.id),
    fakeBundle.provider,
  ];
};

/** Builds an isolated main-process runtime graph; callers supply every external boundary. */
export const createCreativeStudioRuntime = (deps: CreativeStudioRuntimeDeps): CreativeStudioRuntime => {
  const factories = deps.factories ?? defaultFactories;
  const fakeBundle = shouldEnableStudioE2EFakeAdapter(deps.environment ?? process.env, {
    isPackaged: deps.isPackaged,
  })
    ? factories.createE2EFakeBundle({ rootDir: deps.rootDir })
    : null;
  const store = factories.createStore({ rootDir: deps.rootDir });
  const mediaStore = factories.createMediaStore({ store });
  const baseAdapters = factories.createAdapters({ rootDir: deps.rootDir });
  const adapterRegistry: GenerationProviderAdapterRegistry = fakeBundle
    ? new Map([...baseAdapters, ...fakeBundle.adapters])
    : baseAdapters;
  const listProviders = mergeProviders(deps.listProviders, fakeBundle);
  const listConnections = async () => {
    const persisted = await store.listConnections();
    if (!fakeBundle) return persisted;
    const fakeIds = new Set(fakeBundle.connections.map((connection) => connection.id));
    return [...persisted.filter((connection) => !fakeIds.has(connection.id)), ...fakeBundle.connections];
  };
  const providerResolver = factories.createProviderResolver({
    listProviders,
    getClientSettings: deps.getClientSettings,
    getPlanningReadiness: deps.getPlanningReadiness,
    listConnections,
  });
  const jobManager = factories.createJobManager({
    store,
    mediaStore,
    providerResolver,
    adapters: adapterRegistry,
    listProviders,
    onProjectUpdated: deps.onProjectUpdated,
  });
  const service = factories.createService({
    store,
    mediaStore,
    providerResolver,
    adapterRegistry,
    listProviders,
    jobManager,
    onProjectUpdated: deps.onProjectUpdated,
  });

  let startPromise: Promise<void> | null = null;
  let backendReadyPromise: Promise<void> | null = null;
  let disposePromise: Promise<void> | null = null;
  let protocolInstallAttempted = false;
  let protocolInstalled = false;
  let protocolInstallation: CreativeStudioProtocolInstallation | null = null;
  let disposed = false;

  const start = (): Promise<void> => {
    startPromise ??= (async () => {
      if (disposed) return;
      await mediaStore.cleanupOrphanParts();
      if (disposed) return;
      protocolInstallAttempted = true;
      protocolInstallation = await deps.protocol.install(mediaStore);
      protocolInstalled = true;
    })();
    return startPromise;
  };

  const onBackendReady = (): Promise<void> => {
    backendReadyPromise ??= (async () => {
      await start();
      if (!disposed) await jobManager.resumePendingJobs();
    })();
    return backendReadyPromise;
  };

  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      disposed = true;
      const errors: unknown[] = [];
      try {
        await jobManager.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (backendReadyPromise) {
        try {
          await backendReadyPromise;
        } catch (error) {
          errors.push(error);
        }
      }
      if (startPromise) {
        try {
          await startPromise;
        } catch (error) {
          errors.push(error);
        }
      }
      if (protocolInstallAttempted || protocolInstalled) {
        try {
          await deps.protocol.uninstall(protocolInstallation);
        } catch (error) {
          errors.push(error);
        }
      }
      if (fakeBundle) {
        try {
          await fakeBundle.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Creative Studio runtime disposal failed');
      }
    })();
    return disposePromise;
  };

  return {
    store,
    mediaStore,
    adapterRegistry,
    providerResolver,
    jobManager,
    service,
    start,
    onBackendReady,
    dispose,
  };
};

type BackendReadyStudioRuntime = Pick<CreativeStudioRuntime, 'onBackendReady'>;

/** Starts the shared recovery promise without leaking provider details into startup logs. */
export const resumeCreativeStudioAfterBackendReady = (
  runtime: BackendReadyStudioRuntime,
  logError: (message: string, errorName: string) => void = console.error
): void => {
  void runtime
    .onBackendReady()
    .catch((error: unknown) =>
      logError('[CreativeStudio] Failed to resume pending jobs:', error instanceof Error ? error.name : 'UnknownError')
    );
};

let productionRuntime: CreativeStudioRuntime | null = null;

/** The only production runtime constructor; every caller receives this exact object graph. */
export const getCreativeStudioRuntime = (): CreativeStudioRuntime => {
  productionRuntime ??= createCreativeStudioRuntime({
    rootDir: getCreativeStudioRootDir(),
    environment: process.env,
    isPackaged: app.isPackaged,
    listProviders: () => httpRequest<IProvider[]>('GET', '/api/providers'),
    getClientSettings: async () => (await httpRequest<Record<string, unknown>>('GET', '/api/settings/client')) ?? {},
    getPlanningReadiness: () => appOperationsModel.get.invoke(),
    onProjectUpdated: (projectId) => ipcBridge.creativeStudio.projectUpdated.emit({ projectId }),
    protocol: {
      install: (resolver) => installCreativeStudioProtocol(protocol, resolver),
      uninstall: async (installation) => {
        try {
          protocol.unhandle('weprompt-studio');
        } finally {
          await installation?.dispose();
        }
      },
    },
  });
  return productionRuntime;
};

export const getCreativeStudioService = (): CreativeStudioService => getCreativeStudioRuntime().service;

/** Does not instantiate Studio during a quit path that never started it. */
export const disposeCreativeStudioRuntime = async (): Promise<void> => {
  await productionRuntime?.dispose();
};
