/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OFFICE_PREVIEW_PARTITION } from '@/common/types/office/artifactEditor';

type BeforeRequestListener = (
  details: { url: string; referrer?: string; resourceType?: string },
  callback: (response: { cancel: boolean }) => void
) => void;

const electronMocks = vi.hoisted(() => {
  const onBeforeRequest = vi.fn<(listener: BeforeRequestListener) => void>();
  const fromPartition = vi.fn(() => ({ webRequest: { onBeforeRequest } }));
  return { fromPartition, onBeforeRequest };
});

vi.mock('electron', () => ({
  session: { fromPartition: electronMocks.fromPartition },
}));

let officePreviewSession: typeof import('@/process/services/office-artifact/officePreviewSession');

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  officePreviewSession = await import('@/process/services/office-artifact/officePreviewSession');
});

describe('isAllowedOfficePreviewRequest', () => {
  it.each([
    ['file:///workspace/report.docx', false],
    ['data:text/css,body{}', true],
    ['blob:http://127.0.0.1/id', true],
    ['http://127.0.0.1:18791/', false],
    ['https://localhost:18888/app.js', false],
    ['ws://127.0.0.1:18791/live', false],
    ['wss://[::1]:18791/live', false],
    ['https://fonts.googleapis.com/css2', false],
    ['wss://cdn.example.com/live', false],
    ['https://localhost.evil.example/app.js', false],
    ['not a url', false],
  ])('classifies %s', (url, allowed) => {
    expect(officePreviewSession.isAllowedOfficePreviewRequest(url)).toBe(allowed);
  });

  it('allows only same-origin loopback resources after the initial main frame', () => {
    const retained = officePreviewSession.retainOfficePreviewOrigin('http://127.0.0.1:18791/');
    expect(
      officePreviewSession.isAllowedOfficePreviewRequest('http://127.0.0.1:18791/app.js', {
        referrer: 'http://127.0.0.1:18791/',
        resourceType: 'script',
      })
    ).toBe(true);
    expect(
      officePreviewSession.isAllowedOfficePreviewRequest('http://127.0.0.1:18888/private', {
        referrer: 'http://127.0.0.1:18791/',
        resourceType: 'xhr',
      })
    ).toBe(false);
    expect(
      officePreviewSession.isAllowedOfficePreviewRequest('http://127.0.0.1:18791/', {
        resourceType: 'mainFrame',
      })
    ).toBe(true);
    expect(
      officePreviewSession.isAllowedOfficePreviewRequest('http://127.0.0.1:18791/app.js', {
        resourceType: 'script',
      })
    ).toBe(false);
    retained.release();
    expect(officePreviewSession.isAllowedOfficePreviewRequest('http://127.0.0.1:18791/')).toBe(false);
  });

  it('normalizes backend proxy paths into a retained direct loopback URL', () => {
    const retained = officePreviewSession.retainOfficePreviewOrigin('/api/office-watch-proxy/18791');

    expect(retained.url).toBe('http://127.0.0.1:18791/');
    expect(officePreviewSession.isAllowedOfficePreviewRequest('ws://localhost:18791/live')).toBe(true);

    retained.release();
  });
});

describe('installOfficePreviewSession', () => {
  it('installs the request filter on the dedicated partition only once', () => {
    officePreviewSession.installOfficePreviewSession();
    officePreviewSession.installOfficePreviewSession();

    expect(electronMocks.fromPartition).toHaveBeenCalledOnce();
    expect(electronMocks.fromPartition).toHaveBeenCalledWith(OFFICE_PREVIEW_PARTITION);
    expect(electronMocks.onBeforeRequest).toHaveBeenCalledOnce();
  });

  it('cancels requests rejected by the offline policy', () => {
    officePreviewSession.installOfficePreviewSession();
    const listener = electronMocks.onBeforeRequest.mock.calls[0]?.[0];
    if (!listener) throw new Error('Office preview request listener was not installed');
    const callback = vi.fn<(response: { cancel: boolean }) => void>();

    listener({ url: 'https://cdn.jsdelivr.net/npm/katex', resourceType: 'script' }, callback);

    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });

  it('keeps requests accepted by the offline policy', () => {
    const retained = officePreviewSession.retainOfficePreviewOrigin('http://localhost:18791/');
    officePreviewSession.installOfficePreviewSession();
    const listener = electronMocks.onBeforeRequest.mock.calls[0]?.[0];
    if (!listener) throw new Error('Office preview request listener was not installed');
    const callback = vi.fn<(response: { cancel: boolean }) => void>();

    listener(
      {
        url: 'http://localhost:18791/app.js',
        referrer: 'http://localhost:18791/',
        resourceType: 'script',
      },
      callback
    );

    expect(callback).toHaveBeenCalledWith({ cancel: false });
    retained.release();
  });

  it('blocks cross-port loopback access and local files from the preview guest', () => {
    const retained = officePreviewSession.retainOfficePreviewOrigin('http://127.0.0.1:18791/');
    officePreviewSession.installOfficePreviewSession();
    const listener = electronMocks.onBeforeRequest.mock.calls[0]?.[0];
    if (!listener) throw new Error('Office preview request listener was not installed');
    const callback = vi.fn<(response: { cancel: boolean }) => void>();

    listener(
      {
        url: 'http://127.0.0.1:18888/private',
        referrer: 'http://127.0.0.1:18791/',
        resourceType: 'xhr',
      },
      callback
    );
    listener(
      {
        url: 'file:///Users/example/.ssh/config',
        referrer: 'http://127.0.0.1:18791/',
        resourceType: 'xhr',
      },
      callback
    );

    expect(callback).toHaveBeenNthCalledWith(1, { cancel: true });
    expect(callback).toHaveBeenNthCalledWith(2, { cancel: true });
    retained.release();
  });
});
