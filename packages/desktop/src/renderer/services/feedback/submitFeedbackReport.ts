import type { FeedbackDiagnosticsContextInput } from '@/common/types/feedbackDiagnostics';
import { httpRequest } from '@/common/adapter/httpBridge';
import {
  DIAGNOSTIC_TRUNCATION_MARKER,
  redactDiagnosticText,
  redactDiagnosticTextToUtf8Bytes,
  redactDiagnosticValue,
} from '@/common/utils/diagnosticRedaction';

const SUMMARY_PREVIEW_LENGTH = 60;
const LOG_PREFIX = '[FeedbackReport]';
const MAX_DB_DIAGNOSTICS_BYTES = 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const MAX_SCREENSHOTS = 3;
const MAX_ATTACHMENT_CANDIDATES = 100;
const MAX_TAG_VALUE_LENGTH = 1024;
const RESERVED_AUTOMATIC_ATTACHMENT_FILENAMES = new Set(['logs.gz', 'db-diagnostics.json', 'db-diagnostics.json.gz']);
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength'
)?.get;
type FeedbackLogLevel = 'info' | 'warn' | 'error';
type FeedbackLogAttachmentStatus = 'collected' | 'empty' | 'failed' | 'skipped' | 'unavailable';
type FeedbackDbDiagnosticsAttachmentStatus = 'collected' | 'empty' | 'failed' | 'skipped' | 'unavailable';
type FeedbackDiagnosticsAttachmentPayload = {
  contentType: string;
  data: Uint8Array<ArrayBuffer>;
  filename: string;
};

export type FeedbackAttachment = {
  filename: string;
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
};

export type FeedbackEventTags = Record<string, string>;
export type FeedbackEventExtra = Record<string, unknown>;

export type SubmitFeedbackReportInput = {
  attachments?: FeedbackAttachment[];
  collectDbDiagnostics?: FeedbackDiagnosticsContextInput;
  collectLogs?: boolean;
  description: string;
  extra?: FeedbackEventExtra;
  flushTimeoutMs?: number;
  module: string;
  moduleLabel: string;
  tags?: FeedbackEventTags;
};

function summarizeAttachments(attachments: FeedbackAttachment[]): Array<{
  contentType: string;
  filename: string;
  size: number;
}> {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.data.byteLength,
  }));
}

function summarizeLogAttachment(
  status: FeedbackLogAttachmentStatus,
  attachment: FeedbackAttachment | null
): {
  filename?: string;
  size?: number;
  status: FeedbackLogAttachmentStatus;
} {
  if (!attachment) {
    return { status };
  }

  return {
    status,
    filename: attachment.filename,
    size: attachment.data.byteLength,
  };
}

function summarizeDbDiagnosticsAttachment(
  status: FeedbackDbDiagnosticsAttachmentStatus,
  attachment: FeedbackAttachment | null
): {
  filename?: string;
  size?: number;
  status: FeedbackDbDiagnosticsAttachmentStatus;
} {
  if (!attachment) {
    return { status };
  }

  return {
    status,
    filename: attachment.filename,
    size: attachment.data.byteLength,
  };
}

function normalizeLogDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack,
    };
  }
  return details;
}

export function logFeedbackReport(level: FeedbackLogLevel, message: string, details?: unknown): void {
  const safeMessage = redactDiagnosticTextToUtf8Bytes(message, 4 * 1024);
  const safeDetails = details === undefined ? undefined : redactDiagnosticValue(normalizeLogDetails(details));
  const consoleMessage = `${LOG_PREFIX} ${safeMessage}`;
  if (level === 'error') {
    console.error(consoleMessage, safeDetails);
  } else if (level === 'warn') {
    console.warn(consoleMessage, safeDetails);
  } else {
    console.info(consoleMessage, safeDetails);
  }

  try {
    window.electronAPI?.logFeedbackEvent?.({
      level,
      message: safeMessage,
      details: safeDetails,
    });
  } catch {
    // Renderer console logging above is the fallback.
  }
}

async function collectLogAttachment(): Promise<{
  attachment: FeedbackAttachment | null;
  status: FeedbackLogAttachmentStatus;
}> {
  try {
    const electronAPI = typeof window === 'undefined' ? undefined : window.electronAPI;
    if (!electronAPI?.collectFeedbackLogs) {
      return { attachment: null, status: 'unavailable' };
    }

    const logData = await electronAPI?.collectFeedbackLogs?.();
    if (!logData) {
      return { attachment: null, status: 'empty' };
    }

    return {
      attachment: {
        filename: logData.filename,
        data: new Uint8Array(logData.data),
        contentType: 'application/gzip',
      },
      status: 'collected',
    };
  } catch {
    return { attachment: null, status: 'failed' };
  }
}

