/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpRawOutput, ToolCallUpdate } from '@/common/types/platform/acpTypes';

const IMAGE_PATH_EXTENSION_RE = /\.(?:png|jpe?g|webp|gif)$/i;
const INLINE_IMAGE_DATA_URL_START_RE = /data:image\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+(?:=[^;,\s]*)?)*;base64,/gi;
const RAW_RASTER_BASE64_PREFIX_RE = /(?:iVBORw0KGgo|\/9j\/|UklGR|R0lGOD)/g;
const BASE64_CHARACTER_RE = /^[a-z0-9+/=]$/i;
const RASTER_BASE64_PREFIX_RE = /^(?:iVBORw0KGgo|\/9j\/|UklGR|R0lGOD)/;
const COMMON_STATUS_WORD_RE = /^(?:complete|completed|done|error|failed|ready|saved|success|successful)$/i;

export const INLINE_IMAGE_OMISSION_MARKER = '[inline image omitted]';

export type InlineImagePayloadSanitization = {
  value: unknown;
  omitted: boolean;
  omittedCharacters: number;
  wholeValueOmitted: boolean;
};

const unchangedSanitization = (value: unknown): InlineImagePayloadSanitization => ({
  value,
  omitted: false,
  omittedCharacters: 0,
  wholeValueOmitted: false,
});

const readBase64TokenEnd = (value: string, start: number): number => {
  let end = start;
  while (end < value.length && BASE64_CHARACTER_RE.test(value[end])) end += 1;
  return end;
};

const readLineEnd = (value: string, start: number): number => {
  let end = start;
  while (end < value.length && value[end] !== '\r' && value[end] !== '\n') end += 1;
  return end;
};

const readLineBreakEnd = (value: string, start: number): number => {
  if (value[start] === '\r' && value[start + 1] === '\n') return start + 2;
  if (value[start] === '\r' || value[start] === '\n') return start + 1;
  return start;
};

const isStrongInlineContinuation = (token: string): boolean =>
  token.length >= 12 || /[0-9+/=]/.test(token) || (token === token.toUpperCase() && !COMMON_STATUS_WORD_RE.test(token));

const isPayloadWhitespace = (value: string | undefined): boolean =>
  value === ' ' || value === '\t' || value === '\r' || value === '\n';

// Extend a data-URL replacement through payload-shaped chunks, but stop before
// sentence-like text on the same or following line.
const consumeRasterContinuations = (value: string, initialEnd: number): number => {
  let end = initialEnd;

  while (end < value.length) {
    const whitespaceStart = end;
    while (value[end] === ' ' || value[end] === '\t') end += 1;
    if (end === whitespaceStart) break;

    const tokenEnd = readBase64TokenEnd(value, end);
    const token = value.slice(end, tokenEnd);
    if (!token || !isStrongInlineContinuation(token)) {
      end = whitespaceStart;
      break;
    }
    end = tokenEnd;
  }

  while (end < value.length) {
    const lineBreakStart = end;
    const lineContentStart = readLineBreakEnd(value, lineBreakStart);
    if (lineContentStart === lineBreakStart) break;

    let tokenStart = lineContentStart;
    while (value[tokenStart] === ' ' || value[tokenStart] === '\t') tokenStart += 1;
    const tokenEnd = readBase64TokenEnd(value, tokenStart);
    const token = value.slice(tokenStart, tokenEnd);
    if (!token) break;

    const lineEnd = readLineEnd(value, tokenEnd);
    const suffix = value.slice(tokenEnd, lineEnd);
    if (/^[ \t]*$/.test(suffix) && isStrongInlineContinuation(token)) {
      end = lineEnd;
      continue;
    }
    if (/^[ \t]*[;,.!?)\]}'"]/.test(suffix) && isStrongInlineContinuation(token)) {
      end = tokenEnd;
    }
    break;
  }

  return end;
};

const sanitizeInlineImageStrings = (value: string): { value: string; omittedCharacters: number } => {
  const matcher = new RegExp(INLINE_IMAGE_DATA_URL_START_RE.source, INLINE_IMAGE_DATA_URL_START_RE.flags);
  const ranges: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(value))) {
    const start = match.index;
    let payloadStart = matcher.lastIndex;
    while (payloadStart < value.length && isPayloadWhitespace(value[payloadStart])) payloadStart += 1;
    const initialEnd = readBase64TokenEnd(value, payloadStart);
    const initialToken = value.slice(payloadStart, initialEnd);
    const end = RASTER_BASE64_PREFIX_RE.test(initialToken) ? consumeRasterContinuations(value, initialEnd) : initialEnd;
    ranges.push({ start, end });
    matcher.lastIndex = Math.max(matcher.lastIndex, end);
  }

  const rawMatcher = new RegExp(RAW_RASTER_BASE64_PREFIX_RE.source, RAW_RASTER_BASE64_PREFIX_RE.flags);
  while ((match = rawMatcher.exec(value))) {
    const start = match.index;
    if (start > 0 && BASE64_CHARACTER_RE.test(value[start - 1])) continue;

    const initialEnd = readBase64TokenEnd(value, start);
    const end = consumeRasterContinuations(value, initialEnd);
    const hasPayloadData = initialEnd > start + match[0].length || end > initialEnd;
    if (hasPayloadData) ranges.push({ start, end });
    rawMatcher.lastIndex = Math.max(rawMatcher.lastIndex, end);
  }

  if (ranges.length === 0) return { value, omittedCharacters: 0 };
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);

  let cursor = 0;
  let omittedCharacters = 0;
  let sanitized = '';
  for (const range of ranges) {
    if (range.start < cursor) continue;
    sanitized += value.slice(cursor, range.start) + INLINE_IMAGE_OMISSION_MARKER;
    omittedCharacters += range.end - range.start;
    cursor = range.end;
  }
  sanitized += value.slice(cursor);
  return { value: sanitized, omittedCharacters };
};

