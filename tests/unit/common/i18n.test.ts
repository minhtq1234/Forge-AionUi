/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createInstance } from 'i18next';
import { normalizeLanguageCode, DEFAULT_LANGUAGE } from '@/common/config/i18n';
import i18nConfig from '@/common/config/i18n-config.json';
import deDEMessages from '@renderer/services/i18n/locales/de-DE/messages.json';
import enUSMessages from '@renderer/services/i18n/locales/en-US/messages.json';
import esESMessages from '@renderer/services/i18n/locales/es-ES/messages.json';
import faIRMessages from '@renderer/services/i18n/locales/fa-IR/messages.json';
import jaJPMessages from '@renderer/services/i18n/locales/ja-JP/messages.json';
import koKRMessages from '@renderer/services/i18n/locales/ko-KR/messages.json';
import ptBRMessages from '@renderer/services/i18n/locales/pt-BR/messages.json';
import ruRUMessages from '@renderer/services/i18n/locales/ru-RU/messages.json';
import trTRMessages from '@renderer/services/i18n/locales/tr-TR/messages.json';
import ukUAMessages from '@renderer/services/i18n/locales/uk-UA/messages.json';
import zhCNMessages from '@renderer/services/i18n/locales/zh-CN/messages.json';
import zhTWMessages from '@renderer/services/i18n/locales/zh-TW/messages.json';

const MESSAGE_LOCALES = {
  'de-DE': deDEMessages,
  'en-US': enUSMessages,
  'es-ES': esESMessages,
  'fa-IR': faIRMessages,
  'ja-JP': jaJPMessages,
  'ko-KR': koKRMessages,
  'pt-BR': ptBRMessages,
  'ru-RU': ruRUMessages,
  'tr-TR': trTRMessages,
  'uk-UA': ukUAMessages,
  'zh-CN': zhCNMessages,
  'zh-TW': zhTWMessages,
} satisfies Record<string, { toolActivity: unknown }>;