async function collectDbDiagnosticsAttachment(request: FeedbackDiagnosticsContextInput): Promise<{
  attachment: FeedbackAttachment | null;
  status: FeedbackDbDiagnosticsAttachmentStatus;
}> {
  try {
    if (typeof fetch === 'undefined') {
      return { attachment: null, status: 'unavailable' };
    }

    const diagnostics = await httpRequest<unknown>('GET', buildFeedbackDiagnosticsPath(request), undefined, {
      silentStatuses: [400, 401, 403, 404, 500, 502, 503, 504],
    });
    if (!diagnostics) {
      return { attachment: null, status: 'empty' };
    }
    const payload = await encodeDiagnosticsAttachmentPayload(diagnostics);

    return {
      attachment: {
        filename: payload.filename,
        data: payload.data,
        contentType: payload.contentType,
      },
      status: 'collected',
    };
  } catch {
    return { attachment: null, status: 'failed' };
  }
}

function buildFeedbackDiagnosticsPath(request: FeedbackDiagnosticsContextInput): string {
  const params = new URLSearchParams();
  appendQueryParam(params, 'route_at_open', request.routeAtOpen);
  appendQueryParam(params, 'route_at_submit', request.routeAtSubmit);
  appendQueryParam(params, 'selected_module', request.selectedModule);
  appendQueryParam(params, 'profiles', request.explicitProfiles?.join(','));
  appendQueryParam(params, 'conversation_id', request.explicitContext?.conversationId);
  appendQueryParam(params, 'provider_id', request.explicitContext?.providerId);
  appendQueryParam(params, 'agent_id', request.explicitContext?.agentId);
  appendQueryParam(params, 'team_id', request.explicitContext?.teamId);
  appendQueryParam(params, 'mcp_server_id', request.explicitContext?.mcpServerId);

  const query = params.toString();
  return query ? `/api/system/diagnostics/feedback-report?${query}` : '/api/system/diagnostics/feedback-report';
}

function appendQueryParam(params: URLSearchParams, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    params.set(key, trimmed);
  }
}

async function encodeDiagnosticsAttachmentPayload(value: unknown): Promise<FeedbackDiagnosticsAttachmentPayload> {
  const sanitized = redactDiagnosticValue(value);
  const data = new TextEncoder().encode(JSON.stringify(sanitized, null, 2));
  if (data.byteLength > MAX_DB_DIAGNOSTICS_BYTES) {
    throw new Error('Feedback diagnostics attachment exceeds size limit');
  }
  try {
    if (typeof CompressionStream !== 'function') {
      return {
        filename: 'db-diagnostics.json',
        data,
        contentType: 'application/json',
      };
    }

    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return {
      filename: 'db-diagnostics.json.gz',
      data: compressed,
      contentType: 'application/gzip',
    };
  } catch {
    return {
      filename: 'db-diagnostics.json',
      data,
      contentType: 'application/json',
    };
  }
}

function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ');
}

function buildSummary(moduleLabel: string, description: string): string {
  const summaryPreview =
    description.length > SUMMARY_PREVIEW_LENGTH
      ? `${description.slice(0, SUMMARY_PREVIEW_LENGTH).trimEnd()}...`
      : description;
  return `${moduleLabel}: ${summaryPreview}`;
}

function sanitizeTagValue(value: string): string {
  const redacted = redactDiagnosticText(value, MAX_TAG_VALUE_LENGTH);
  if (redacted.length <= MAX_TAG_VALUE_LENGTH) return redacted;

  return `${redacted.slice(0, MAX_TAG_VALUE_LENGTH - DIAGNOSTIC_TRUNCATION_MARKER.length)}${DIAGNOSTIC_TRUNCATION_MARKER}`;
}

function getUint8ArrayByteLength(data: unknown): number | null {
  if (!(data instanceof Uint8Array) || !typedArrayByteLengthGetter) return null;

  try {
    const byteLength = typedArrayByteLengthGetter.call(data);
    return typeof byteLength === 'number' ? byteLength : null;
  } catch {
    return null;
  }
}

function snapshotUint8Array(data: unknown, byteLength: number): Uint8Array<ArrayBuffer> | null {
  if (!(data instanceof Uint8Array)) return null;

  try {
    const snapshot = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(snapshot, data);
    return snapshot;
  } catch {
    return null;
  }
}

function selectUserScreenshot(attachment: unknown): FeedbackAttachment | null {
  if (!attachment || typeof attachment !== 'object') return null;

  try {
    const candidate = attachment as Partial<FeedbackAttachment>;
    const { contentType, data, filename } = candidate;
    const byteLength = getUint8ArrayByteLength(data);
    if (
      contentType !== 'image/png' ||
      typeof filename !== 'string' ||
      RESERVED_AUTOMATIC_ATTACHMENT_FILENAMES.has(filename) ||
      byteLength === null ||
      byteLength === 0 ||
      byteLength > MAX_SCREENSHOT_BYTES
    ) {
      return null;
    }

    const snapshot = snapshotUint8Array(data, byteLength);
    return snapshot ? { contentType, data: snapshot, filename } : null;
  } catch {
    return null;
  }
}

