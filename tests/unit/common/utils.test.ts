/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { uuid, parseError, resolveLocaleKey } from '@/common/utils/utils';
import {
  DIAGNOSTIC_REDACTION_MARKER,
  DIAGNOSTIC_TRUNCATION_MARKER,
  redactDiagnosticText,
  redactDiagnosticTextToUtf8Bytes,
  redactDiagnosticValue,
} from '@/common/utils/diagnosticRedaction';

describe('utils', () => {
  describe('uuid', () => {
    it('generates string of default length 8', () => {
      const id = uuid();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(8);
    });

    it('generates string of custom length', () => {
      expect(uuid(16).length).toBe(16);
      expect(uuid(32).length).toBe(32);
    });

    it('generates different ids on successive calls', () => {
      const id1 = uuid();
      const id2 = uuid();
      expect(id1).not.toBe(id2);
    });

    it('uses crypto.randomUUID when length >= 36', () => {
      const id = uuid(36);
      expect(id.length).toBe(36);
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('uses crypto.getRandomValues for lengths < 36', () => {
      const id = uuid(12);
      expect(id.length).toBe(12);
      expect(id).toMatch(/^[0-9a-f]{12}$/);
    });

    it('falls back to timestamp-based ID when crypto unavailable', () => {
      const originalCrypto = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const id = uuid(10);
      expect(id.length).toBe(10);

      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('parseError', () => {
    it('returns string as-is', () => {
      expect(parseError('error message')).toBe('error message');
    });

    it('extracts message from Error instance', () => {
      const error = new Error('test error');
      expect(parseError(error)).toBe('test error');
    });

    it('extracts msg property from object', () => {
      const error = { msg: 'custom error' };
      expect(parseError(error)).toBe('custom error');
    });

    it('extracts message property from object', () => {
      const error = { message: 'object error' };
      expect(parseError(error)).toBe('object error');
    });

    it('prefers msg over message', () => {
      const error = { msg: 'msg value', message: 'message value' };
      expect(parseError(error)).toBe('msg value');
    });

    it('prefers backendMessage over wrapped error message', () => {
      const error = Object.assign(new Error('wrapped error'), {
        backendMessage: 'raw backend error',
      });
      expect(parseError(error)).toBe('raw backend error');
    });

    it('stringifies object without msg/message', () => {
      const error = { code: 500, status: 'fail' };
      expect(parseError(error)).toBe('{"code":500,"status":"fail"}');
    });

    it('handles null', () => {
      expect(parseError(null)).toBe('null');
    });

    it('handles undefined', () => {
      // JSON.stringify(undefined) returns undefined, not a string
      expect(parseError(undefined)).toBeUndefined();
    });

    it('handles number', () => {
      expect(parseError(404)).toBe('404');
    });

    it('handles boolean', () => {
      expect(parseError(true)).toBe('true');
    });

    it('handles circular reference gracefully', () => {
      const error: { name: string; self?: unknown } = { name: 'circular' };
      error.self = error;
      expect(typeof parseError(error)).toBe('string');
    });
  });

  describe('resolveLocaleKey', () => {
    it('resolves zh variants to zh-CN', () => {
      expect(resolveLocaleKey('zh')).toBe('zh-CN');
      expect(resolveLocaleKey('zh-CN')).toBe('zh-CN');
      expect(resolveLocaleKey('zh-Hans')).toBe('zh-CN');
    });

    it('resolves zh-TW to zh-TW', () => {
      expect(resolveLocaleKey('zh-TW')).toBe('zh-TW');
      expect(resolveLocaleKey('zh-tw')).toBe('zh-TW');
      expect(resolveLocaleKey('zh-Hant')).toBe('zh-CN'); // Falls back to CN
    });

    it('resolves ja variants to ja-JP', () => {
      expect(resolveLocaleKey('ja')).toBe('ja-JP');
      expect(resolveLocaleKey('ja-JP')).toBe('ja-JP');
    });

    it('resolves ko variants to ko-KR', () => {
      expect(resolveLocaleKey('ko')).toBe('ko-KR');
      expect(resolveLocaleKey('ko-KR')).toBe('ko-KR');
    });

    it('resolves tr variants to tr-TR', () => {
      expect(resolveLocaleKey('tr')).toBe('tr-TR');
      expect(resolveLocaleKey('tr-TR')).toBe('tr-TR');
    });

    it('resolves ru, uk, pt, de, es, and fa variants to supported locales', () => {
      expect(resolveLocaleKey('ru')).toBe('ru-RU');
      expect(resolveLocaleKey('ru-RU')).toBe('ru-RU');
      expect(resolveLocaleKey('uk')).toBe('uk-UA');
      expect(resolveLocaleKey('uk-UA')).toBe('uk-UA');
      expect(resolveLocaleKey('pt')).toBe('pt-BR');
      expect(resolveLocaleKey('pt-BR')).toBe('pt-BR');
      expect(resolveLocaleKey('de')).toBe('de-DE');
      expect(resolveLocaleKey('de-DE')).toBe('de-DE');
      expect(resolveLocaleKey('es')).toBe('es-ES');
      expect(resolveLocaleKey('es-ES')).toBe('es-ES');
      expect(resolveLocaleKey('fa')).toBe('fa-IR');
      expect(resolveLocaleKey('fa-IR')).toBe('fa-IR');
    });

    it('resolves unknown languages to en-US', () => {
      expect(resolveLocaleKey('en')).toBe('en-US');
      expect(resolveLocaleKey('en-US')).toBe('en-US');
      expect(resolveLocaleKey('fr')).toBe('en-US');
      expect(resolveLocaleKey('it')).toBe('en-US');
    });

    it('is case-insensitive', () => {
      expect(resolveLocaleKey('ZH')).toBe('zh-CN');
      expect(resolveLocaleKey('JA')).toBe('ja-JP');
      expect(resolveLocaleKey('KO')).toBe('ko-KR');
      expect(resolveLocaleKey('TR')).toBe('tr-TR');
      expect(resolveLocaleKey('RU')).toBe('ru-RU');
      expect(resolveLocaleKey('UK')).toBe('uk-UA');
      expect(resolveLocaleKey('PT')).toBe('pt-BR');
      expect(resolveLocaleKey('ES')).toBe('es-ES');
      expect(resolveLocaleKey('FA')).toBe('fa-IR');
    });

    it('handles empty string', () => {
      expect(resolveLocaleKey('')).toBe('en-US');
    });
  });

  describe('diagnostic redaction', () => {
    it('redacts nested sensitive keys while preserving useful fields', () => {
      const value = redactDiagnosticValue({
        provider: 'openai',
        authorization: 'Bearer auth-secret',
        nested: {
          api_key: 'sk-test-secret',
          accessToken: 'access-secret',
          status: 401,
        },
      });

      expect(value).toEqual({
        provider: 'openai',
        authorization: DIAGNOSTIC_REDACTION_MARKER,
        nested: {
          api_key: DIAGNOSTIC_REDACTION_MARKER,
          accessToken: DIAGNOSTIC_REDACTION_MARKER,
          status: 401,
        },
      });
    });

    it('redacts authorization, URL credentials, and key-value secrets in text', () => {
      const text = [
        'Authorization: Bearer bearer-secret',
        'https://user:password-secret@example.com/path',
        'api_key=sk-inline-secret',
      ].join('\n');

      const result = redactDiagnosticText(text);

      expect(result).not.toContain('bearer-secret');
      expect(result).not.toContain('password-secret');
      expect(result).not.toContain('sk-inline-secret');
      expect(result).toContain(DIAGNOSTIC_REDACTION_MARKER);
    });

    it('redacts the entire authorization value for any scheme', () => {
      const result = redactDiagnosticText('Authorization: Token credentials-that-must-not-leak');

      expect(result).toBe(`Authorization: ${DIAGNOSTIC_REDACTION_MARKER}`);
    });

    it('bounds long safe alphabetic input before applying redaction patterns', { timeout: 5_000 }, () => {
      const startedAt = performance.now();
      const result = redactDiagnosticText('a'.repeat(50_000));
      const elapsedMs = performance.now() - startedAt;

      expect(result).toBe(`${'a'.repeat(16_384)}${DIAGNOSTIC_TRUNCATION_MARKER}`);
      expect(elapsedMs).toBeLessThan(1_000);
    });

    it('redacts complete quoted secret assignments containing whitespace and escapes', () => {
      const result = redactDiagnosticText(
        String.raw`password="alpha beta \"secret\"" client_secret='gamma delta \'secret\''`
      );

      expect(result).toBe(`password=${DIAGNOSTIC_REDACTION_MARKER} client_secret=${DIAGNOSTIC_REDACTION_MARKER}`);
    });

    it('redacts a double-quoted secret whose closing quote is beyond the retained boundary', () => {
      const result = redactDiagnosticText('password="abcdefghijklmnopqrstuvwxyz"', 20);

      expect(result).toBe(`password=${DIAGNOSTIC_REDACTION_MARKER}${DIAGNOSTIC_TRUNCATION_MARKER}`);
      expect(result).not.toContain('abcdefghij');
    });

    it('redacts a single-quoted secret whose closing quote is beyond the retained boundary', () => {
      const result = redactDiagnosticText("password='abcdefghijklmnopqrstuvwxyz'", 20);

      expect(result).toBe(`password=${DIAGNOSTIC_REDACTION_MARKER}${DIAGNOSTIC_TRUNCATION_MARKER}`);
      expect(result).not.toContain('abcdefghij');
    });

    it('redacts a URL password whose at-sign is beyond the retained boundary', () => {
      const result = redactDiagnosticText('https://user:abcdefghijklmnopqrstuvwxyz@example.com/path', 25);

      expect(result).toBe(`https://user:${DIAGNOSTIC_REDACTION_MARKER}${DIAGNOSTIC_TRUNCATION_MARKER}`);
      expect(result).not.toContain('abcdefghijkl');
    });

    it('preserves complete quoted and URL credential redaction output', () => {
      expect(redactDiagnosticText('password="alpha beta"')).toBe(`password=${DIAGNOSTIC_REDACTION_MARKER}`);
      expect(redactDiagnosticText("password='gamma delta'")).toBe(`password=${DIAGNOSTIC_REDACTION_MARKER}`);
      expect(redactDiagnosticText('https://user:password-secret@example.com/path')).toBe(
        `https://user:${DIAGNOSTIC_REDACTION_MARKER}@example.com/path`
      );
    });

    it('stops an unterminated quoted secret at the line boundary', () => {
      const result = redactDiagnosticText('password="alpha beta\nstatus=healthy');

      expect(result).toBe(`password=${DIAGNOSTIC_REDACTION_MARKER}\nstatus=healthy`);
    });

    it('redacts proxy authorization assignments directly', () => {
      const result = redactDiagnosticText('Proxy-Authorization: Basic proxy-secret');

      expect(result).toBe(`Proxy-Authorization: ${DIAGNOSTIC_REDACTION_MARKER}`);
    });

    it('accepts diagnostic text at exactly 4,096 UTF-8 bytes', () => {
      const result = redactDiagnosticTextToUtf8Bytes('x'.repeat(4_096), 4_096);

      expect(new TextEncoder().encode(result)).toHaveLength(4_096);
      expect(result).not.toContain(DIAGNOSTIC_TRUNCATION_MARKER);
    });

    it('fits multibyte diagnostic text and its truncation marker within 4,096 UTF-8 bytes', () => {
      const result = redactDiagnosticTextToUtf8Bytes('\u{1F4A5}'.repeat(2_048), 4_096);

      expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(4_096);
      expect(result.endsWith(DIAGNOSTIC_TRUNCATION_MARKER)).toBe(true);
      expect(result).not.toContain('\uFFFD');
    });

    it('normalizes errors without preserving secrets', () => {
      const error = new Error('request failed token=error-secret');
      error.stack = 'Error: request failed\nAuthorization: Bearer stack-secret';

      const serialized = JSON.stringify(redactDiagnosticValue(error));

      expect(serialized).toContain('request failed');
      expect(serialized).not.toContain('error-secret');
      expect(serialized).not.toContain('stack-secret');
    });

    it('replaces circular references with a stable marker', () => {
      const value: Record<string, unknown> = { status: 'failed' };
      value.self = value;

      expect(redactDiagnosticValue(value)).toEqual({
        status: 'failed',
        self: '[CIRCULAR]',
      });
    });

    it('bounds depth, entries, and string length deterministically', () => {
      const result = redactDiagnosticValue(
        {
          long: 'abcdefgh',
          list: [1, 2, 3],
          nested: { child: { value: 'hidden-by-depth' } },
        },
        { maxArrayItems: 2, maxDepth: 2, maxObjectEntries: 3, maxStringLength: 4 }
      );

      expect(result).toEqual({
        long: 'abcd[TRUNCATED]',
        list: [1, 2, '[TRUNCATED]'],
        nested: { child: '[TRUNCATED]' },
      });
    });

    it('uses safe placeholders for unsupported values', () => {
      expect(redactDiagnosticValue({ value: 1n, callback: () => 'secret' })).toEqual({
        value: '[UNSUPPORTED]',
        callback: '[UNSUPPORTED]',
      });
    });
  });
});
