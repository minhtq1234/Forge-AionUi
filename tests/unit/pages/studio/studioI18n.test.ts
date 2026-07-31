/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import i18nConfig from '@/common/config/i18n-config.json';

type JsonObject = Record<string, unknown>;

const localeRoot = new URL('../../../../packages/desktop/src/renderer/services/i18n/locales/', import.meta.url);

const plannedGroups = [
  'create',
  'draft',
  'empty',
  'errors',
  'export',
  'inspector',
  'jobs',
  'library',
  'models',
  'nav',
  'preview',
  'project',
  'review',
  'routing',
  'scene',
  'storyboard',
  'timeline',
] as const;

const taskSevenKeys = [
  'nav.title',
  'library.title',
  'library.subtitle',
  'library.newProject',
  'library.loading',
  'library.error',
  'library.retry',
  'library.readinessLabel',
  'library.readinessReady',
  'library.readinessChecking',
  'library.readinessSetupRequired',
  'library.readinessUnavailable',
  'library.openProject',
  'library.deleteProject',
  'library.deleteConfirmTitle',
  'library.deleteConfirmBody',
  'library.deleteActiveWork',
  'library.createFailed',
  'library.deleteFailed',
  'library.sceneCount',
  'library.deleteConfirm',
  'empty.title',
  'empty.body',
  'empty.create',
  'create.title',
  'create.nameLabel',
  'create.namePlaceholder',
  'create.briefLabel',
  'create.briefPlaceholder',
  'create.aspectRatioLabel',
  'create.aspectRatio16x9',
  'create.aspectRatio9x16',
  'create.aspectRatio1x1',
  'create.aspectRatio4x3',
  'create.aspectRatio3x4',
  'create.targetDurationLabel',
  'create.invalidDuration',
  'create.submit',
  'create.cancel',
  'project.loading',
  'project.notFound',
  'project.title',
  'project.brief',
  'project.aspectRatio',
  'project.targetDuration',
  'project.resolution',
  'project.sceneCount',
  'project.readiness',
  'project.emptyStoryboard',
] as const;

const stableMessageKeys = [
  'errors.invalidPayload',
  'errors.projectNotFound',
  'errors.storyboardExists',
  'errors.staleProject',
  'errors.planningUnavailable',
  'errors.invalidRoute',
  'errors.cancellationRefused',
  'errors.duplicateChargeAcknowledgementRequired',
  'errors.busy',
  'errors.provider',
  'errors.storage',
  'jobs.errors.invalidRequest',
  'jobs.errors.auth',
  'jobs.errors.quota',
  'jobs.errors.rateLimited',
  'jobs.errors.providerUnavailable',
  'jobs.errors.timeout',
  'jobs.errors.noOutput',
  'jobs.errors.submissionUnknown',
  'jobs.errors.downloadFailed',
  'jobs.errors.unsupported',
  'jobs.errors.unknown',
] as const;

function loadConversationLocale(locale: string): JsonObject {
  const localeUrl = new URL(`${locale}/conversation.json`, localeRoot);
  return JSON.parse(readFileSync(localeUrl, 'utf8')) as JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flattenStringLeaves(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') {
    return { [prefix]: value };
  }

  if (!isJsonObject(value)) {
    return {};
  }

  const leaves: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPrefix = prefix ? `${prefix}.${key}` : key;
    Object.assign(leaves, flattenStringLeaves(child, childPrefix));
  }
  return leaves;
}

function getPlaceholders(value: string): string[] {
  return (value.match(/{{[^{}]+}}/g) ?? []).toSorted();
}

