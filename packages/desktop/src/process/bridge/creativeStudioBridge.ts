/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { httpRequest } from '@/common/adapter/httpBridge';
import { appOperationsModel } from '@/common/adapter/ipcBridge';
import type { IProvider } from '@/common/config/storage';
import type { StudioCommandErrorCode, StudioCommandResult } from '@/common/types/project/creativeStudioTypes';
import {
  createCreativeStudioService,
  CreativeStudioServiceError,
  type CreativeStudioService,
  type CreativeStudioServiceDeps,
} from '@process/services/creative-studio/creativeStudioService';
import { CreativeStudioStoreError, createCreativeStudioStore } from '@process/services/creative-studio/store';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import { createGenerationProviderAdapterRegistry } from '@process/services/creative-studio/adapters';
import { getCreativeStudioRootDir } from '@process/utils/initStorage';
import {
  createStudioMediaStore,
  CreativeStudioMediaError,
  getAvailableStudioDiskBytes,
} from '@process/services/creative-studio/mediaStore';
import { BrowserWindow, dialog } from 'electron';

const errorMessageKeys: Record<StudioCommandErrorCode, string> = {
  invalid_payload: 'creativeStudio.errors.invalidPayload',
  not_found: 'creativeStudio.errors.projectNotFound',
  storyboard_exists: 'creativeStudio.errors.storyboardExists',
  stale_project: 'creativeStudio.errors.staleProject',
  planning_unavailable: 'creativeStudio.errors.planningUnavailable',
  invalid_route: 'creativeStudio.errors.invalidRoute',
  cancellation_refused: 'creativeStudio.errors.cancellationRefused',
  busy: 'creativeStudio.errors.busy',
  provider_error: 'creativeStudio.errors.provider',
  storage_error: 'creativeStudio.errors.storage',
};

const toCommandError = (error: unknown): StudioCommandResult<never> => {
  const code: StudioCommandErrorCode =
    error instanceof CreativeStudioStoreError || error instanceof CreativeStudioServiceError
      ? error.code
      : error instanceof CreativeStudioMediaError
        ? error.code === 'not_found'
          ? 'not_found'
          : error.code === 'stale_project'
            ? 'stale_project'
            : error.code === 'invalid_media'
              ? 'invalid_payload'
              : 'storage_error'
        : 'storage_error';
  return { ok: false, error: { code, messageKey: errorMessageKeys[code] } };
};

const command = async <T>(operation: () => Promise<T>): Promise<StudioCommandResult<T>> => {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return toCommandError(error);
  }
};

/** Production dependency wiring. Storage is resolved only when the service is first invoked. */
export const buildCreativeStudioServiceDeps = (): CreativeStudioServiceDeps => {
  const store = createCreativeStudioStore({ rootDir: getCreativeStudioRootDir() });
  return {
    store,
    providerResolver: createStudioProviderResolver({
      listProviders: () => httpRequest<IProvider[]>('GET', '/api/providers'),
      getClientSettings: async () => (await httpRequest<Record<string, unknown>>('GET', '/api/settings/client')) ?? {},
      getPlanningReadiness: async () => {
        return appOperationsModel.get.invoke();
      },
      listConnections: () => store.listConnections(),
    }),
    listProviders: () => httpRequest<IProvider[]>('GET', '/api/providers'),
    adapterRegistry: createGenerationProviderAdapterRegistry({
      image: { workspaceDir: getCreativeStudioRootDir() },
    }),
    mediaStore: createStudioMediaStore({ store, getAvailableDiskBytes: getAvailableStudioDiskBytes }),
    onProjectUpdated: (projectId) => ipcBridge.creativeStudio.projectUpdated.emit({ projectId }),
  };
};

let service: CreativeStudioService | null = null;

const getCreativeStudioService = (): CreativeStudioService => {
  service ??= createCreativeStudioService(buildCreativeStudioServiceDeps());
  return service;
};

export type CreativeStudioBridgeDependencies = {
  getService: () => CreativeStudioService;
  getParentWindow?: () => BrowserWindow | undefined;
  showOpenDialog?: (window: BrowserWindow | undefined) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showExportDialog?: (window: BrowserWindow | undefined) => Promise<{ canceled: boolean; filePaths: string[] }>;
};

