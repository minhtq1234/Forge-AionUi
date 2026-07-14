/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Node-environment tests for feedbackBridge's IPC handlers.
 * Covers the new feedback:capture-screenshot handler (main-process side).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { app } from 'electron';
import { DIAGNOSTIC_TRUNCATION_MARKER } from '@/common/utils/diagnosticRedaction';
import { collectFeedbackLogAttachment } from '@/process/feedback/logs';

const { handlers, eventHandlers, exposedMainWorld, ipcRenderer } = vi.hoisted(() => ({
  eventHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  exposedMainWorld: new Map<string, unknown>(),
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  ipcRenderer: {
    invoke: vi.fn(),
    off: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    sendSync: vi.fn(),
  },
}));

type FakeWebContents = {
  capturePage?: () => Promise<{ toPNG: () => Buffer }>;
  isDestroyed: () => boolean;
};

type FakeWindow = {
  isDestroyed: () => boolean;
  once: (event: string, callback: () => void) => void;
  webContents: FakeWebContents;
};

type FakeWindowFixture = {
  close: () => void;
  window: FakeWindow;
};

type ExposedElectronApi = {
  logFeedbackEvent: (payload: { details?: unknown; level: 'info' | 'warn' | 'error'; message: string }) => void;
};

function createFakeWindow(webContents: FakeWebContents = { isDestroyed: () => false }): FakeWindowFixture {
  let closedCallback: (() => void) | undefined;
  const window: FakeWindow = {
    isDestroyed: () => false,
    once: vi.fn((event: string, callback: () => void) => {
      if (event === 'closed') closedCallback = callback;
    }),
    webContents,
  };

  return {
    close: () => {
      if (!closedCallback) throw new Error('Expected a closed callback');
      closedCallback();
    },
    window,
  };
}

function createSizedAsciiLog(prefix: string, byteLength: number): string {
  const remainingBytes = byteLength - Buffer.byteLength(prefix, 'utf8');
  const line = `${'x'.repeat(1023)}\n`;
  return `${prefix}${line.repeat(Math.floor(remainingBytes / line.length))}${'x'.repeat(remainingBytes % line.length)}`;
}

const allowedWindow: FakeWindow = {
  isDestroyed: () => false,
  once: vi.fn(),
  webContents: {
    isDestroyed: () => false,
  },
};

const foreignSender: FakeWebContents = {
  isDestroyed: () => false,
};

let initFeedbackBridgeWithWindow: typeof import('@/process/bridge/feedbackBridge').initFeedbackBridgeWithWindow;

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => eventHandlers.set(channel, fn),
  },
  app: {
    getPath: vi.fn(() => '/tmp/aionui-test-logs-nonexistent'),
    getVersion: vi.fn(() => '0.0.0'),
  },
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => exposedMainWorld.set(key, value),
  },
  ipcRenderer,
  webUtils: {
    getPathForFile: vi.fn(),
  },
}));

vi.mock('@sentry/electron/preload', () => ({}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    closeSync: vi.fn(actual.closeSync),
    fstatSync: vi.fn(actual.fstatSync),
    openSync: vi.fn(actual.openSync),
    readSync: vi.fn(actual.readSync),
  };
});

