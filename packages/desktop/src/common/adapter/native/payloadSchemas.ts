/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { NativeBridgeProviderKey } from './constants';

const MAX_PATH_LENGTH = 4096;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_SHORT_TEXT_LENGTH = 256;
const MAX_TEXT_LENGTH = 64 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_THEME_CONTENT_LENGTH = 15 * 1024 * 1024;
const MAX_THEME_TOKEN_COUNT = 1024;

const voidPayloadSchema = z.undefined();
const pathSchema = z.string().min(1).max(MAX_PATH_LENGTH);
const identifierSchema = z.string().min(1).max(MAX_IDENTIFIER_LENGTH);
const shortTextSchema = z.string().min(1).max(MAX_SHORT_TEXT_LENGTH);
const textSchema = z.string().max(MAX_TEXT_LENGTH);
const urlSchema = z.string().max(MAX_URL_LENGTH).url();
const portSchema = z.number().finite().int().min(1).max(65535);
const booleanSettingSchema = z.object({ enabled: z.boolean() }).strict();

const dialogPropertySchema = z.enum([
  'openFile',
  'openDirectory',
  'multiSelections',
  'showHiddenFiles',
  'createDirectory',
  'promptToCreate',
  'noResolveAliases',
  'treatPackageAsDirectory',
  'dontAddToRecent',
]);

const dialogFilterSchema = z
  .object({
    name: shortTextSchema,
    extensions: z.array(z.string().min(1).max(32)).max(64),
  })
  .strict();

const themeTokensSchema = z
  .record(z.string().min(1).max(128), z.string().max(4096))
  .refine((tokens) => Object.keys(tokens).length <= MAX_THEME_TOKEN_COUNT);

const themeSchema = z
  .object({
    id: identifierSchema,
    name: shortTextSchema,
    cover: z.string().max(MAX_THEME_CONTENT_LENGTH).optional(),
    appearance: z.enum(['light', 'dark']),
    tokens: themeTokensSchema.optional(),
    css: z.string().max(MAX_THEME_CONTENT_LENGTH).optional(),
    builtin: z.boolean(),
    created_at: z.number().finite().int().nonnegative(),
    updated_at: z.number().finite().int().nonnegative(),
  })
  .strict();

export const INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE = '[adapter] Native IPC request rejected: invalid operation payload';

export const nativeBridgePayloadSchemas = {
  'restart-app': voidPayloadSchema,
  'open-dev-tools': voidPayloadSchema,
  'is-dev-tools-opened': voidPayloadSchema,
  'app.get-path': z.object({ name: z.enum(['desktop', 'home', 'downloads']) }).strict(),
  'update-system-info': z.object({ cacheDir: pathSchema, workDir: pathSchema, logDir: pathSchema.optional() }).strict(),
  'app.get-zoom-factor': voidPayloadSchema,
  'app.set-zoom-factor': z.object({ factor: z.number().finite().min(0.8).max(1.3) }).strict(),
  'app.get-cdp-status': voidPayloadSchema,
  'app.update-cdp-config': z.object({ enabled: z.boolean().optional(), port: portSchema.optional() }).strict(),
  'app.get-start-on-boot-status': voidPayloadSchema,
  'app.set-start-on-boot': booleanSettingSchema,
  'app.get-gpu-status': voidPayloadSchema,
  'app.set-gpu-override': z.object({ override: z.enum(['force-on', 'force-off']).nullable() }).strict(),
  'app.write-renderer-log': z
    .object({
      level: z.enum(['debug', 'info', 'warn', 'error']),
      tag: z.string().min(1).max(128),
      message: textSchema,
      data: z.unknown().optional(),
    })
    .strict(),
  'update.check': z
    .object({
      includePrerelease: z.boolean().optional(),
      repo: z
        .string()
        .min(3)
        .max(200)
        .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
        .optional(),
    })
    .strict(),
  'update.installer-last-failure.consume': voidPayloadSchema,
  'update.download': z
    .object({
      downloadId: identifierSchema.optional(),
      url: urlSchema,
      fallbackUrl: urlSchema.optional(),
      file_name: z.string().min(1).max(255).optional(),
    })
    .strict(),
  'update.download.cancel': z.object({ downloadId: identifierSchema }).strict(),
  'auto-update.check': z.object({ includePrerelease: z.boolean().optional() }).strict(),
  'auto-update.restore-downloaded': voidPayloadSchema,
  'auto-update.download': voidPayloadSchema,
  'auto-update.download.cancel': voidPayloadSchema,
  'auto-update.quit-and-install': voidPayloadSchema,
  'show-open': z
    .object({
      defaultPath: pathSchema.optional(),
      properties: z.array(dialogPropertySchema).max(9).optional(),
      filters: z.array(dialogFilterSchema).max(32).optional(),
    })
    .strict()
    .optional(),
  'window-controls:minimize': voidPayloadSchema,
  'window-controls:maximize': voidPayloadSchema,
  'window-controls:unmaximize': voidPayloadSchema,
  'window-controls:close': voidPayloadSchema,
  'window-controls:is-maximized': voidPayloadSchema,
  'theme:set-active': themeSchema,
  'theme:request-current': voidPayloadSchema,
  'system-settings:get-close-to-tray': voidPayloadSchema,
  'system-settings:set-close-to-tray': booleanSettingSchema,
  'system-settings:get-pet-enabled': voidPayloadSchema,
  'system-settings:set-pet-enabled': booleanSettingSchema,
  'system-settings:get-pet-size': voidPayloadSchema,
  'system-settings:set-pet-size': z
    .object({ size: z.union([z.literal(200), z.literal(280), z.literal(360)]) })
    .strict(),
  'system-settings:get-pet-dnd': voidPayloadSchema,
  'system-settings:set-pet-dnd': z.object({ dnd: z.boolean() }).strict(),
  'system-settings:get-pet-confirm-enabled': voidPayloadSchema,
  'system-settings:set-pet-confirm-enabled': booleanSettingSchema,
  'notification.show': z
    .object({
      title: shortTextSchema,
      body: z.string().max(4096),
      icon: pathSchema.optional(),
      conversation_id: identifierSchema.optional(),
    })
    .strict(),
  'webui.get-status': voidPayloadSchema,
  'webui.start': z.object({ port: portSchema.optional(), allowRemote: z.boolean().optional() }).strict(),
  'webui.stop': voidPayloadSchema,
} satisfies Record<NativeBridgeProviderKey, z.ZodTypeAny>;

export function parseNativeBridgePayload(providerKey: NativeBridgeProviderKey, payload: unknown): unknown {
  const result = nativeBridgePayloadSchemas[providerKey].safeParse(payload);
  if (!result.success) {
    throw new Error(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  }
  return result.data;
}
