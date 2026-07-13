/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpRawOutput, ToolCallUpdate } from '@/common/types/platform/acpTypes';

const IMAGE_PATH_EXTENSION_RE = /\.(?:png|jpe?g|webp|gif)$/i;
const WRAPPED_INLINE_IMAGE_DATA_URL_RE =
  /data:image\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+(?:=[^;,\s]*)?)*;base64,[a-z0-9+/=]+(?:\r?\n[ \t]*[a-z0-9+/=]+)*?\r?\n[ \t]*[a-z0-9+/]+={1,2}/gi;
const INLINE_IMAGE_DATA_URL_RE = /data:image\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+(?:=[^;,\s]*)?)*;base64,[a-z0-9+/]*={0,2}/gi;
const PURE_RASTER_BASE64_RE = /^(?:iVBORw0KGgo|\/9j\/|UklGR)[A-Za-z0-9+/]*={0,2}$/;

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

const sanitizeInlineImageString = (value: string): InlineImagePayloadSanitization => {
  const trimmedValue = value.trim();
  const compactValue = trimmedValue.replace(/[ \t\r\n]/g, '');
  const isPureRasterPayload =
    PURE_RASTER_BASE64_RE.test(trimmedValue) ||
    (compactValue !== trimmedValue && /={1,2}$/.test(compactValue) && PURE_RASTER_BASE64_RE.test(compactValue));
  if (isPureRasterPayload) {
    return {
      value: INLINE_IMAGE_OMISSION_MARKER,
      omitted: true,
      omittedCharacters: value.length,
      wholeValueOmitted: true,
    };
  }

  let omittedCharacters = 0;
  const omitInlineImage = (match: string): string => {
    omittedCharacters += match.length;
    return INLINE_IMAGE_OMISSION_MARKER;
  };
  const sanitized = value
    .replace(WRAPPED_INLINE_IMAGE_DATA_URL_RE, omitInlineImage)
    .replace(INLINE_IMAGE_DATA_URL_RE, omitInlineImage);
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
