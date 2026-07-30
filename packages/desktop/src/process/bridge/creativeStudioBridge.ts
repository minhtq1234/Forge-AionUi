/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { StudioCommandErrorCode, StudioCommandResult } from '@/common/types/project/creativeStudioTypes';
import {
  createCreativeStudioService,
  CreativeStudioServiceError,
  type CreativeStudioService,
  type CreativeStudioServiceDeps,
} from '@process/services/creative-studio/creativeStudioService';
import { CreativeStudioStoreError, createCreativeStudioStore } from '@process/services/creative-studio/store';
import { getCreativeStudioRootDir } from '@process/utils/initStorage';

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
export const buildCreativeStudioServiceDeps = (): CreativeStudioServiceDeps => ({
  store: createCreativeStudioStore({ rootDir: getCreativeStudioRootDir() }),
  onProjectUpdated: (projectId) => ipcBridge.creativeStudio.projectUpdated.emit({ projectId }),
});

let service: CreativeStudioService | null = null;

const getCreativeStudioService = (): CreativeStudioService => {
  service ??= createCreativeStudioService(buildCreativeStudioServiceDeps());
  return service;
};

export type CreativeStudioBridgeDependencies = {
  getService: () => CreativeStudioService;
};

const defaultDependencies: CreativeStudioBridgeDependencies = {
  getService: getCreativeStudioService,
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
}
