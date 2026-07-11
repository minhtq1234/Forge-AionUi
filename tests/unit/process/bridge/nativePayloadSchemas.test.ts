/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { NATIVE_BRIDGE_PROVIDER_KEYS, type NativeBridgeProviderKey } from '@/common/adapter/native/constants';
import {
  INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE,
  nativeBridgePayloadSchemas,
  parseNativeBridgePayload,
} from '@/common/adapter/native/payloadSchemas';

const VALID_PAYLOADS = {
  'restart-app': undefined,
  'open-dev-tools': undefined,
  'is-dev-tools-opened': undefined,
  'app.get-path': { name: 'downloads' },
  'update-system-info': { cacheDir: '/tmp/cache', workDir: '/tmp/work', logDir: '/tmp/log' },
  'app.get-zoom-factor': undefined,
  'app.set-zoom-factor': { factor: 0.95 },
  'app.get-cdp-status': undefined,
  'app.update-cdp-config': { enabled: true, port: 9230 },
  'app.get-start-on-boot-status': undefined,
  'app.set-start-on-boot': { enabled: true },
  'app.get-gpu-status': undefined,
  'app.set-gpu-override': { override: 'force-on' },
  'app.write-renderer-log': { level: 'info', tag: 'settings', message: 'saved', data: { count: 1 } },
  'update.check': { includePrerelease: false, repo: 'iOfficeAI/AionUi' },
  'update.installer-last-failure.consume': undefined,
  'update.download': {
    downloadId: 'download-1',
    url: 'https://github.com/iOfficeAI/AionUi/releases/download/v1/app.dmg',
    fallbackUrl: 'https://cdn.example.com/app.dmg',
    file_name: 'app.dmg',
  },
  'update.download.cancel': { downloadId: 'download-1' },
  'auto-update.check': { includePrerelease: false },
  'auto-update.restore-downloaded': undefined,
  'auto-update.download': undefined,
  'auto-update.download.cancel': undefined,
  'auto-update.quit-and-install': undefined,
  'show-open': {
    defaultPath: '/tmp',
    properties: ['openDirectory', 'createDirectory'],
    filters: [{ name: 'Documents', extensions: ['pdf', 'docx'] }],
  },
  'window-controls:minimize': undefined,
  'window-controls:maximize': undefined,
  'window-controls:unmaximize': undefined,
  'window-controls:close': undefined,
  'window-controls:is-maximized': undefined,
  'theme:set-active': {
    id: 'forge-light',
    name: 'Forge Light',
    appearance: 'light',
    tokens: { '--color-bg-1': '#ffffff' },
    css: ':root { color-scheme: light; }',
    builtin: true,
    created_at: 1,
    updated_at: 1,
  },
  'theme:request-current': undefined,
  'system-settings:get-close-to-tray': undefined,
  'system-settings:set-close-to-tray': { enabled: true },
  'system-settings:get-pet-enabled': undefined,
  'system-settings:set-pet-enabled': { enabled: true },
  'system-settings:get-pet-size': undefined,
  'system-settings:set-pet-size': { size: 280 },
  'system-settings:get-pet-dnd': undefined,
  'system-settings:set-pet-dnd': { dnd: true },
  'system-settings:get-pet-confirm-enabled': undefined,
  'system-settings:set-pet-confirm-enabled': { enabled: true },
  'notification.show': {
    title: 'Task complete',
    body: 'The scheduled task finished.',
    conversation_id: 'conversation-1',
  },
  'webui.get-status': undefined,
  'webui.start': { port: 25808, allowRemote: false },
  'webui.stop': undefined,
} satisfies Record<NativeBridgeProviderKey, unknown>;

const VOID_PROVIDER_KEYS = [
  'restart-app',
  'open-dev-tools',
  'is-dev-tools-opened',
  'app.get-zoom-factor',
  'app.get-cdp-status',
  'app.get-start-on-boot-status',
  'app.get-gpu-status',
  'update.installer-last-failure.consume',
  'auto-update.restore-downloaded',
  'auto-update.download',
  'auto-update.download.cancel',
  'auto-update.quit-and-install',
  'window-controls:minimize',
  'window-controls:maximize',
  'window-controls:unmaximize',
  'window-controls:close',
  'window-controls:is-maximized',
  'theme:request-current',
  'system-settings:get-close-to-tray',
  'system-settings:get-pet-enabled',
  'system-settings:get-pet-size',
  'system-settings:get-pet-dnd',
  'system-settings:get-pet-confirm-enabled',
  'webui.get-status',
  'webui.stop',
] as const satisfies ReadonlyArray<NativeBridgeProviderKey>;

describe('native bridge payload schemas', () => {
  it('has exactly one schema for every manifested native provider', () => {
    expect(Object.keys(nativeBridgePayloadSchemas).sort()).toEqual([...NATIVE_BRIDGE_PROVIDER_KEYS].sort());
  });

  it.each(NATIVE_BRIDGE_PROVIDER_KEYS)('accepts the current payload shape for %s', (providerKey) => {
    expect(() => parseNativeBridgePayload(providerKey, VALID_PAYLOADS[providerKey])).not.toThrow();
  });

  it.each(VOID_PROVIDER_KEYS)('rejects a supplied payload for void provider %s', (providerKey) => {
    expect(() => parseNativeBridgePayload(providerKey, {})).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each(NATIVE_BRIDGE_PROVIDER_KEYS.filter((providerKey) => VALID_PAYLOADS[providerKey] !== undefined))(
    'rejects unknown top-level fields for %s',
    (providerKey) => {
      const payload = VALID_PAYLOADS[providerKey];
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`Missing object fixture for ${providerKey}`);
      }
      expect(() => parseNativeBridgePayload(providerKey, { ...payload, unexpected: true })).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  );

  it.each([
    ['app.set-zoom-factor', { factor: 0.7 }],
    ['app.update-cdp-config', { port: 65536 }],
    ['update.download', { url: 'not-a-url' }],
    ['system-settings:set-pet-size', { size: 281 }],
    ['webui.start', { port: 0 }],
    ['theme:set-active', { ...VALID_PAYLOADS['theme:set-active'], appearance: 'sepia' }],
    ['show-open', { filters: [{ name: 'Docs', extensions: ['pdf'], unexpected: true }] }],
  ] satisfies ReadonlyArray<readonly [NativeBridgeProviderKey, unknown]>)(
    'rejects bounded invalid payload for %s',
    (providerKey, payload) => {
      expect(() => parseNativeBridgePayload(providerKey, payload)).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
    }
  );

  it('allows the optional dialog payload to be omitted', () => {
    expect(parseNativeBridgePayload('show-open', undefined)).toBeUndefined();
  });

  it('does not expose payload values in validation errors', () => {
    const secret = 'secret-notification-value';
    let thrown: unknown;
    try {
      parseNativeBridgePayload('notification.show', { title: 'Notice', body: 'Body', token: secret });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new Error(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE));
    expect(String(thrown)).not.toContain(secret);
  });
});
