/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioCommandErrorCode,
  StudioCommandResult,
  StudioUpdateModelSelectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import {
  CreativeStudioServiceError,
  type CreativeStudioService,
} from '@process/services/creative-studio/creativeStudioService';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { CreativeStudioMediaError } from '@process/services/creative-studio/mediaStore';
import { getCreativeStudioService } from '@process/services/creative-studio/runtime';
import { StudioJobManagerError } from '@process/services/creative-studio/jobManager';
import { BrowserWindow, dialog } from 'electron';

const errorMessageKeys: Record<StudioCommandErrorCode, string> = {
  invalid_payload: 'conversation.creativeStudio.errors.invalidPayload',
  not_found: 'conversation.creativeStudio.errors.projectNotFound',
  storyboard_exists: 'conversation.creativeStudio.errors.storyboardExists',
  stale_project: 'conversation.creativeStudio.errors.staleProject',
  planning_unavailable: 'conversation.creativeStudio.errors.planningUnavailable',
  invalid_route: 'conversation.creativeStudio.errors.invalidRoute',
  cancellation_refused: 'conversation.creativeStudio.errors.cancellationRefused',
  duplicate_charge_acknowledgement_required:
    'conversation.creativeStudio.errors.duplicateChargeAcknowledgementRequired',
  unsupported: 'conversation.creativeStudio.jobs.errors.unsupported',
  busy: 'conversation.creativeStudio.errors.busy',
  provider_error: 'conversation.creativeStudio.errors.provider',
  storage_error: 'conversation.creativeStudio.errors.storage',
};

const toCommandError = (error: unknown): StudioCommandResult<never> => {
  const code: StudioCommandErrorCode =
    error instanceof CreativeStudioStoreError || error instanceof CreativeStudioServiceError
      ? error.code
      : error instanceof StudioJobManagerError
        ? error.code === 'invalid_request'
          ? 'invalid_payload'
          : error.code
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
  ipcBridge.creativeStudio.updateModelSelection.provider((input: StudioUpdateModelSelectionRequest) =>
    command(() => dependencies.getService().updateModelSelection(input))
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
  ipcBridge.creativeStudio.submitScenes.provider((input) =>
    command(() => dependencies.getService().submitScenes(input))
  );
  ipcBridge.creativeStudio.cancelJob.provider((input) => command(() => dependencies.getService().cancelJob(input)));
  ipcBridge.creativeStudio.retryJob.provider((input) => command(() => dependencies.getService().retryJob(input)));
  ipcBridge.creativeStudio.retryDownload.provider((input) =>
    command(() => dependencies.getService().retryDownload(input))
  );
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
