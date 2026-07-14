/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IPC handler for collecting and compressing recent log files
 * for the bug report feature.
 */

import { app, ipcMain } from 'electron';
import type { BrowserWindow, WebContents } from 'electron';
import * as path from 'path';
import {
  DIAGNOSTIC_TRUNCATION_MARKER,
  redactDiagnosticText,
  redactDiagnosticValue,
} from '@/common/utils/diagnosticRedaction';
import { collectFeedbackLogAttachment } from '../feedback/logs';

const MAX_RENDERER_LOG_BYTES = 64 * 1024;
const MAX_RENDERER_MESSAGE_LENGTH = 4 * 1024;
const MAX_RENDERER_DETAILS_LENGTH = 32 * 1024;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

type RendererFeedbackLogPayload = {
  details?: unknown;
  level: 'info' | 'warn' | 'error';
  message: string;
};

let feedbackWindow: BrowserWindow | null = null;

export function initFeedbackBridgeWithWindow(win: BrowserWindow): () => void {
  feedbackWindow = win;
  const dispose = (): void => {
    if (feedbackWindow === win) feedbackWindow = null;
  };
  win.once('closed', dispose);
  return dispose;
}

function isAuthorizedSender(sender: WebContents): boolean {
  return Boolean(
    feedbackWindow &&
    !feedbackWindow.isDestroyed() &&
    !feedbackWindow.webContents.isDestroyed() &&
    feedbackWindow.webContents === sender
  );
}

function assertAuthorizedSender(sender: WebContents): void {
  if (!isAuthorizedSender(sender)) throw new Error('Feedback request rejected');
}

function parseRendererFeedbackLogPayload(payload: unknown): RendererFeedbackLogPayload | null {
  if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > MAX_RENDERER_LOG_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const level = record.level === 'warn' || record.level === 'error' ? record.level : 'info';
  const message = redactDiagnosticText(
    typeof record.message === 'string' && record.message.trim() ? record.message : 'feedback log',
    MAX_RENDERER_MESSAGE_LENGTH
  );
  const sanitizedDetails = redactDiagnosticValue(record.details, { maxStringLength: MAX_RENDERER_DETAILS_LENGTH });
  const detailsJson = JSON.stringify(sanitizedDetails);

  return {
    level,
    message,
    ...(record.details !== undefined
      ? {
          details:
            Buffer.byteLength(detailsJson, 'utf8') <= MAX_RENDERER_DETAILS_LENGTH
              ? sanitizedDetails
              : DIAGNOSTIC_TRUNCATION_MARKER,
        }
      : {}),
  };
}

ipcMain.on('feedback:renderer-log', (event, payload: unknown) => {
  if (!isAuthorizedSender(event.sender)) {
    console.warn('[feedbackBridge] Rejected renderer log: unauthorized sender');
    return;
  }

  const log = parseRendererFeedbackLogPayload(payload);
  if (!log) {
    console.warn('[feedbackBridge] Rejected renderer log: invalid payload');
    return;
  }

  const args: unknown[] = [`[FeedbackReport:renderer] ${log.message}`];
  if (log.details !== undefined) {
    args.push(log.details);
  }

  if (log.level === 'error') {
    console.error(...args);
  } else if (log.level === 'warn') {
    console.warn(...args);
  } else {
    console.info(...args);
  }
});

ipcMain.handle('feedback:collect-logs', async (event) => {
  assertAuthorizedSender(event.sender);

  try {
    let logsDir: string;
    try {
      logsDir = app.getPath('logs');
    } catch {
      logsDir = path.join(app.getPath('userData'), 'logs');
    }

    const logDirs = [logsDir, path.join(logsDir, 'logs')];
    const attachment = collectFeedbackLogAttachment(logDirs);
    if (!attachment) return null;

    // Return as number array for IPC serialization (Buffer is not serializable)
    return {
      filename: attachment.filename,
      data: Array.from(attachment.data),
    };
  } catch (error) {
    console.error('[feedbackBridge] Failed to collect logs:', error);
    return null;
  }
});

ipcMain.handle('feedback:capture-screenshot', async (event) => {
  assertAuthorizedSender(event.sender);

  try {
    const win = feedbackWindow;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return null;
    }

    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    if (!png || png.length === 0 || png.length > MAX_SCREENSHOT_BYTES) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return {
      filename: `screenshot-${timestamp}.png`,
      data: Array.from(png),
    };
  } catch (error) {
    console.error('[feedbackBridge] Failed to capture screenshot:', error);
    return null;
  }
});
