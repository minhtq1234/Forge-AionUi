/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const ADAPTER_BRIDGE_EVENT_KEY = 'office-ai-bridge-adapter';

/**
 * Electron-native providers reachable through the generic bridge adapter.
 * HTTP/WS-backed providers are intentionally absent because they never cross
 * the Electron IPC boundary.
 */
export const NATIVE_BRIDGE_PROVIDER_KEYS = [
  'restart-app',
  'open-dev-tools',
  'is-dev-tools-opened',
  'app.get-path',
  'update-system-info',
  'app.get-zoom-factor',
  'app.set-zoom-factor',
  'app.get-cdp-status',
  'app.update-cdp-config',
  'app.get-start-on-boot-status',
  'app.set-start-on-boot',
  'app.get-gpu-status',
  'app.set-gpu-override',
  'app.write-renderer-log',
  'update.check',
  'update.installer-last-failure.consume',
  'update.download',
  'update.download.cancel',
  'auto-update.check',
  'auto-update.restore-downloaded',
  'auto-update.download',
  'auto-update.download.cancel',
  'auto-update.quit-and-install',
  'show-open',
  'app-operations.context-compact',
  'app-operations.cancel',
  'project-knowledge.list-sources',
  'project-knowledge.add-sources',
  'project-knowledge.remove-source',
  'project-knowledge.retry-source',
  'project-knowledge.remove-store',
  'project-knowledge.get-session-mcp-server',
  'creative-studio.list-projects',
  'creative-studio.create-project',
  'creative-studio.get-project',
  'creative-studio.propose-storyboard',
  'creative-studio.update-project',
  'creative-studio.delete-project',
  'creative-studio.update-scene',
  'creative-studio.reorder-scenes',
  'creative-studio.select-asset',
  'office-artifact.get-state',
  'office-artifact.prepare-preview',
  'office-artifact.start-preview',
  'office-artifact.release-preview',
  'office-artifact.inspect',
  'office-artifact.apply',
  'office-artifact.undo',
  'window-controls:minimize',
  'window-controls:maximize',
  'window-controls:unmaximize',
  'window-controls:close',
  'window-controls:is-maximized',
  'theme:set-active',
  'theme:request-current',
  'system-settings:get-close-to-tray',
  'system-settings:set-close-to-tray',
  'system-settings:get-pet-enabled',
  'system-settings:set-pet-enabled',
  'system-settings:get-pet-size',
  'system-settings:set-pet-size',
  'system-settings:get-pet-dnd',
  'system-settings:set-pet-dnd',
  'system-settings:get-pet-confirm-enabled',
  'system-settings:set-pet-confirm-enabled',
  'notification.show',
  'webui.get-status',
  'webui.start',
  'webui.stop',
] as const;

export type NativeBridgeProviderKey = (typeof NATIVE_BRIDGE_PROVIDER_KEYS)[number];

const NATIVE_BRIDGE_PROVIDER_KEY_SET = new Set<string>(NATIVE_BRIDGE_PROVIDER_KEYS);
const NATIVE_BRIDGE_REQUEST_PREFIX = 'subscribe-';

export function getNativeBridgeProviderKey(name: string): NativeBridgeProviderKey | null {
  if (!name.startsWith(NATIVE_BRIDGE_REQUEST_PREFIX)) return null;
  const providerKey = name.slice(NATIVE_BRIDGE_REQUEST_PREFIX.length);
  return NATIVE_BRIDGE_PROVIDER_KEY_SET.has(providerKey) ? (providerKey as NativeBridgeProviderKey) : null;
}

export function isAllowedNativeBridgeRequestName(name: string): boolean {
  return getNativeBridgeProviderKey(name) !== null;
}

/**
 * File/Directory selection events
 * 用于 WebUI 模式下的文件选择请求
 */
export const SHOW_OPEN_REQUEST_EVENT = 'show-open-request';
