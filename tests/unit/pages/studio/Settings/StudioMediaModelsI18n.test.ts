/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LOCALE_ROOT = new URL('../../../../../packages/desktop/src/renderer/services/i18n/locales/', import.meta.url);
const CONFIG_URL = new URL('../../../../../packages/desktop/src/common/config/i18n-config.json', import.meta.url);

const MEDIA_MODEL_KEYS = [
  'title',
  'description',
  'add',
  'empty',
  'loadFailed',
  'refresh',
  'addProvider',
  'outputType',
  'image',
  'video',
  'provider',
  'integrationLabel',
  'model',
  'modelPlaceholder',
  'validated',
  'validatedAt',
  'unavailable',
  'addTitle',
  'editTitle',
  'edit',
  'revalidate',
  'remove',
  'removeConfirm',
  'validate',
  'validating',
  'validationSuccess',
  'validationFailed',
  'save',
  'cancel',
  'silentOutputSupported',
  'integration.imageApi',
  'integration.bytePlusSeedance',
  'integration.selfHostedVideoGateway',
] as const;

type LocaleConfig = {
  referenceLanguage: string;
  supportedLanguages: string[];
};

type SettingsLocale = {
  modelDescription?: string;
  mediaModels?: Record<string, unknown>;
};

const readJson = <T>(url: URL): T => JSON.parse(readFileSync(url, 'utf8')) as T;
const config = readJson<LocaleConfig>(CONFIG_URL);

const resolveLeaf = (root: Record<string, unknown> | undefined, path: string): unknown =>
  path.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[part];
  }, root);

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)].map((match) => match[1]).sort();

describe('Creative Studio media model settings copy', () => {
  it('defines every media model leaf with matching placeholders in every locale', () => {
    const reference = readJson<SettingsLocale>(new URL(`${config.referenceLanguage}/settings.json`, LOCALE_ROOT));

    for (const language of config.supportedLanguages) {
      const locale = readJson<SettingsLocale>(new URL(`${language}/settings.json`, LOCALE_ROOT));

      for (const key of MEDIA_MODEL_KEYS) {
        const value = resolveLeaf(locale.mediaModels, key);
        const referenceValue = resolveLeaf(reference.mediaModels, key);

        expect(value, `${language}: settings.mediaModels.${key}`).toEqual(expect.any(String));
        expect((value as string).trim(), `${language}: settings.mediaModels.${key}`).not.toBe('');
        expect(placeholders(value as string), `${language}: settings.mediaModels.${key}`).toEqual(
          placeholders(referenceValue as string)
        );
      }
    }
  });

  it('keeps friendly integration labels distinct from private adapter IDs', () => {
    const settings = readJson<SettingsLocale>(new URL('en-US/settings.json', LOCALE_ROOT));
    const adapterIds = ['weprompt-image-v1', 'byteplus-seedance-v1', 'weprompt-media-gateway-v1'];

    for (const key of ['integration.imageApi', 'integration.bytePlusSeedance', 'integration.selfHostedVideoGateway']) {
      expect(adapterIds).not.toContain(resolveLeaf(settings.mediaModels, key));
    }
  });

  it('describes text, image, and video model configuration at page level', () => {
    const settings = readJson<SettingsLocale>(new URL('en-US/settings.json', LOCALE_ROOT));

    expect(settings.modelDescription).toMatch(/\btext\b/i);
    expect(settings.modelDescription).toMatch(/\bimage\b/i);
    expect(settings.modelDescription).toMatch(/\bvideo\b/i);
  });
});