describe('Creative Studio localization contract', () => {
  it('defines the complete planned group and Task 7 key contract in the reference locale', () => {
    const reference = loadConversationLocale(i18nConfig.referenceLanguage);
    const creativeStudio = reference.creativeStudio;

    expect(isJsonObject(creativeStudio), 'en-US conversation.creativeStudio must be an object').toBe(true);
    if (!isJsonObject(creativeStudio)) return;

    expect(Object.keys(creativeStudio).toSorted()).toEqual([...plannedGroups].toSorted());

    const leaves = flattenStringLeaves(creativeStudio);
    for (const key of taskSevenKeys) {
      expect(leaves[key], `Missing conversation.creativeStudio.${key}`).toBeTruthy();
    }
  });

  it('does not retain Studio connection ownership or App Operations copy', () => {
    const reference = loadConversationLocale(i18nConfig.referenceLanguage);
    const creativeStudio = reference.creativeStudio;
    expect(isJsonObject(creativeStudio)).toBe(true);
    if (!isJsonObject(creativeStudio)) return;

    expect(creativeStudio.connection).toBeUndefined();
    expect(JSON.stringify(creativeStudio)).not.toContain('App Operations');
  });

  it('keeps every configured locale exactly in parity, non-empty, translated, and placeholder-compatible', () => {
    const reference = loadConversationLocale(i18nConfig.referenceLanguage).creativeStudio;
    expect(isJsonObject(reference), 'Reference Creative Studio subtree is missing').toBe(true);
    if (!isJsonObject(reference)) return;

    const issues: string[] = [];
    const referenceLeaves = flattenStringLeaves(reference);
    const referenceKeys = Object.keys(referenceLeaves).toSorted();
    const configuredLocales = i18nConfig.supportedLanguages.toSorted();

    for (const locale of configuredLocales) {
      const creativeStudio = loadConversationLocale(locale).creativeStudio;
      if (!isJsonObject(creativeStudio)) {
        issues.push(`${locale} is missing conversation.creativeStudio`);
        continue;
      }

      const localeLeaves = flattenStringLeaves(creativeStudio);
      const localeKeys = Object.keys(localeLeaves).toSorted();
      const missingKeys = referenceKeys.filter((key) => !(key in localeLeaves));
      const extraKeys = localeKeys.filter((key) => !(key in referenceLeaves));

      if (missingKeys.length > 0) {
        issues.push(`${locale} is missing: ${missingKeys.join(', ')}`);
      }
      if (extraKeys.length > 0) {
        issues.push(`${locale} has extra keys: ${extraKeys.join(', ')}`);
      }

      for (const key of referenceKeys) {
        const value = localeLeaves[key];
        if (value === undefined) continue;

        if (value.trim().length === 0) {
          issues.push(`${locale}.${key} is empty`);
        }

        const expectedPlaceholders = getPlaceholders(referenceLeaves[key]);
        const actualPlaceholders = getPlaceholders(value);
        if (expectedPlaceholders.join('\n') !== actualPlaceholders.join('\n')) {
          issues.push(
            `${locale}.${key} placeholders ${actualPlaceholders.join(', ')} do not match ${expectedPlaceholders.join(', ')}`
          );
        }
      }

      if (locale !== i18nConfig.referenceLanguage) {
        const copiedKeys = referenceKeys.filter((key) => localeLeaves[key] === referenceLeaves[key]);
        const maximumCopiedLeaves = Math.max(4, Math.floor(referenceKeys.length * 0.05));
        if (copiedKeys.length > maximumCopiedLeaves) {
          issues.push(`${locale} leaves too much English copy (${copiedKeys.length} keys): ${copiedKeys.join(', ')}`);
        }
      }
    }

    expect(issues).toEqual([]);
  });

  it('resolves every stable bridge and durable-job message key in every locale', () => {
    const issues: string[] = [];

    for (const locale of i18nConfig.supportedLanguages) {
      const creativeStudio = loadConversationLocale(locale).creativeStudio;
      const leaves = flattenStringLeaves(creativeStudio);

      for (const key of stableMessageKeys) {
        if (!leaves[key]?.trim()) {
          issues.push(`${locale} is missing conversation.creativeStudio.${key}`);
        }
      }
    }

    expect(issues).toEqual([]);
  });
});
