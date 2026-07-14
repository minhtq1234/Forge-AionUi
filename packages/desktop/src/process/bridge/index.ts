/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { initApplicationBridge } from './applicationBridge';
import { initDialogBridge } from './dialogBridge';
import { initUpdateBridge } from './updateBridge';
import { initSystemSettingsBridge } from './systemSettingsBridge';
import { initWindowControlsBridge } from './windowControlsBridge';
import { initNotificationBridge } from './notificationBridge';
import { initWebuiBridge } from './webuiBridge';
import { initThemeBridge } from './themeBridge';
import { ipcBridge } from '@/common';
import type { TLocalContextCompactionErrorCode } from '@/common/adapter/ipcBridge';
import { compactContextLocally } from '@process/services/contextCompactionService';

const CONTEXT_COMPACTION_ERROR_CODES = new Set<TLocalContextCompactionErrorCode>([
  'provider_not_found',
  'provider_timeout',
  'provider_auth_failed',
  'provider_rate_limited',
  'provider_request_failed',
  'invalid_model_output',
  'empty_model_output',
]);

const getContextCompactionErrorCode = (error: unknown): TLocalContextCompactionErrorCode => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const code = error.code as TLocalContextCompactionErrorCode;
    if (CONTEXT_COMPACTION_ERROR_CODES.has(code)) return code;
  }
  return 'provider_request_failed';
};

export function initContextCompactionBridge(): void {
  ipcBridge.localContextCompaction.generate.provider(async (input) => {
    try {
      return { ok: true, result: await compactContextLocally(input) };
    } catch (error) {
      return { ok: false, error_code: getContextCompactionErrorCode(error) };
    }
  });
}

export type BridgeDependencies = Record<string, never>;

export function initAllBridges(_deps: BridgeDependencies = {}): void {
  initDialogBridge();
  initApplicationBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
  initWebuiBridge();
  initThemeBridge();
  initContextCompactionBridge();
}

export {
  initApplicationBridge,
  initDialogBridge,
  initNotificationBridge,
  initSystemSettingsBridge,
  initThemeBridge,
  initUpdateBridge,
  initWindowControlsBridge,
  initWebuiBridge,
};
export { registerWindowMaximizeListeners } from './windowControlsBridge';
export const disposeAllTeamSessions = (): Promise<void> => Promise.resolve();
