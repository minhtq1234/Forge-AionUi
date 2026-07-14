import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIAGNOSTIC_REDACTION_MARKER, DIAGNOSTIC_TRUNCATION_MARKER } from '@/common/utils/diagnosticRedaction';
import {
  logFeedbackReport,
  submitFeedbackReport,
  type FeedbackAttachment,
  type FeedbackEventExtra,
} from '@/renderer/services/feedback/submitFeedbackReport';

const MAX_DB_DIAGNOSTICS_BYTES = 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const DB_DIAGNOSTICS_FILENAMES = ['db-diagnostics.json', 'db-diagnostics.json.gz'];

type CompressionMode = {
  expectedFilename: string;
  name: string;
  setup: () => void;
};

const compressionModes: CompressionMode[] = [
  {
    expectedFilename: 'db-diagnostics.json.gz',
    name: 'CompressionStream succeeds',
    setup: () => {},
  },
  {
    expectedFilename: 'db-diagnostics.json',
    name: 'CompressionStream is unavailable',
    setup: () => vi.stubGlobal('CompressionStream', undefined),
  },
  {
    expectedFilename: 'db-diagnostics.json',
    name: 'CompressionStream fails',
    setup: () =>
      vi.stubGlobal(
        'CompressionStream',
        class {
          constructor() {
            throw new Error('compression failed');
          }
        }
      ),
  },
];

const sentryMocks = vi.hoisted(() => {
  const setTag = vi.fn();
  const flush = vi.fn(async () => true);
  return {
    captureEvent: vi.fn(() => 'event-id'),
    flush,
    getClient: vi.fn(() => ({ flush })),
    setTag,
    withScope: vi.fn((callback: (scope: { setTag: typeof setTag }) => void) => {
      callback({ setTag });
    }),
  };
});

vi.mock('@sentry/electron/renderer', () => sentryMocks);

type CapturedFeedbackEvent = {
  extra: FeedbackEventExtra;
  level: string;
  message: string;
};

function getCapturedFeedbackEvent(): CapturedFeedbackEvent {
  const [event] = sentryMocks.captureEvent.mock.calls.at(-1) as [CapturedFeedbackEvent];
  return event;
}

function getCapturedAttachments(): FeedbackAttachment[] {
  const [, options] = sentryMocks.captureEvent.mock.calls.at(-1) as [unknown, { attachments: FeedbackAttachment[] }];
  return options.attachments;
}

function findDbDiagnosticsAttachment(): FeedbackAttachment {
  const attachment = getCapturedAttachments().find((candidate) =>
    DB_DIAGNOSTICS_FILENAMES.includes(candidate.filename)
  );
  if (!attachment) throw new Error('Expected DB diagnostics attachment');
  return attachment;
}

function getDbDiagnosticsAttachments(): FeedbackAttachment[] {
  return getCapturedAttachments().filter((attachment) => DB_DIAGNOSTICS_FILENAMES.includes(attachment.filename));
}

function readJsonAttachment(attachment: FeedbackAttachment): unknown {
  const content =
    attachment.contentType === 'application/gzip'
      ? gunzipSync(attachment.data).toString('utf8')
      : new TextDecoder().decode(attachment.data);
  return JSON.parse(content);
}

function createDiagnosticsAtByteLength(byteLength: number): { entries: string[] } {
  const fullEntry = '#'.repeat(16_384);
  const entries = Array.from({ length: 64 }, () => fullEntry);
  const encoder = new TextEncoder();
  const serializedLength = encoder.encode(JSON.stringify({ entries }, null, 2)).byteLength;
  const jsonOverhead = serializedLength - entries.reduce((total, entry) => total + entry.length, 0);
  const finalEntryLength = byteLength - jsonOverhead - fullEntry.length * (entries.length - 1);

  if (finalEntryLength < 0 || finalEntryLength > fullEntry.length) {
    throw new Error(`Cannot create diagnostics payload with ${byteLength} bytes`);
  }

  entries[entries.length - 1] = '#'.repeat(finalEntryLength);
  return { entries };
}

function stubDbDiagnosticsResponse(diagnostics: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: diagnostics }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );
}