const sanitizeInlineImageString = (value: string): InlineImagePayloadSanitization => {
  const { value: sanitized, omittedCharacters } = sanitizeInlineImageStrings(value);
  if (omittedCharacters === 0) return unchangedSanitization(value);

  return {
    value: sanitized,
    omitted: true,
    omittedCharacters,
    wholeValueOmitted: sanitized.trim() === INLINE_IMAGE_OMISSION_MARKER,
  };
};

export const sanitizeInlineImagePayload = (value: unknown): InlineImagePayloadSanitization => {
  if (typeof value === 'string') return sanitizeInlineImageString(value);

  if (Array.isArray(value)) {
    let omittedCharacters = 0;
    let omitted = false;
    const sanitized = value.map((item) => {
      const itemSanitization = sanitizeInlineImagePayload(item);
      omitted = omitted || itemSanitization.omitted;
      omittedCharacters += itemSanitization.omittedCharacters;
      return itemSanitization.value;
    });

    return omitted
      ? { value: sanitized, omitted, omittedCharacters, wholeValueOmitted: false }
      : unchangedSanitization(value);
  }

  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return unchangedSanitization(value);

    let omittedCharacters = 0;
    let omitted = false;
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const itemSanitization = sanitizeInlineImagePayload(item);
      omitted = omitted || itemSanitization.omitted;
      omittedCharacters += itemSanitization.omittedCharacters;
      sanitized[key] = itemSanitization.value;
    }

    return omitted
      ? { value: sanitized, omitted, omittedCharacters, wholeValueOmitted: false }
      : unchangedSanitization(value);
  }

  return unchangedSanitization(value);
};

const isImagePath = (path: string): boolean => IMAGE_PATH_EXTENSION_RE.test(path);

const mimeTypeFromImagePath = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
};

const sanitizeAcpRawOutput = (rawOutput?: AcpRawOutput): AcpRawOutput | undefined => {
  if (!rawOutput) return rawOutput;

  const rawOutputSanitization = sanitizeInlineImagePayload(rawOutput);
  const resultSanitization = sanitizeInlineImagePayload(rawOutput.result);
  let sanitizedRawOutput = rawOutputSanitization.value as AcpRawOutput;
  if (!resultSanitization.omitted) return sanitizedRawOutput;

  if (resultSanitization.wholeValueOmitted) {
    const { result: _result, ...rest } = sanitizedRawOutput;
    sanitizedRawOutput = rest;
  }

  const savedPath = sanitizedRawOutput.saved_path;
  const sanitized: AcpRawOutput = {
    ...sanitizedRawOutput,
    result_omitted: true,
    result_omitted_reason: rawOutput.result_omitted_reason ?? 'image_base64',
    result_bytes: rawOutput.result_bytes ?? resultSanitization.omittedCharacters,
  };

  if (sanitized.image || (typeof savedPath === 'string' && savedPath !== INLINE_IMAGE_OMISSION_MARKER)) {
    const path = sanitized.image?.path || savedPath;
    sanitized.image = sanitized.image || {
      path,
      mime_type: mimeTypeFromImagePath(path),
      source: 'codex_image_generation',
    };
  }

  return sanitized;
};

export const sanitizeAcpToolUpdate = (update: ToolCallUpdate['update']): ToolCallUpdate['update'] => {
  const contentSanitization = sanitizeInlineImagePayload(update.content);

  return {
    ...update,
    rawOutput: sanitizeAcpRawOutput(update.rawOutput),
    raw_output: sanitizeAcpRawOutput(update.raw_output),
    ...(contentSanitization.omitted
      ? { content: contentSanitization.value as ToolCallUpdate['update']['content'] }
      : {}),
  };
};

export const sanitizeAcpToolCallContent = (content: ToolCallUpdate): ToolCallUpdate => ({
  ...content,
  update: sanitizeAcpToolUpdate(content.update),
});

export const getAcpImagePath = (update: ToolCallUpdate['update']): string | undefined => {
  const rawOutput = update.rawOutput || update.raw_output;
  const imagePath = rawOutput?.image?.path;
  if (typeof imagePath === 'string' && imagePath) return imagePath;

  const savedPath = rawOutput?.saved_path;
  if (
    typeof savedPath === 'string' &&
    savedPath &&
    (rawOutput?.result_omitted_reason === 'image_base64' || isImagePath(savedPath))
  ) {
    return savedPath;
  }

  return undefined;
};

export const getAcpImageFileName = (path: string): string => path.split(/[/\\]/).pop() || 'generated-image.png';