const flattenStringLeaves = (value: unknown, prefix = ''): Record<string, string> => {
  if (typeof value === 'string') {
    return { [prefix]: value };
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected an object or string at ${prefix || '<root>'}`);
  }

  const leaves: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPrefix = prefix ? `${prefix}.${key}` : key;
    Object.assign(leaves, flattenStringLeaves(child, childPrefix));
  }
  return leaves;
};

const getPlaceholders = (value: string): string[] => value.match(/{{[^{}]+}}/g) ?? [];
const NUMERIC_RECAP_PLACEHOLDERS = new Set([
  'total',
  'count',
  'completed',
  'failed',
  'pending',
  'canceled',
  'unfinished',
  'retries',
]);
const RECAP_OUTCOME_PLACEHOLDERS = {
  active: ['completed', 'pending', 'total'],
  activeWithFailure: ['completed', 'failed', 'pending', 'total'],
  activeWithCanceled: ['canceled', 'completed', 'pending', 'total'],
  activeWithFailureAndCanceled: ['canceled', 'completed', 'failed', 'pending', 'total'],
  completed: [],
  recovered: [],
  partial: ['completed', 'failed', 'total'],
  partialWithCanceled: ['canceled', 'completed', 'failed', 'total'],
  failed: ['failed', 'total'],
  failedWithCanceled: ['canceled', 'failed', 'total'],
  canceled: ['canceled', 'total', 'unfinished'],
} as const;

const findCopiedReferenceLeaves = (
  referenceLeaves: Record<string, string>,
  localeLeaves: Record<string, string>
): string[] =>
  Object.entries(referenceLeaves)
    .filter(([key, referenceValue]) => localeLeaves[key] === referenceValue)
    .map(([key]) => key);

describe('i18n', () => {
  describe('normalizeLanguageCode', () => {
    it('passes through exact supported tags', () => {
      expect(normalizeLanguageCode('en-US')).toBe('en-US');
      expect(normalizeLanguageCode('zh-CN')).toBe('zh-CN');
      expect(normalizeLanguageCode('de-DE')).toBe('de-DE');
      expect(normalizeLanguageCode('fa-IR')).toBe('fa-IR');
    });

    it('normalizes underscores to hyphens', () => {
      expect(normalizeLanguageCode('de_DE')).toBe('de-DE');
      expect(normalizeLanguageCode('fa_IR')).toBe('fa-IR');
      expect(normalizeLanguageCode('pt_BR')).toBe('pt-BR');
    });

    it('resolves base language codes to their supported region', () => {
      expect(normalizeLanguageCode('zh')).toBe('zh-CN');
      expect(normalizeLanguageCode('ja')).toBe('ja-JP');
      expect(normalizeLanguageCode('ko')).toBe('ko-KR');
      expect(normalizeLanguageCode('tr')).toBe('tr-TR');
      expect(normalizeLanguageCode('ru')).toBe('ru-RU');
      expect(normalizeLanguageCode('uk')).toBe('uk-UA');
      expect(normalizeLanguageCode('pt')).toBe('pt-BR');
      expect(normalizeLanguageCode('de')).toBe('de-DE');
      expect(normalizeLanguageCode('es')).toBe('es-ES');
      expect(normalizeLanguageCode('fa')).toBe('fa-IR');
    });

    it('resolves German regional variants to de-DE', () => {
      expect(normalizeLanguageCode('de-AT')).toBe('de-DE');
      expect(normalizeLanguageCode('de-CH')).toBe('de-DE');
    });

    it('falls back to the default language for unsupported codes', () => {
      expect(normalizeLanguageCode('fr')).toBe(DEFAULT_LANGUAGE);
      expect(normalizeLanguageCode('it')).toBe(DEFAULT_LANGUAGE);
      expect(normalizeLanguageCode('')).toBe(DEFAULT_LANGUAGE);
    });
  });

  describe('messages.toolActivity locale parity', () => {
    it('detects a leaf copied verbatim from en-US', () => {
      const referenceLeaves = {
        'generic.running': "I'm working through the next step.",
        'status.stopped': 'Stopped',
      };
      const localeLeaves = {
        'generic.running': "I'm working through the next step.",
        'status.stopped': 'Gestoppt',
      };

      expect(findCopiedReferenceLeaves(referenceLeaves, localeLeaves)).toEqual(['generic.running']);
    });

    it('keeps every configured locale complete, translated, and placeholder-compatible', () => {
      const issues: string[] = [];
      const configuredLocales = i18nConfig.supportedLanguages.toSorted();
      const importedLocales = Object.keys(MESSAGE_LOCALES).toSorted();
      const referenceLeaves = flattenStringLeaves(enUSMessages.toolActivity);
      const referenceKeys = Object.keys(referenceLeaves).toSorted();

      if (configuredLocales.join('\n') !== importedLocales.join('\n')) {
        issues.push(`Configured locales do not match imported message locales: ${importedLocales.join(', ')}`);
      }

      for (const locale of configuredLocales) {
        const messages = MESSAGE_LOCALES[locale as keyof typeof MESSAGE_LOCALES];
        if (!messages) {
          continue;
        }

        const localeLeaves = flattenStringLeaves(messages.toolActivity);
        const localeKeys = Object.keys(localeLeaves).toSorted();
        const missingKeys = referenceKeys.filter((key) => !(key in localeLeaves));
        const extraKeys = localeKeys.filter((key) => !(key in referenceLeaves));

        if (missingKeys.length > 0) {
          issues.push(`${locale} is missing: ${missingKeys.join(', ')}`);
        }
        if (extraKeys.length > 0) {
          issues.push(`${locale} has extra keys: ${extraKeys.join(', ')}`);
        }
        if (locale !== i18nConfig.referenceLanguage) {
          const copiedReferenceKeys = findCopiedReferenceLeaves(referenceLeaves, localeLeaves);
          if (copiedReferenceKeys.length > 0) {
            issues.push(`${locale} matches en-US: ${copiedReferenceKeys.join(', ')}`);
          }
        }

        for (const key of referenceKeys) {
          const localeValue = localeLeaves[key];
          if (localeValue === undefined) {
            continue;
          }
          if (localeValue.trim().length === 0) {
            issues.push(`${locale}.${key} is empty`);
          }

          const expectedPlaceholders = getPlaceholders(referenceLeaves[key]);
          const actualPlaceholders = getPlaceholders(localeValue);
          if (expectedPlaceholders.join('\n') !== actualPlaceholders.join('\n')) {
            issues.push(
              `${locale}.${key} placeholders ${actualPlaceholders.join(', ')} do not match ${expectedPlaceholders.join(', ')}`
            );
          }
        }
      }

      expect(issues).toEqual([]);
    });

    it('formats every visible recap number and keeps exact outcome counts without obsolete connectors', () => {
      const issues: string[] = [];

      for (const [locale, messages] of Object.entries(MESSAGE_LOCALES)) {
        if ('connector' in messages.toolActivity.recap) {
          issues.push(`${locale}.toolActivity.recap.connector is obsolete`);
        }

        const recapLeaves = flattenStringLeaves(messages.toolActivity, 'toolActivity');
        for (const [key, value] of Object.entries(recapLeaves)) {
          if (!key.startsWith('toolActivity.recap.')) continue;
          for (const placeholder of getPlaceholders(value)) {
            const match = placeholder.match(/^{{(\w+)(?:,\s*(\w+))?}}$/);
            const name = match?.[1];
            if (name && NUMERIC_RECAP_PLACEHOLDERS.has(name) && match?.[2] !== 'number') {
              issues.push(`${locale}.${key} does not number-format ${name}`);
            }
          }
        }

        for (const [key, expectedNames] of Object.entries(RECAP_OUTCOME_PLACEHOLDERS)) {
          const outcome = messages.toolActivity.recap.outcome[key];
          const actualNames = getPlaceholders(outcome)
            .map((placeholder) => placeholder.match(/^{{(\w+)/)?.[1])
            .filter((name): name is string => Boolean(name))
            .toSorted();
          if (actualNames.join('\n') !== expectedNames.join('\n')) {
            issues.push(
              `${locale}.toolActivity.recap.outcome.${key} placeholders ${actualNames.join(', ')} do not match ${expectedNames.join(', ')}`
            );
          }
        }
      }

      expect(issues).toEqual([]);
    });

    it('renders localized category and outcome counts through i18next in all locales', async () => {
      await Promise.all(
        Object.entries(MESSAGE_LOCALES).map(async ([locale, messages]) => {
          const instance = createInstance();
          await instance.init({
            lng: locale,
            fallbackLng: false,
            resources: { [locale]: { translation: { messages } } },
            interpolation: { escapeValue: false },
          });

          const values = {
            canceled: 12,
            completed: 1234,
            failed: 56,
            pending: 78,
            total: 1500,
            unfinished: 266,
          };
          expect(instance.t('messages.toolActivity.recap.category.search', { count: 1234 })).toContain(
            new Intl.NumberFormat(locale).format(1234)
          );

          for (const [key, placeholderNames] of Object.entries(RECAP_OUTCOME_PLACEHOLDERS)) {
            const outcome = instance.t(`messages.toolActivity.recap.outcome.${key}`, values);
            for (const placeholderName of placeholderNames) {
              const value = values[placeholderName as keyof typeof values];
              expect(outcome).toContain(new Intl.NumberFormat(locale).format(value));
            }
          }
        })
      );
    });
  });
});
