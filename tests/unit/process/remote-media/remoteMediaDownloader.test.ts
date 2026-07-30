/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteMediaError } from '@process/services/remote-media/remoteMediaDownloader';
import { downloadRemoteMedia } from '@process/services/remote-media/remoteMediaDownloader';

describe('downloadRemoteMedia', () => {
  it('uses the resolved address as a pinned lookup and consumes only a matching peer', async () => {
    const request = vi.fn(async () => ({
      statusCode: 200,
      headers: { 'content-length': '3', 'Content-Type': 'Image/PNG; charset=binary' },
      remoteAddress: '8.8.8.8',
      body: Readable.from([Buffer.from('png')]),
    }));
    const chunks: Buffer[] = [];

    const result = await downloadRemoteMedia('https://media.example.test/output.png', {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request,
      write: async (chunk) => chunks.push(chunk),
      maxBytes: 10,
    });

    expect(result.byteSize).toBe(3);
    expect(result.contentType).toBe('image/png');
    expect(Buffer.concat(chunks).toString()).toBe('png');
    expect(request.mock.calls[0]?.[0]).toMatchObject({ hostname: 'media.example.test', address: '8.8.8.8' });
  });

  it('rejects a peer-address mismatch before it writes response bytes', async () => {
    const write = vi.fn();
    await expect(
      downloadRemoteMedia('https://media.example.test/output.png', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async () => ({
          statusCode: 200,
          headers: {},
          remoteAddress: '1.1.1.1',
          body: Readable.from([Buffer.from('secret')]),
        }),
        write,
        maxBytes: 10,
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'remote_download_failed' });
    expect(write).not.toHaveBeenCalled();
  });

  it('revalidates redirects instead of following a newly private address', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      downloadRemoteMedia('https://media.example.test/output.png', {
        lookup,
        request: async () => ({
          statusCode: 302,
          headers: { location: 'https://redirect.example.test/private.png' },
          remoteAddress: '8.8.8.8',
          body: Readable.from([]),
        }),
        write: async () => undefined,
        maxBytes: 10,
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'unsafe_remote_address' });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('rejects a declared or streamed size over the limit without returning remote detail', async () => {
    await expect(
      downloadRemoteMedia('https://media.example.test/output.png', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async () => ({
          statusCode: 200,
          headers: { 'content-length': '11' },
          remoteAddress: '8.8.8.8',
          body: Readable.from([Buffer.alloc(11)]),
        }),
        write: async () => undefined,
        maxBytes: 10,
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'remote_too_large' });
  });

  it.each([
    ['3.0', [Buffer.from('png')]],
    ['4', [Buffer.from('png')]],
  ])('rejects malformed or mismatched declared content length %s', async (declaredLength, body) => {
    await expect(
      downloadRemoteMedia('https://media.example.test/output.png', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async () => ({
          statusCode: 200,
          headers: { 'content-length': declaredLength },
          remoteAddress: '8.8.8.8',
          body: Readable.from(body),
        }),
        write: async () => undefined,
        maxBytes: 10,
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'remote_download_failed' });
  });

  it('rejects a malformed response Content-Type instead of exposing it to media persistence', async () => {
    const write = vi.fn();
    await expect(
      downloadRemoteMedia('https://media.example.test/output.png', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async () => ({
          statusCode: 200,
          headers: { 'content-type': 'image/png, text/plain' },
          remoteAddress: '8.8.8.8',
          body: Readable.from([Buffer.from('png')]),
        }),
        write,
        maxBytes: 10,
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'remote_download_failed' });
    expect(write).not.toHaveBeenCalled();
  });

  it('normalizes IPv4-mapped peer addresses before comparing the pin', async () => {
    await expect(
      downloadRemoteMedia('https://media.example.test/output.png', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async () => ({
          statusCode: 200,
          headers: { 'content-length': '3' },
          remoteAddress: '::ffff:8.8.8.8',
          body: Readable.from([Buffer.from('png')]),
        }),
        write: async () => undefined,
        maxBytes: 10,
      })
    ).resolves.toEqual({ byteSize: 3, contentType: null });
  });

  it('destroys and drains unconsumed responses for redirects, bad peers, and non-success statuses', async () => {
    const cleanup = vi.fn();
    const makeResponse = (statusCode: number, remoteAddress = '8.8.8.8') => ({
      statusCode,
      headers: statusCode === 302 ? { location: 'https://redirect.example.test/output.png' } : {},
      remoteAddress,
      body: Readable.from([]),
      destroy: cleanup,
      drain: cleanup,
    });
    const request = vi.fn().mockResolvedValueOnce(makeResponse(302)).mockResolvedValueOnce(makeResponse(500));

    await expect(
      downloadRemoteMedia('https://media.example.test/output.png', {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request,
        write: async () => undefined,
        maxBytes: 10,
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'remote_download_failed' });
    expect(cleanup).toHaveBeenCalled();
  });

  it('maps the injected deadline to a typed timeout and aborts the request', async () => {
    let triggerTimeout: (() => void) | undefined;
    const signalSeen = vi.fn();
    let startRequest: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      startRequest = resolve;
    });
    const download = downloadRemoteMedia('https://media.example.test/output.png', {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async (_target, options) => {
        signalSeen(options?.signal?.aborted);
        startRequest?.();
        return await new Promise(() => undefined);
      },
      write: async () => undefined,
      maxBytes: 10,
      timeoutMs: 5,
      setTimer: (callback) => {
        triggerTimeout = callback;
        return 'timer';
      },
      clearTimer: vi.fn(),
    });
    await requestStarted;
    expect(triggerTimeout).toBeTypeOf('function');
    expect(signalSeen).toHaveBeenCalledWith(false);
    triggerTimeout?.();
    await expect(download).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'remote_timeout' });
  });

  it('does not resolve DNS when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 as const }]);

    await expect(
      downloadRemoteMedia('https://media.example.test/output.png', {
        lookup,
        request: async () => {
          throw new Error('request should not run');
        },
        write: async () => undefined,
        maxBytes: 10,
        signal: controller.signal,
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'remote_download_failed' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('times out a hung initial DNS lookup with the one overall deadline', async () => {
    let triggerTimeout: (() => void) | undefined;
    const download = downloadRemoteMedia('https://media.example.test/output.png', {
      lookup: async () => await new Promise(() => undefined),
      request: async () => {
        throw new Error('request should not run');
      },
      write: async () => undefined,
      maxBytes: 10,
      timeoutMs: 5,
      setTimer: (callback) => {
        triggerTimeout = callback;
        return 'timer';
      },
      clearTimer: vi.fn(),
    });

    await Promise.resolve();
    expect(triggerTimeout).toBeTypeOf('function');
    triggerTimeout?.();
    await expect(download).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'remote_timeout' });
  });

  it('keeps one deadline active across a redirect and its DNS re-resolution', async () => {
    let triggerTimeout: (() => void) | undefined;
    let startSecondLookup: (() => void) | undefined;
    const secondLookupStarted = new Promise<void>((resolve) => {
      startSecondLookup = resolve;
    });
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockImplementationOnce(async () => {
        startSecondLookup?.();
        return await new Promise(() => undefined);
      });
    const setTimer = vi.fn((callback: () => void) => {
      triggerTimeout = callback;
      return 'timer';
    });
    const clearTimer = vi.fn();

    const download = downloadRemoteMedia('https://media.example.test/output.png', {
      lookup,
      request: async () => ({
        statusCode: 302,
        headers: { location: 'https://redirect.example.test/output.png' },
        remoteAddress: '8.8.8.8',
        body: Readable.from([]),
      }),
      write: async () => undefined,
      maxBytes: 10,
      timeoutMs: 5,
      setTimer,
      clearTimer,
    });

    await secondLookupStarted;
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(clearTimer).not.toHaveBeenCalled();
    triggerTimeout?.();
    await expect(download).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'remote_timeout' });
  });
});
