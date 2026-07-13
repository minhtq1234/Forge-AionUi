/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const DIAGNOSTIC_REDACTION_MARKER = '[REDACTED]';
export const DIAGNOSTIC_TRUNCATION_MARKER = '[TRUNCATED]';

const CIRCULAR_MARKER = '[CIRCULAR]';
const UNSUPPORTED_MARKER = '[UNSUPPORTED]';

export type DiagnosticRedactionLimits = {
  maxArrayItems: number;
  maxDepth: number;
  maxObjectEntries: number;
  maxStringLength: number;
};

const DEFAULT_LIMITS: DiagnosticRedactionLimits = {
  maxArrayItems: 100,
  maxDepth: 8,
  maxObjectEntries: 100,
  maxStringLength: 16_384,
};

const SENSITIVE_KEYS = new Set([
  'apikey',
  'xapikey',
  'authorization',
  'proxyauthorization',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'token',
  'password',
  'passwd',
  'secret',
  'clientsecret',
  'cookie',
  'setcookie',
  'session',
  'sessionid',
  'sessiontoken',
  'jwt',
  'jwttoken',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase());
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}${DIAGNOSTIC_TRUNCATION_MARKER}` : text;
}

export function redactDiagnosticText(text: string, maxLength = DEFAULT_LIMITS.maxStringLength): string {
  const redacted = text
    .replace(/(\b(?:proxy[_-]?authorization|authorization)\s*[=:]\s*)[^\r\n]*/gi, `$1${DIAGNOSTIC_REDACTION_MARKER}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${DIAGNOSTIC_REDACTION_MARKER}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+@/gi, `$1${DIAGNOSTIC_REDACTION_MARKER}@`)
    .replace(
      /(["']?(?:authorization|proxy[_-]?authorization|x[_-]?api[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|password|passwd|client[_-]?secret|secret|cookie|session(?:[_-]?(?:id|token))?|jwt(?:[_-]?token)?)["']?\s*[=:]\s*)(["']?)[^\s"',;}]+\2/gi,
      `$1${DIAGNOSTIC_REDACTION_MARKER}`
    );
  return truncate(redacted, maxLength);
}

export function redactDiagnosticValue(value: unknown, limits: Partial<DiagnosticRedactionLimits> = {}): unknown {
  const resolved = { ...DEFAULT_LIMITS, ...limits };
  const ancestors = new WeakSet<object>();

  const visit = (current: unknown, depth: number): unknown => {
    if (current === null || typeof current === 'boolean' || typeof current === 'number') return current;
    if (typeof current === 'string') return redactDiagnosticText(current, resolved.maxStringLength);
    if (typeof current !== 'object') return UNSUPPORTED_MARKER;
    if (depth >= resolved.maxDepth) return DIAGNOSTIC_TRUNCATION_MARKER;
    if (ancestors.has(current)) return CIRCULAR_MARKER;

    ancestors.add(current);
    try {
      if (current instanceof Error) {
        return visit({ name: current.name, message: current.message, stack: current.stack }, depth);
      }
      if (Array.isArray(current)) {
        const items = current.slice(0, resolved.maxArrayItems).map((item) => visit(item, depth + 1));
        if (current.length > resolved.maxArrayItems) items.push(DIAGNOSTIC_TRUNCATION_MARKER);
        return items;
      }

      const output: Record<string, unknown> = {};
      const entries = Object.entries(current as Record<string, unknown>);
      for (const [key, entry] of entries.slice(0, resolved.maxObjectEntries)) {
        output[key] = isSensitiveKey(key) ? DIAGNOSTIC_REDACTION_MARKER : visit(entry, depth + 1);
      }
      if (entries.length > resolved.maxObjectEntries) output[DIAGNOSTIC_TRUNCATION_MARKER] = true;
      return output;
    } catch {
      return UNSUPPORTED_MARKER;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value, 0);
}