const defaultDependencies: CreativeStudioBridgeDependencies = {
  getService: getCreativeStudioService,
  getParentWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
  showOpenDialog: (window) =>
    dialog.showOpenDialog(window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    }),
  showExportDialog: (window) =>
    dialog.showOpenDialog(window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], {
      properties: ['openDirectory', 'createDirectory'],
    }),
};

/** Registers the typed Creative Studio IPC providers without eagerly creating storage. */
export function initCreativeStudioBridge(dependencies: CreativeStudioBridgeDependencies = defaultDependencies): void {
  ipcBridge.creativeStudio.listProjects.provider(() => command(() => dependencies.getService().listProjects()));
  ipcBridge.creativeStudio.createProject.provider((input) =>
    command(() => dependencies.getService().createProject(input))
  );
  ipcBridge.creativeStudio.getProject.provider((input) =>
    command(() => dependencies.getService().getProject(input.projectId))
  );
  ipcBridge.creativeStudio.proposeStoryboard.provider((input) =>
    command(() => dependencies.getService().proposeStoryboard(input))
  );
  ipcBridge.creativeStudio.updateProject.provider((input) =>
    command(() => dependencies.getService().updateProject(input))
  );
  ipcBridge.creativeStudio.deleteProject.provider((input) =>
    command(() => dependencies.getService().deleteProject(input))
  );
  ipcBridge.creativeStudio.updateScene.provider((input) => command(() => dependencies.getService().updateScene(input)));
  ipcBridge.creativeStudio.reorderScenes.provider((input) =>
    command(() => dependencies.getService().reorderScenes(input))
  );
  ipcBridge.creativeStudio.selectAsset.provider((input) => command(() => dependencies.getService().selectAsset(input)));
  ipcBridge.creativeStudio.chooseAndImportReference.provider(async (input) => {
    try {
      const parentWindow = (dependencies.getParentWindow ?? defaultDependencies.getParentWindow!)();
      const picked = await (dependencies.showOpenDialog ?? defaultDependencies.showOpenDialog!)(parentWindow);
      if (picked.canceled || !picked.filePaths[0]) return { ok: true, data: { status: 'cancelled' } };
      return {
        ok: true,
        data: {
          status: 'imported',
          asset: await dependencies.getService().importReferenceFromPath({ ...input, sourcePath: picked.filePaths[0] }),
        },
      };
    } catch (error) {
      return toCommandError(error);
    }
  });
  ipcBridge.creativeStudio.chooseAndExportAssets.provider(async (input) => {
    try {
      const parentWindow = (dependencies.getParentWindow ?? defaultDependencies.getParentWindow!)();
      const picked = await (dependencies.showExportDialog ?? defaultDependencies.showExportDialog!)(parentWindow);
      if (picked.canceled || !picked.filePaths[0]) return { ok: true, data: { status: 'cancelled' } };
      const result = await dependencies
        .getService()
        .exportAssetsToDirectory({ ...input, destinationDirectory: picked.filePaths[0] });
      return { ok: true, data: { status: 'exported', ...result } };
    } catch (error) {
      return toCommandError(error);
    }
  });
  ipcBridge.creativeStudio.listConnectionCandidates.provider(() =>
    command(() => dependencies.getService().listConnectionCandidates())
  );
  ipcBridge.creativeStudio.listConnections.provider(() => command(() => dependencies.getService().listConnections()));
  ipcBridge.creativeStudio.validateConnection.provider((input) =>
    command(() => dependencies.getService().validateConnection(input))
  );
  ipcBridge.creativeStudio.saveConnection.provider((input) =>
    command(() => dependencies.getService().saveConnection(input))
  );
  ipcBridge.creativeStudio.removeConnection.provider((input) =>
    command(() => dependencies.getService().removeConnection(input))
  );
  ipcBridge.creativeStudio.listRoutes.provider((input) => command(() => dependencies.getService().listRoutes(input)));
}