async function submitDbDiagnostics(): Promise<void> {
  await submitFeedbackReport({
    collectDbDiagnostics: { selectedModule: 'conversation-session' },
    description: 'Conversation stuck',
    module: 'conversation-session',
    moduleLabel: 'Conversation & Sessions',
  });
}

describe('submitFeedbackReport', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sentryMocks.captureEvent.mockClear();
    sentryMocks.captureEvent.mockReturnValue('event-id');
    sentryMocks.flush.mockClear();
    sentryMocks.flush.mockResolvedValue(true);
    sentryMocks.getClient.mockClear();
    sentryMocks.getClient.mockReturnValue({ flush: sentryMocks.flush });
    sentryMocks.setTag.mockClear();
    sentryMocks.withScope.mockClear();
    vi.stubGlobal('window', { electronAPI: undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('redacts renderer feedback diagnostics before console and IPC logging', () => {
    const logFeedbackEvent = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('window', { electronAPI: { logFeedbackEvent } });

    logFeedbackReport('error', 'failed token=message-secret', {
      api_key: 'details-secret',
      error: new Error('Authorization: Bearer error-secret'),
    });

    const emitted = JSON.stringify(logFeedbackEvent.mock.calls);
    const logged = JSON.stringify(consoleError.mock.calls);
    for (const secret of ['message-secret', 'details-secret', 'error-secret']) {
      expect(emitted).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    expect(logFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ api_key: DIAGNOSTIC_REDACTION_MARKER }),
        message: expect.stringContaining(DIAGNOSTIC_REDACTION_MARKER),
      })
    );
    consoleError.mockRestore();
  });

  for (const compressionMode of compressionModes) {
    it(`redacts DB diagnostics when ${compressionMode.name}`, async () => {
      compressionMode.setup();
      stubDbDiagnosticsResponse({
        schema_version: 'feedback-diagnostics/v1',
        provider: { api_key: 'db-secret', name: 'openai' },
        error: 'Authorization: Bearer db-bearer-secret',
      });

      await submitDbDiagnostics();

      const attachment = findDbDiagnosticsAttachment();
      const diagnostics = JSON.stringify(readJsonAttachment(attachment));
      expect(attachment.filename).toBe(compressionMode.expectedFilename);
      expect(diagnostics).toContain('openai');
      expect(diagnostics).toContain(DIAGNOSTIC_REDACTION_MARKER);
      expect(diagnostics).not.toContain('db-secret');
      expect(diagnostics).not.toContain('db-bearer-secret');
    });

    it(`keeps exactly 1 MiB DB diagnostics when ${compressionMode.name}`, async () => {
      compressionMode.setup();
      const diagnostics = createDiagnosticsAtByteLength(MAX_DB_DIAGNOSTICS_BYTES);
      expect(new TextEncoder().encode(JSON.stringify(diagnostics, null, 2))).toHaveLength(MAX_DB_DIAGNOSTICS_BYTES);
      stubDbDiagnosticsResponse(diagnostics);

      await submitDbDiagnostics();

      expect(findDbDiagnosticsAttachment().filename).toBe(compressionMode.expectedFilename);
    });

    it(`omits over-limit DB diagnostics when ${compressionMode.name}`, async () => {
      compressionMode.setup();
      stubDbDiagnosticsResponse(createDiagnosticsAtByteLength(MAX_DB_DIAGNOSTICS_BYTES + 1));

      await expect(submitDbDiagnostics()).resolves.toBeUndefined();

      expect(getDbDiagnosticsAttachments()).toHaveLength(0);
    });
  }

  it('redacts and bounds tags while retaining safe tag values', async () => {
    await submitFeedbackReport({
      description: 'Tag sanitization',
      module: 'conversation-session',
      moduleLabel: 'Conversation & Sessions',
      tags: {
        authorization: 'Bearer tag-secret',
        exact_limit: 'a'.repeat(1024),
        provider: 'openai',
        too_long: 'x'.repeat(1025),
      },
    });

    expect(sentryMocks.setTag).toHaveBeenCalledWith('provider', 'openai');
    expect(sentryMocks.setTag).toHaveBeenCalledWith('authorization', `Bearer ${DIAGNOSTIC_REDACTION_MARKER}`);
    expect(sentryMocks.setTag).toHaveBeenCalledWith('exact_limit', 'a'.repeat(1024));
    expect(sentryMocks.setTag).toHaveBeenCalledWith(
      'too_long',
      `${'x'.repeat(1024 - DIAGNOSTIC_TRUNCATION_MARKER.length)}${DIAGNOSTIC_TRUNCATION_MARKER}`
    );
    expect(sentryMocks.setTag.mock.calls.find(([key]) => key === 'exact_limit')?.[1]).toHaveLength(1024);
    expect(sentryMocks.setTag.mock.calls.find(([key]) => key === 'too_long')?.[1]).toHaveLength(1024);
  });

  it('redacts extra fields while preserving the normalized user description over extra.description', async () => {
    await submitFeedbackReport({
      description: '  I deliberately wrote token=keep-this-text  ',
      extra: {
        api_key: 'extra-secret',
        description: 'extra description must not replace feedback',
        status: 401,
      },
      module: 'conversation-session',
      moduleLabel: 'Conversation & Sessions',
    });

    expect(getCapturedFeedbackEvent().extra).toEqual({
      api_key: DIAGNOSTIC_REDACTION_MARKER,
      description: 'I deliberately wrote token=keep-this-text',
      status: 401,
    });
  });

  it('keeps only the first three non-empty PNG screenshots within the 10 MiB boundary', async () => {
    const acceptedBoundary = new Uint8Array(MAX_SCREENSHOT_BYTES);
    const rejectedOverLimit = new Uint8Array(MAX_SCREENSHOT_BYTES + 1);
    const screenshots: FeedbackAttachment[] = [
      { filename: 'empty.png', data: new Uint8Array(), contentType: 'image/png' },
      { filename: 'not-a-screenshot.jpg', data: new Uint8Array([1]), contentType: 'image/jpeg' },
      { filename: 'first.png', data: new Uint8Array([1]), contentType: 'image/png' },
      { filename: 'second.png', data: acceptedBoundary, contentType: 'image/png' },
      { filename: 'third.png', data: new Uint8Array([3]), contentType: 'image/png' },
      { filename: 'fourth.png', data: new Uint8Array([4]), contentType: 'image/png' },
      { filename: 'over-limit.png', data: rejectedOverLimit, contentType: 'image/png' },
    ];

    await submitFeedbackReport({
      attachments: screenshots,
      description: 'Screenshot policy',
      module: 'conversation-session',
      moduleLabel: 'Conversation & Sessions',
    });

    expect(getCapturedAttachments().map((attachment) => attachment.filename)).toEqual([
      'first.png',
      'second.png',
      'third.png',
    ]);
  });

  it('rejects an over-limit PNG even when it is the only caller attachment', async () => {
    await submitFeedbackReport({
      attachments: [
        {
          filename: 'over-limit.png',
          data: new Uint8Array(MAX_SCREENSHOT_BYTES + 1),
          contentType: 'image/png',
        },
      ],
      description: 'Over-limit screenshot',
      module: 'conversation-session',
      moduleLabel: 'Conversation & Sessions',
    });

    expect(getCapturedAttachments()).toHaveLength(0);
  });

  it('skips malformed caller attachments and measures shadowed Uint8Array sizes intrinsically', async () => {
    const shadowedSmall = new Uint8Array([1]);
    Object.defineProperty(shadowedSmall, 'byteLength', { value: MAX_SCREENSHOT_BYTES + 1 });
    const shadowedLarge = new Uint8Array(MAX_SCREENSHOT_BYTES + 1);
    Object.defineProperty(shadowedLarge, 'byteLength', { value: 1 });

    await expect(
      submitFeedbackReport({
        attachments: [
          null,
          1,
          'screenshot',
          {},
          { filename: 'array.png', contentType: 'image/png', data: [1] },
          { filename: 'buffer.png', contentType: 'image/png', data: new ArrayBuffer(1) },
          { filename: 'valid.png', contentType: 'image/png', data: new Uint8Array([1]) },
          { filename: 'shadowed-small.png', contentType: 'image/png', data: shadowedSmall },
          { filename: 'shadowed-large.png', contentType: 'image/png', data: shadowedLarge },
        ] as unknown as FeedbackAttachment[],
        description: 'Malformed screenshot policy',
        module: 'conversation-session',
        moduleLabel: 'Conversation & Sessions',
      })
    ).resolves.toBeUndefined();

    expect(getCapturedAttachments().map((attachment) => attachment.filename)).toEqual([
      'valid.png',
      'shadowed-small.png',
    ]);
  });

  it('rejects a non-array caller attachment payload without aborting submission', async () => {
    await expect(
      submitFeedbackReport({
        attachments: 'not-an-array' as unknown as FeedbackAttachment[],
        description: 'Malformed attachment collection',
        module: 'conversation-session',
        moduleLabel: 'Conversation & Sessions',
      })
    ).resolves.toBeUndefined();

    expect(getCapturedAttachments()).toEqual([]);
  });

  it('submits an independent screenshot snapshot when the caller mutates the original during log collection', async () => {
    let resolveLogs: (value: { data: number[]; filename: string }) => void = () => {};
    const collectFeedbackLogs = vi.fn(
      () =>
        new Promise<{ data: number[]; filename: string }>((resolve) => {
          resolveLogs = resolve;
        })
    );
    const original = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('window', { electronAPI: { collectFeedbackLogs, logFeedbackEvent: vi.fn() } });

    const submission = submitFeedbackReport({
      attachments: [{ filename: 'snapshot.png', data: original, contentType: 'image/png' }],
      collectLogs: true,
      description: 'Snapshot screenshot',
      module: 'conversation-session',
      moduleLabel: 'Conversation & Sessions',
    });
    original.fill(9);
    resolveLogs({ filename: 'logs.gz', data: [4] });

    await submission;

    const screenshot = getCapturedAttachments().find((attachment) => attachment.filename === 'snapshot.png');
    expect(screenshot?.data).not.toBe(original);
    expect(Array.from(screenshot?.data ?? [])).toEqual([1, 2, 3]);
  });

  it('copies hostile Uint8Array subclasses into bounded plain screenshot snapshots', async () => {
    let speciesConstructorCalls = 0;
    class OversizedSpecies extends Uint8Array {
      constructor(byteLength: number) {
        speciesConstructorCalls++;
        super(byteLength + 1);
      }
    }
    class HostileUint8Array extends Uint8Array {
      static get [Symbol.species](): typeof OversizedSpecies {
        return OversizedSpecies;
      }
    }

    const original = new HostileUint8Array([1, 2, 3]);
    await submitFeedbackReport({
      attachments: [{ filename: 'hostile.png', data: original, contentType: 'image/png' }],
      description: 'Hostile screenshot',
      module: 'conversation-session',
      moduleLabel: 'Conversation & Sessions',
    });

    const screenshot = getCapturedAttachments().find((attachment) => attachment.filename === 'hostile.png');
    original.fill(9);

    expect(speciesConstructorCalls).toBe(0);
    expect(screenshot?.data).not.toBe(original);
    expect(Object.getPrototypeOf(screenshot?.data)).toBe(Uint8Array.prototype);
    expect(screenshot?.data.byteLength).toBe(3);
    expect(Array.from(screenshot?.data ?? [])).toEqual([1, 2, 3]);
  });

  it('rejects a revoked attachment-array proxy without aborting submission', async () => {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();

    await expect(
      submitFeedbackReport({
        attachments: proxy as unknown as FeedbackAttachment[],
        description: 'Revoked attachment array',
        module: 'conversation-session',
        moduleLabel: 'Conversation & Sessions',
      })
    ).resolves.toBeUndefined();

    expect(getCapturedAttachments()).toEqual([]);
  });

  it('skips throwing attachment indexes without invoking a custom iterator', async () => {
    const attachments = [undefined, { filename: 'later.png', data: new Uint8Array([7]), contentType: 'image/png' }];
    Object.defineProperty(attachments, 0, {
      configurable: true,
      get: () => {
        throw new Error('index inaccessible');
      },
    });
    Object.defineProperty(attachments, Symbol.iterator, {
      configurable: true,
      value: () => {
        throw new Error('iterator must not be called');
      },
    });

    await expect(
      submitFeedbackReport({
        attachments: attachments as unknown as FeedbackAttachment[],
        description: 'Throwing attachment index',
        module: 'conversation-session',
        moduleLabel: 'Conversation & Sessions',
      })
    ).resolves.toBeUndefined();

    expect(getCapturedAttachments().map((attachment) => attachment.filename)).toEqual(['later.png']);
  });

  it('preserves automatic log and DB diagnostics attachments alongside allowed screenshots', async () => {
    const collectFeedbackLogs = vi.fn().mockResolvedValue({
      filename: 'logs.gz',
      data: [1, 2, 3],
    });
    vi.stubGlobal('window', { electronAPI: { collectFeedbackLogs, logFeedbackEvent: vi.fn() } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { provider: { name: 'openai' } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    await submitFeedbackReport({
      attachments: [
        { filename: 'logs.gz', data: new Uint8Array([1]), contentType: 'image/png' },
        { filename: 'db-diagnostics.json', data: new Uint8Array([2]), contentType: 'image/png' },
        { filename: 'db-diagnostics.json.gz', data: new Uint8Array([3]), contentType: 'image/png' },
        { filename: 'screenshot.png', data: new Uint8Array([4]), contentType: 'image/png' },
      ],
      collectDbDiagnostics: { selectedModule: 'conversation-session' },
      collectLogs: true,
      description: 'Automatic attachment policy',
      module: 'conversation-session',
      moduleLabel: 'Conversation & Sessions',
    });

    expect(getCapturedAttachments().map((attachment) => attachment.filename)).toEqual([
      'db-diagnostics.json.gz',
      'logs.gz',
      'screenshot.png',
    ]);
  });

  it('submits a user-feedback event with tags, extra context, logs, and attachments', async () => {
    const collectFeedbackLogs = vi.fn().mockResolvedValue({
      filename: 'logs.gz',
      data: [1, 2, 3],
    });
    const logFeedbackEvent = vi.fn();
    vi.stubGlobal('window', {
      electronAPI: {
        collectFeedbackLogs,
        emit: vi.fn(),
        logFeedbackEvent,
        on: vi.fn(),
      },
    });

    await submitFeedbackReport({
      attachments: [
        {
          filename: 'screenshot.png',
          data: new Uint8Array([4, 5, 6]),
          contentType: 'image/png',
        },
      ],
      collectLogs: true,
      description: '  AionCore   cannot start  ',
      extra: {
        installation_integrity: {
          source: 'backend_startup_failure',
        },
      },
      module: 'installation-integrity',
      moduleLabel: 'AionUi installation is incomplete',
      tags: {
        'aionui.installation_integrity.report_source': 'backend_startup_failure',
      },
    });

    expect(collectFeedbackLogs).toHaveBeenCalledOnce();
    expect(sentryMocks.setTag).toHaveBeenCalledWith('type', 'user-feedback');
    expect(sentryMocks.setTag).toHaveBeenCalledWith('module', 'installation-integrity');
    expect(sentryMocks.setTag).toHaveBeenCalledWith(
      'aionui.installation_integrity.report_source',
      'backend_startup_failure'
    );
    expect(sentryMocks.captureEvent).toHaveBeenCalledWith(
      {
        level: 'info',
        message: 'AionUi installation is incomplete: AionCore cannot start',
        extra: {
          description: 'AionCore cannot start',
          installation_integrity: {
            source: 'backend_startup_failure',
          },
        },
      },
      {
        attachments: [
          {
            filename: 'logs.gz',
            data: new Uint8Array([1, 2, 3]),
            contentType: 'application/gzip',
          },
          {
            filename: 'screenshot.png',
            data: new Uint8Array([4, 5, 6]),
            contentType: 'image/png',
          },
        ],
      }
    );
    expect(sentryMocks.flush).not.toHaveBeenCalled();
    expect(logFeedbackEvent).toHaveBeenCalledOnce();
    expect(logFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: 'submitted',
      })
    );
  });

  it('continues without logs when log collection is unavailable', async () => {
    await submitFeedbackReport({
      collectLogs: true,
      description: 'No logs available',
      module: 'installation-integrity',
      moduleLabel: 'AionUi installation is incomplete',
    });

    expect(sentryMocks.captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: {
          description: 'No logs available',
        },
      }),
      { attachments: [] }
    );
  });

  it('attaches db diagnostics when collection succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            schema_version: 'feedback-diagnostics/v1',
            profiles: [{ name: 'conversation-session', mode: 'detail', data: { conversation: { id: 'conv-1' } } }],
            privacy: { raw_content_included: false, api_keys_included: false },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      electronAPI: {
        emit: vi.fn(),
        on: vi.fn(),
      },
    });

    await submitFeedbackReport({
      collectDbDiagnostics: {
        routeAtOpen: '#/conversation/conv-1',
        routeAtSubmit: '#/conversation/conv-1',
        selectedModule: 'conversation-session',
        explicitContext: {
          conversationId: 'conv-1',
        },
      },
      collectLogs: false,
      description: 'Conversation stuck',
      module: 'conversation-session',
      moduleLabel: 'Conversation & Sessions',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toContain('/api/system/diagnostics/feedback-report?');
    expect(path).toContain('route_at_open=%23%2Fconversation%2Fconv-1');
    expect(path).toContain('route_at_submit=%23%2Fconversation%2Fconv-1');
    expect(path).toContain('selected_module=conversation-session');
    expect(path).toContain('conversation_id=conv-1');
    expect(options.method).toBe('GET');
    expect(sentryMocks.captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: {
          description: 'Conversation stuck',
        },
      }),
      {
        attachments: [
          expect.objectContaining({
            filename: expect.stringMatching(/^db-diagnostics\.json(?:\.gz)?$/),
            data: expect.any(Uint8Array),
            contentType: expect.stringMatching(/^application\/(?:gzip|json)$/),
          }),
        ],
      }
    );
  });

  it('continues without db diagnostics when collection fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('db locked');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      electronAPI: {
        emit: vi.fn(),
        on: vi.fn(),
      },
    });

    await submitFeedbackReport({
      collectDbDiagnostics: {
        routeAtOpen: '#/conversation/conv-1',
        selectedModule: 'conversation-session',
      },
      collectLogs: false,
      description: 'Conversation stuck',
      module: 'conversation-session',
      moduleLabel: 'Conversation & Sessions',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sentryMocks.captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: {
          description: 'Conversation stuck',
        },
      }),
      { attachments: [] }
    );
  });

  it('flushes when requested', async () => {
    await submitFeedbackReport({
      collectLogs: false,
      description: 'Flush me',
      flushTimeoutMs: 2000,
      module: 'installation-integrity',
      moduleLabel: 'AionUi installation is incomplete',
    });

    expect(sentryMocks.captureEvent).toHaveBeenCalledOnce();
    expect(sentryMocks.getClient).toHaveBeenCalledOnce();
    expect(sentryMocks.flush).toHaveBeenCalledWith(2000);
  });

  it('rejects when requested flush does not complete', async () => {
    sentryMocks.flush.mockResolvedValue(false);
    const logFeedbackEvent = vi.fn();
    vi.stubGlobal('window', {
      electronAPI: {
        logFeedbackEvent,
      },
    });

    await expect(
      submitFeedbackReport({
        collectLogs: false,
        description: 'Flush me',
        flushTimeoutMs: 2000,
        module: 'installation-integrity',
        moduleLabel: 'AionUi installation is incomplete',
      })
    ).rejects.toThrow('Failed to flush feedback report (event-id)');
    expect(logFeedbackEvent).toHaveBeenCalledOnce();
    expect(logFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: 'failed',
      })
    );
  });

  it('rejects when requested flush has no initialized Sentry client', async () => {
    sentryMocks.getClient.mockReturnValue(undefined);

    await expect(
      submitFeedbackReport({
        collectLogs: false,
        description: 'Flush me',
        flushTimeoutMs: 2000,
        module: 'installation-integrity',
        moduleLabel: 'AionUi installation is incomplete',
      })
    ).rejects.toThrow('Sentry is not initialized');
  });
});