beforeEach(async () => {
  handlers.clear();
  eventHandlers.clear();
  exposedMainWorld.clear();
  vi.resetModules();
  ({ initFeedbackBridgeWithWindow } = await import('@/process/bridge/feedbackBridge'));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('feedbackBridge — capture-screenshot', () => {
  it('registers the feedback:capture-screenshot channel on import', () => {
    expect(handlers.has('feedback:capture-screenshot')).toBe(true);
  });

  it('returns png bytes and a timestamped filename on success', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);
    allowedWindow.webContents.capturePage = vi.fn(async () => ({ toPNG: () => pngBytes }));
    initFeedbackBridgeWithWindow(allowedWindow as never);

    const handler = handlers.get('feedback:capture-screenshot')!;
    const result = (await handler({ sender: allowedWindow.webContents })) as {
      filename: string;
      data: number[];
    } | null;

    expect(result).not.toBeNull();
    expect(result!.filename).toMatch(/^screenshot-.*\.png$/);
    expect(result!.data).toEqual(Array.from(pngBytes));
  });

  it('rejects screenshot capture from a foreign sender', async () => {
    initFeedbackBridgeWithWindow(allowedWindow as never);
    const handler = handlers.get('feedback:capture-screenshot')!;
    await expect(handler({ sender: foreignSender })).rejects.toThrow('Feedback request rejected');
  });

  it('rejects screenshot capture when the registered window is destroyed', async () => {
    const destroyedWindow: FakeWindow = {
      isDestroyed: () => true,
      once: vi.fn(),
      webContents: {
        capturePage: vi.fn(),
        isDestroyed: () => false,
      },
    };
    initFeedbackBridgeWithWindow(destroyedWindow as never);
    const handler = handlers.get('feedback:capture-screenshot')!;
    await expect(handler({ sender: destroyedWindow.webContents })).rejects.toThrow('Feedback request rejected');
    expect(destroyedWindow.webContents.capturePage).not.toHaveBeenCalled();
  });

  it('rejects screenshot capture when the registered webContents is destroyed', async () => {
    const destroyedWebContents: FakeWebContents = {
      capturePage: vi.fn(),
      isDestroyed: () => true,
    };
    const window = createFakeWindow(destroyedWebContents);
    initFeedbackBridgeWithWindow(window.window as never);

    const handler = handlers.get('feedback:capture-screenshot')!;
    await expect(handler({ sender: destroyedWebContents })).rejects.toThrow('Feedback request rejected');
    expect(destroyedWebContents.capturePage).not.toHaveBeenCalled();
  });

  it('returns null when capturePage yields an empty buffer', async () => {
    allowedWindow.webContents.capturePage = vi.fn(async () => ({ toPNG: () => Buffer.alloc(0) }));
    initFeedbackBridgeWithWindow(allowedWindow as never);

    const handler = handlers.get('feedback:capture-screenshot')!;
    const result = await handler({ sender: allowedWindow.webContents });
    expect(result).toBeNull();
  });

  it('returns null when capturePage yields a png larger than 10 MiB', async () => {
    allowedWindow.webContents.capturePage = vi.fn(async () => ({ toPNG: () => Buffer.alloc(10 * 1024 * 1024 + 1) }));
    initFeedbackBridgeWithWindow(allowedWindow as never);

    const handler = handlers.get('feedback:capture-screenshot')!;
    const result = await handler({ sender: allowedWindow.webContents });
    expect(result).toBeNull();
  });

  it('accepts a png exactly 10 MiB in size', async () => {
    const png = Buffer.alloc(10 * 1024 * 1024);
    allowedWindow.webContents.capturePage = vi.fn(async () => ({ toPNG: () => png }));
    initFeedbackBridgeWithWindow(allowedWindow as never);

    const handler = handlers.get('feedback:capture-screenshot')!;
    const result = (await handler({ sender: allowedWindow.webContents })) as { data: number[] } | null;
    expect(result?.data).toHaveLength(png.length);
  });

  it('returns null and does not throw when capturePage rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    allowedWindow.webContents.capturePage = vi.fn(async () => {
      throw new Error('capture refused');
    });
    initFeedbackBridgeWithWindow(allowedWindow as never);

    const handler = handlers.get('feedback:capture-screenshot')!;
    const result = await handler({ sender: allowedWindow.webContents });
    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('feedback logs', () => {
  it('rejects log collection from an unregistered sender', async () => {
    const handler = handlers.get('feedback:collect-logs')!;
    await expect(handler({ sender: foreignSender })).rejects.toThrow('Feedback request rejected');
  });

  it('rejects log collection from a foreign sender while a window is registered', async () => {
    initFeedbackBridgeWithWindow(allowedWindow as never);
    const handler = handlers.get('feedback:collect-logs')!;
    await expect(handler({ sender: foreignSender })).rejects.toThrow('Feedback request rejected');
  });

  it('removes authorization after the registered window closes', async () => {
    const fixture = createFakeWindow();
    initFeedbackBridgeWithWindow(fixture.window as never);
    fixture.close();

    const handler = handlers.get('feedback:collect-logs')!;
    await expect(handler({ sender: fixture.window.webContents })).rejects.toThrow('Feedback request rejected');
  });

  it('keeps a newer registration when an older window closes late', async () => {
    const older = createFakeWindow();
    const newer = createFakeWindow();
    initFeedbackBridgeWithWindow(older.window as never);
    initFeedbackBridgeWithWindow(newer.window as never);
    older.close();

    const handler = handlers.get('feedback:collect-logs')!;
    await expect(handler({ sender: newer.window.webContents })).resolves.toBeNull();
  });

  it('collects top-level frontend logs and nested backend logs through the IPC handler', async () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'aionui-feedback-bridge-'));
    try {
      const backendLogsDir = path.join(logsDir, 'logs');
      mkdirSync(backendLogsDir);
      writeFileSync(path.join(logsDir, '2026-05-25.log'), 'frontend renderer log\n');
      writeFileSync(path.join(backendLogsDir, '2026-05-25.log'), 'backend process log\n');
      writeFileSync(path.join(backendLogsDir, '2026-05-24.log'), 'second day backend log\n');
      writeFileSync(path.join(backendLogsDir, '2026-05-23.log'), 'third day backend log\n');
      writeFileSync(path.join(backendLogsDir, '2026-05-22.log'), 'too old backend log\n');

      vi.mocked(app.getPath).mockImplementation((name: string) => {
        if (name === 'logs') return logsDir;
        return path.join(logsDir, 'userData');
      });

      initFeedbackBridgeWithWindow(allowedWindow as never);
      const handler = handlers.get('feedback:collect-logs')!;
      const result = (await handler({ sender: allowedWindow.webContents })) as {
        filename: string;
        data: number[];
      } | null;

      expect(result).not.toBeNull();
      const content = gunzipSync(Buffer.from(result!.data)).toString('utf8');
      expect(content).toContain('frontend renderer log');
      expect(content).toContain('backend process log');
      expect(content).toContain('second day backend log');
      expect(content).toContain('third day backend log');
      expect(content).not.toContain('too old backend log');
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('collects the same recent three log days used by user feedback reports', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'aionui-feedback-logs-'));
    try {
      writeFileSync(path.join(logsDir, '2026-05-25.log'), 'today frontend\n');
      writeFileSync(path.join(logsDir, '2026-05-25.aioncore.log'), 'today backend\n');
      writeFileSync(path.join(logsDir, '2026-05-24.aionrs.log'), 'yesterday rust\n');
      writeFileSync(path.join(logsDir, '2026-05-23.log'), 'third day frontend\n');
      writeFileSync(path.join(logsDir, '2026-05-22.log'), 'too old frontend\n');
      writeFileSync(path.join(logsDir, '2026-05-25.txt'), 'not a log\n');

      const attachment = collectFeedbackLogAttachment(logsDir);

      expect(attachment).not.toBeNull();
      expect(attachment!.filename).toBe('logs.gz');
      expect(attachment!.contentType).toBe('application/gzip');
      const content = gunzipSync(attachment!.data).toString('utf8');
      expect(content).toContain('today frontend');
      expect(content).toContain('today backend');
      expect(content).toContain('yesterday rust');
      expect(content).toContain('third day frontend');
      expect(content).not.toContain('too old frontend');
      expect(content).not.toContain('not a log');
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('collects recent logs from dated year/month/day directories', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'aionui-feedback-dated-logs-'));
    try {
      const recentDir = path.join(logsDir, '2026', '07', '02');
      const previousDir = path.join(logsDir, '2026', '07', '01');
      const oldDir = path.join(logsDir, '2026', '06', '30');
      mkdirSync(recentDir, { recursive: true });
      mkdirSync(previousDir, { recursive: true });
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(path.join(recentDir, '2026-07-02.log'), 'today frontend nested\n');
      writeFileSync(path.join(recentDir, '2026-07-02.aioncore.log'), 'today backend nested\n');
      writeFileSync(path.join(previousDir, '2026-07-01.aionrs.log'), 'yesterday rust nested\n');
      writeFileSync(path.join(oldDir, '2026-06-30.log'), 'third day frontend nested\n');
      writeFileSync(path.join(logsDir, '2026-06-29.log'), 'too old flat\n');

      const attachment = collectFeedbackLogAttachment(logsDir);

      expect(attachment).not.toBeNull();
      const content = gunzipSync(attachment!.data).toString('utf8');
      expect(content).toContain('today frontend nested');
      expect(content).toContain('today backend nested');
      expect(content).toContain('yesterday rust nested');
      expect(content).toContain('third day frontend nested');
      expect(content).not.toContain('too old flat');
      expect(content).toContain('2026/07/02/2026-07-02.aioncore.log');
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('redacts secrets before compressing recent logs', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-redaction-'));
    try {
      writeFileSync(
        path.join(logsDir, '2026-07-14.log'),
        'provider=openai api_key=log-secret Authorization: Bearer bearer-secret status=401\n'
      );

      const attachment = collectFeedbackLogAttachment(logsDir);
      const content = gunzipSync(attachment!.data).toString('utf8');

      expect(content).toContain('provider=openai');
      expect(content).toContain('status=401');
      expect(content).not.toContain('log-secret');
      expect(content).not.toContain('bearer-secret');
      expect(content).toContain('[REDACTED]');
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('drops a partial first tail line before redacting a multibyte secret', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-partial-tail-'));
    try {
      const secret = 'secret-\u79d8\u5bc6-value';
      const firstLine = `Authorization: Bearer ${secret}\n`;
      const retainedLine = 'recent-safe-log-line\n';
      const tailOffset = Buffer.byteLength('Authorization: Bearer secret-\u79d8', 'utf8') + 1;
      const source = `${firstLine}${retainedLine}`;
      const maxFileBytes = Buffer.byteLength(source, 'utf8') - tailOffset;
      writeFileSync(path.join(logsDir, '2026-07-14.log'), source);

      const attachment = collectFeedbackLogAttachment(logsDir, { maxFileBytes });
      const content = gunzipSync(attachment!.data).toString('utf8');

      expect(content).toContain('recent-safe-log-line');
      expect(content).not.toContain('secret-');
      expect(content).not.toContain('\u79d8\u5bc6');
      expect(content).not.toContain('-value');
      expect(content).not.toContain('\uFFFD');
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('preserves only a numeric status after redacting authorization lines', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-authorization-status-'));
    try {
      writeFileSync(
        path.join(logsDir, '2026-07-14.log'),
        'Authorization: Bearer secret status=401 upstream_body=customer-token\n'
      );

      const attachment = collectFeedbackLogAttachment(logsDir);
      const content = gunzipSync(attachment!.data).toString('utf8');

      expect(content).toContain('status=401');
      expect(content).not.toContain('secret');
      expect(content).not.toContain('customer-token');
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('orders headers deterministically across dates and log roots', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-header-order-'));
    try {
      const alphaLogsDir = path.join(logsDir, 'alpha');
      const betaLogsDir = path.join(logsDir, 'beta');
      mkdirSync(alphaLogsDir);
      mkdirSync(betaLogsDir);
      writeFileSync(path.join(alphaLogsDir, '2026-07-14.aioncore.log'), 'alpha latest\n');
      writeFileSync(path.join(betaLogsDir, '2026-07-14.log'), 'beta latest\n');
      writeFileSync(path.join(alphaLogsDir, '2026-07-13.log'), 'alpha previous\n');
      writeFileSync(path.join(betaLogsDir, '2026-07-13.aionrs.log'), 'beta previous\n');

      const attachment = collectFeedbackLogAttachment([betaLogsDir, alphaLogsDir]);
      const content = gunzipSync(attachment!.data).toString('utf8');
      const headers = [...content.matchAll(/^=== (.+) ===$/gmu)].map((match) => match[1]);

      expect(headers).toEqual(['2026-07-14.aioncore.log', '2026-07-14.log', '2026-07-13.log', '2026-07-13.aionrs.log']);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('bounds the aggregate attachment with retained content and a byte-safe marker', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-aggregate-'));
    const limits = { maxAggregateBytes: 120, maxCandidateFiles: 2, maxFileBytes: 64 };
    try {
      writeFileSync(path.join(logsDir, '2026-07-14.aioncore.log'), 'first retained content\n');
      writeFileSync(path.join(logsDir, '2026-07-14.log'), '\u{1F4A5}'.repeat(16));

      const attachment = collectFeedbackLogAttachment(logsDir, limits);
      const content = gunzipSync(attachment!.data);
      const text = content.toString('utf8');

      expect(content.byteLength).toBe(limits.maxAggregateBytes);
      expect(text).toContain('first retained content');
      expect(text).toContain('[TRUNCATED: aggregate feedback log limit]');
      expect(text).not.toContain('\uFFFD');
      expect([...text.matchAll(/^=== (.+) ===$/gmu)].map((match) => match[1])).toEqual(['2026-07-14.aioncore.log']);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('limits default collection to twelve deterministic candidates', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-default-candidates-'));
    try {
      const roots = Array.from({ length: 13 }, (_, index) => {
        const root = path.join(logsDir, `root-${String(index).padStart(2, '0')}`);
        mkdirSync(root);
        writeFileSync(path.join(root, '2026-07-14.log'), `default-candidate-${String(index).padStart(2, '0')}\n`);
        return root;
      });

      const attachment = collectFeedbackLogAttachment(roots.toReversed());
      const content = gunzipSync(attachment!.data).toString('utf8');

      expect([...content.matchAll(/default-candidate-(\d+)/gmu)].map((match) => match[1])).toEqual(
        Array.from({ length: 12 }, (_, index) => String(index).padStart(2, '0'))
      );
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('uses the default one MiB bounded tail read through the collector', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-default-file-limit-'));
    const defaultFileBytes = 1024 * 1024;
    try {
      const leadingRecord = 'discarded-record\n';
      const retainedRecord = 'default-per-file-retained\n';
      const tail = createSizedAsciiLog(retainedRecord, defaultFileBytes);
      const logPath = path.join(logsDir, '2026-07-14.log');
      writeFileSync(logPath, `${leadingRecord}${tail}`);
      vi.clearAllMocks();

      const attachment = collectFeedbackLogAttachment(logsDir);
      const content = gunzipSync(attachment!.data).toString('utf8');
      const tailRead = fs.readSync.mock.calls.find(
        ([, buffer, offset, length, position]) =>
          buffer.length === defaultFileBytes &&
          offset === 0 &&
          length === defaultFileBytes &&
          position === Buffer.byteLength(leadingRecord, 'utf8')
      );

      expect(tailRead).toBeDefined();
      expect(content).toContain('[TRUNCATED: recent tail retained]');
      expect(content).toContain('default-per-file-retained');
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('uses the default four MiB aggregate limit with retained content and safe output', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-default-aggregate-'));
    const defaultFileBytes = 1024 * 1024;
    const defaultAggregateBytes = 4 * 1024 * 1024;
    try {
      const primaryLogsDir = path.join(logsDir, 'a-primary');
      const extraLogsDir = path.join(logsDir, 'b-extra');
      mkdirSync(primaryLogsDir);
      mkdirSync(extraLogsDir);
      const firstContent = 'default aggregate retained \u{1F4A5}\n';
      const fullFirstLog = createSizedAsciiLog(firstContent, defaultFileBytes);
      const fullLog = createSizedAsciiLog('', defaultFileBytes);
      writeFileSync(path.join(primaryLogsDir, '2026-07-14.aioncore.log'), fullFirstLog);
      writeFileSync(path.join(primaryLogsDir, '2026-07-14.aionrs.log'), fullLog);
      writeFileSync(path.join(primaryLogsDir, '2026-07-14.log'), fullLog);
      writeFileSync(path.join(extraLogsDir, '2026-07-14.log'), createSizedAsciiLog('', defaultFileBytes));

      const attachment = collectFeedbackLogAttachment([primaryLogsDir, extraLogsDir]);
      const content = gunzipSync(attachment!.data);
      const text = content.toString('utf8');

      expect(content.byteLength).toBe(defaultAggregateBytes);
      expect(text).toContain('default aggregate retained \u{1F4A5}');
      expect(text).toContain('[TRUNCATED: aggregate feedback log limit]');
      expect(text).not.toContain('\uFFFD');
      expect([...text.matchAll(/^=== (.+) ===$/gmu)].map((match) => match[1])).toEqual([
        '2026-07-14.aioncore.log',
        '2026-07-14.aionrs.log',
        '2026-07-14.log',
        '2026-07-14.log',
      ]);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('retains a complete first tail record after a %s boundary', (_name, lineBreak) => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-tail-boundary-'));
    try {
      const tail = `complete-first-record${lineBreak}complete-second-record${lineBreak}`;
      writeFileSync(path.join(logsDir, '2026-07-14.log'), `discarded-record${lineBreak}${tail}`);

      const attachment = collectFeedbackLogAttachment(logsDir, { maxFileBytes: Buffer.byteLength(tail, 'utf8') });
      const content = gunzipSync(attachment!.data).toString('utf8');

      expect(content).toContain('complete-first-record');
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('reads oversized logs through the collector with a bounded descriptor offset', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-bounded-read-'));
    try {
      const logPath = path.join(logsDir, '2026-07-14.log');
      writeFileSync(logPath, 'x'.repeat(96));
      vi.clearAllMocks();

      collectFeedbackLogAttachment(logsDir, { maxFileBytes: 32 });

      expect(fs.openSync).toHaveBeenCalledWith(logPath, 'r');
      expect(fs.fstatSync).toHaveBeenCalledOnce();
      expect(fs.readSync).toHaveBeenCalledWith(expect.any(Number), expect.any(Buffer), 0, 32, 64);
      const tailRead = fs.readSync.mock.calls.find(([, buffer, offset, length, position]) => {
        return buffer.length === 32 && offset === 0 && length === 32 && position === 64;
      });
      expect(tailRead?.[1]).toHaveLength(32);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it('closes a log descriptor when bounded metadata lookup throws', () => {
    const logsDir = mkdtempSync(path.join(tmpdir(), 'forge-feedback-close-descriptor-'));
    try {
      writeFileSync(path.join(logsDir, '2026-07-14.log'), 'log content\n');
      vi.clearAllMocks();
      vi.mocked(fs.fstatSync).mockImplementationOnce(() => {
        throw new Error('fstat failed');
      });

      expect(() => collectFeedbackLogAttachment(logsDir)).toThrow('fstat failed');

      expect(fs.openSync).toHaveBeenCalledOnce();
      expect(fs.closeSync).toHaveBeenCalledOnce();
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });
});

describe('feedbackBridge — renderer-log', () => {
  it('drops renderer logs from a foreign sender without echoing payload values', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initFeedbackBridgeWithWindow(allowedWindow as never);

    eventHandlers.get('feedback:renderer-log')?.(
      { sender: foreignSender },
      JSON.stringify({ level: 'error', message: 'secret-message' })
    );

    expect(warning).toHaveBeenCalledWith('[feedbackBridge] Rejected renderer log: unauthorized sender');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('secret-message');
  });

  it('drops malformed renderer log JSON without echoing payload values', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initFeedbackBridgeWithWindow(allowedWindow as never);

    eventHandlers.get('feedback:renderer-log')?.({ sender: allowedWindow.webContents }, '{secret-message');

    expect(warning).toHaveBeenCalledWith('[feedbackBridge] Rejected renderer log: invalid payload');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('secret-message');
  });

  it('redacts and bounds an authorized renderer log before writing it', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    initFeedbackBridgeWithWindow(allowedWindow as never);

    eventHandlers.get('feedback:renderer-log')?.(
      { sender: allowedWindow.webContents },
      JSON.stringify({
        level: 'error',
        message: 'x'.repeat(5_000),
        details: { api_key: 'renderer-secret', status: 401 },
      })
    );

    const serializedCalls = JSON.stringify(errorLog.mock.calls);
    expect(serializedCalls).not.toContain('renderer-secret');
    expect(serializedCalls).toContain('[REDACTED]');
    expect(serializedCalls).toContain('[TRUNCATED]');
  });

  it('drops a renderer log larger than 64 KiB before parsing', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initFeedbackBridgeWithWindow(allowedWindow as never);

    eventHandlers.get('feedback:renderer-log')?.(
      { sender: allowedWindow.webContents },
      JSON.stringify({ level: 'info', message: 'x'.repeat(65_536) })
    );

    expect(warning).toHaveBeenCalledWith('[feedbackBridge] Rejected renderer log: invalid payload');
  });

  it('measures a multibyte renderer log envelope in UTF-8 bytes', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initFeedbackBridgeWithWindow(allowedWindow as never);

    eventHandlers.get('feedback:renderer-log')?.(
      { sender: allowedWindow.webContents },
      JSON.stringify({ level: 'info', message: '💥'.repeat(16_385) })
    );

    expect(warning).toHaveBeenCalledWith('[feedbackBridge] Rejected renderer log: invalid payload');
  });

  it('bounds details whose serialized value exceeds 32 KiB', () => {
    const infoLog = vi.spyOn(console, 'info').mockImplementation(() => {});
    initFeedbackBridgeWithWindow(allowedWindow as never);

    eventHandlers.get('feedback:renderer-log')?.(
      { sender: allowedWindow.webContents },
      JSON.stringify({ level: 'info', message: 'feedback message', details: 'x'.repeat(32 * 1024 + 1) })
    );

    expect(infoLog).toHaveBeenCalledWith('[FeedbackReport:renderer] feedback message', DIAGNOSTIC_TRUNCATION_MARKER);
  });

  it('drops a valid JSON primitive renderer log payload', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initFeedbackBridgeWithWindow(allowedWindow as never);

    eventHandlers.get('feedback:renderer-log')?.({ sender: allowedWindow.webContents }, 'true');

    expect(warning).toHaveBeenCalledWith('[feedbackBridge] Rejected renderer log: invalid payload');
  });

  it('drops a valid JSON array renderer log payload', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initFeedbackBridgeWithWindow(allowedWindow as never);

    eventHandlers.get('feedback:renderer-log')?.({ sender: allowedWindow.webContents }, '[]');

    expect(warning).toHaveBeenCalledWith('[feedbackBridge] Rejected renderer log: invalid payload');
  });

  it('normalizes an unknown renderer log level to info', () => {
    const infoLog = vi.spyOn(console, 'info').mockImplementation(() => {});
    initFeedbackBridgeWithWindow(allowedWindow as never);

    eventHandlers.get('feedback:renderer-log')?.(
      { sender: allowedWindow.webContents },
      JSON.stringify({ level: 'debug', message: 'feedback message' })
    );

    expect(infoLog).toHaveBeenCalledWith('[FeedbackReport:renderer] feedback message');
  });
});

describe('preload feedback wire contract', () => {
  it('exposes an object-shaped logFeedbackEvent that sends serialized payloads', async () => {
    await import('@/preload/main');
    const api = exposedMainWorld.get('electronAPI') as ExposedElectronApi;

    expect(typeof api).toBe('object');
    expect(typeof api.logFeedbackEvent).toBe('function');

    const payload = { level: 'warn' as const, message: 'feedback message', details: { status: 401 } };
    api.logFeedbackEvent(payload);

    expect(ipcRenderer.send).toHaveBeenCalledWith('feedback:renderer-log', JSON.stringify(payload));
  });

  it('uses the serialized safe fallback when feedback payload serialization fails', async () => {
    await import('@/preload/main');
    const api = exposedMainWorld.get('electronAPI') as ExposedElectronApi;
    const details: { circular?: unknown } = {};
    details.circular = details;

    api.logFeedbackEvent({ level: 'error', message: 'feedback message', details });

    expect(ipcRenderer.send).toHaveBeenCalledWith(
      'feedback:renderer-log',
      JSON.stringify({ level: 'error', message: 'feedback diagnostic serialization failed' })
    );
  });
});