function selectUserScreenshots(attachments: unknown): FeedbackAttachment[] {
  try {
    if (!Array.isArray(attachments)) return [];
  } catch {
    return [];
  }

  let length: number;
  try {
    length = attachments.length;
  } catch {
    return [];
  }
  if (!Number.isSafeInteger(length) || length < 0) return [];

  const screenshots: FeedbackAttachment[] = [];
  const inspectedLength = Math.min(length, MAX_ATTACHMENT_CANDIDATES);
  for (let index = 0; index < inspectedLength && screenshots.length < MAX_SCREENSHOTS; index++) {
    try {
      const screenshot = selectUserScreenshot(attachments[index]);
      if (screenshot) screenshots.push(screenshot);
    } catch {
      // Continue evaluating later callers after an inaccessible array index.
    }
  }
  return screenshots;
}

export async function submitFeedbackReport(input: SubmitFeedbackReportInput): Promise<void> {
  const attachments = selectUserScreenshots(input.attachments ?? []);
  let eventId: string | undefined;
  let logAttachmentStatus: FeedbackLogAttachmentStatus = input.collectLogs ? 'empty' : 'skipped';
  let logAttachment: FeedbackAttachment | null = null;
  let dbDiagnosticsAttachmentStatus: FeedbackDbDiagnosticsAttachmentStatus = input.collectDbDiagnostics
    ? 'empty'
    : 'skipped';
  let dbDiagnosticsAttachment: FeedbackAttachment | null = null;

  try {
    if (input.collectLogs) {
      const collectedLogAttachment = await collectLogAttachment();
      logAttachmentStatus = collectedLogAttachment.status;
      logAttachment = collectedLogAttachment.attachment;
      if (logAttachment) {
        attachments.unshift(logAttachment);
      }
    }

    if (input.collectDbDiagnostics) {
      const collectedDbDiagnosticsAttachment = await collectDbDiagnosticsAttachment(input.collectDbDiagnostics);
      dbDiagnosticsAttachmentStatus = collectedDbDiagnosticsAttachment.status;
      dbDiagnosticsAttachment = collectedDbDiagnosticsAttachment.attachment;
      if (dbDiagnosticsAttachment) {
        attachments.unshift(dbDiagnosticsAttachment);
      }
    }

    const normalizedDescription = normalizeDescription(input.description);
    const eventSummary = buildSummary(input.moduleLabel, normalizedDescription);
    const sanitizedExtra = redactDiagnosticValue(input.extra ?? {});
    const safeExtra =
      sanitizedExtra && typeof sanitizedExtra === 'object' && !Array.isArray(sanitizedExtra)
        ? (sanitizedExtra as FeedbackEventExtra)
        : {};
    const Sentry = await import('@sentry/electron/renderer');

    Sentry.withScope((scope) => {
      scope.setTag('type', 'user-feedback');
      scope.setTag('module', sanitizeTagValue(input.module));
      Object.entries(input.tags ?? {}).forEach(([key, value]) => {
        if (value.trim()) {
          scope.setTag(key, sanitizeTagValue(value));
        }
      });

      eventId = Sentry.captureEvent(
        {
          level: 'info',
          message: eventSummary,
          extra: {
            ...safeExtra,
            description: normalizedDescription,
          },
        },
        { attachments }
      );
    });

    if (input.flushTimeoutMs !== undefined) {
      const client = Sentry.getClient();
      if (!client) {
        throw new Error(`Failed to flush feedback report${eventId ? ` (${eventId})` : ''}: Sentry is not initialized`);
      }

      const flushed = await client.flush(input.flushTimeoutMs);
      if (!flushed) {
        throw new Error(`Failed to flush feedback report${eventId ? ` (${eventId})` : ''}`);
      }
    }

    logFeedbackReport('info', 'submitted', {
      module: input.module,
      eventId,
      collectLogs: Boolean(input.collectLogs),
      logAttachment: summarizeLogAttachment(logAttachmentStatus, logAttachment),
      dbDiagnosticsAttachment: summarizeDbDiagnosticsAttachment(dbDiagnosticsAttachmentStatus, dbDiagnosticsAttachment),
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
      flushTimeoutMs: input.flushTimeoutMs,
      tagKeys: Object.keys(input.tags ?? {}),
    });
  } catch (error) {
    logFeedbackReport('error', 'failed', {
      module: input.module,
      eventId,
      collectLogs: Boolean(input.collectLogs),
      logAttachment: summarizeLogAttachment(logAttachmentStatus, logAttachment),
      dbDiagnosticsAttachment: summarizeDbDiagnosticsAttachment(dbDiagnosticsAttachmentStatus, dbDiagnosticsAttachment),
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
      flushTimeoutMs: input.flushTimeoutMs,
      error,
    });
    throw error;
  }
}
