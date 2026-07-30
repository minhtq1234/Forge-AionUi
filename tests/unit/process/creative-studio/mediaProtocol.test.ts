/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  installCreativeStudioProtocol,
  parseCreativeStudioAssetUrl,
  parseSingleByteRange,
  registerCreativeStudioScheme,
} from '@process/services/creative-studio/mediaProtocol';

describe('parseCreativeStudioAssetUrl', () => {
  it('accepts exactly a safe project and asset URL', () => {
    expect(parseCreativeStudioAssetUrl('weprompt-studio://asset/project_1/asset_1')).toEqual({
      projectId: 'project_1',
      assetId: 'asset_1',
    });
  });

  it.each([
    'weprompt-studio://asset/project_1/asset_1?path=/tmp/x',
    'weprompt-studio://asset/project_1/asset_1?',
    'weprompt-studio://asset/project_1/asset_1#',
    'weprompt-studio://asset@/project_1/asset_1',
    'weprompt-studio://asset/project_1/asset_1/more',
    'weprompt-studio://asset/project_1%2Fother/asset_1',
    'weprompt-studio://other/project_1/asset_1',
    'weprompt-studio://asset:8080/project_1/asset_1',
  ])('rejects a non-canonical media URL', (url) => {
    expect(parseCreativeStudioAssetUrl(url)).toBeNull();
  });
});

describe('parseSingleByteRange', () => {
  it.each([
    ['bytes=0-4', 10, { start: 0, end: 4 }],
    ['bytes=-3', 10, { start: 7, end: 9 }],
    ['bytes=6-', 10, { start: 6, end: 9 }],
  ] as const)('parses a permitted range %s', (header, size, expected) => {
    expect(parseSingleByteRange(header, size)).toEqual(expected);
  });

  it.each(['bytes=0-1,3-4', 'items=0-1', 'bytes=10-11', 'bytes=4-3'])('rejects an invalid range %s', (header) => {
    expect(parseSingleByteRange(header, 10)).toBeNull();
  });
});

describe('Creative Studio media protocol lifecycle', () => {
  it('registers a privileged non-fetchable streaming scheme', () => {
    const registerSchemesAsPrivileged = vi.fn();
    registerCreativeStudioScheme({ registerSchemesAsPrivileged });

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'weprompt-studio',
        privileges: { standard: true, secure: true, stream: true, supportFetchAPI: false, corsEnabled: false },
      },
    ]);
  });

  it('serves a suffix range with safe headers and does not read a HEAD body', async () => {
    const handle = vi.fn();
    const openVerifiedStream = vi.fn(async () => Readable.from([]));
    installCreativeStudioProtocol(
      { handle },
      {
        resolveAsset: async () => ({
          asset: { mimeType: 'image/png', byteSize: 10 },
          openVerifiedStream,
        }),
      }
    );
    const handler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;
    const response = await handler(
      new Request('weprompt-studio://asset/project_1/asset_1', { headers: { range: 'bytes=-3' } })
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 7-9/10');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(openVerifiedStream).toHaveBeenCalledWith(7, 9);

    const head = await handler(new Request('weprompt-studio://asset/project_1/asset_1', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(openVerifiedStream).toHaveBeenCalledTimes(1);
  });

  it('returns 206 and Content-Range for a valid Range header covering the full asset', async () => {
    const handle = vi.fn();
    installCreativeStudioProtocol(
      { handle },
      {
        resolveAsset: async () => ({
          asset: { mimeType: 'image/png', byteSize: 10 },
          openVerifiedStream: async () => Readable.from([]),
        }),
      }
    );
    const handler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

    const response = await handler(
      new Request('weprompt-studio://asset/project_1/asset_1', { headers: { range: 'bytes=0-9' } })
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 0-9/10');
  });

  it('does not produce a protocol response when the verified stream lease rejects a replacement', async () => {
    const handle = vi.fn();
    installCreativeStudioProtocol(
      { handle },
      {
        resolveAsset: async () => ({
          asset: { mimeType: 'image/png', byteSize: 10 },
          openVerifiedStream: async () => {
            throw new Error('managed bytes replaced');
          },
        }),
      }
    );
    const handler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

    await expect(handler(new Request('weprompt-studio://asset/project_1/asset_1'))).rejects.toThrow(
      'managed bytes replaced'
    );
  });

  it('returns 416 for an unsatisfiable range and 404 for an unknown asset', async () => {
    const handle = vi.fn();
    installCreativeStudioProtocol(
      { handle },
      {
        resolveAsset: async (_projectId, assetId) =>
          assetId === 'missing'
            ? null
            : { asset: { mimeType: 'image/png', byteSize: 10 }, openVerifiedStream: async () => Readable.from([]) },
      }
    );
    const handler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;
    await expect(
      handler(new Request('weprompt-studio://asset/project_1/asset_1', { headers: { range: 'bytes=20-30' } }))
    ).resolves.toMatchObject({ status: 416 });
    await expect(handler(new Request('weprompt-studio://asset/project_1/missing'))).resolves.toMatchObject({
      status: 404,
    });
  });

  it('handles a zero-byte asset without opening a stream', async () => {
    const handle = vi.fn();
    const openVerifiedStream = vi.fn(async () => Readable.from([]));
    installCreativeStudioProtocol(
      { handle },
      { resolveAsset: async () => ({ asset: { mimeType: 'image/png', byteSize: 0 }, openVerifiedStream }) }
    );
    const handler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;
    await expect(handler(new Request('weprompt-studio://asset/project_1/asset_1'))).resolves.toMatchObject({
      status: 200,
    });
    await expect(
      handler(new Request('weprompt-studio://asset/project_1/asset_1', { headers: { range: 'bytes=0-0' } }))
    ).resolves.toMatchObject({ status: 416 });
    expect(openVerifiedStream).not.toHaveBeenCalled();
  });
});

describe('Creative Studio protocol startup ordering', () => {
  it('registers before app readiness, then cleans storage before installing the protocol', async () => {
    const source = await fs.readFile(path.resolve(process.cwd(), 'packages/desktop/src/index.ts'), 'utf8');
    const register = source.indexOf('registerCreativeStudioScheme(protocol)');
    const ready = source.indexOf('.whenReady()');
    const initialize = source.indexOf('await initializeProcess()');
    const cleanup = source.indexOf('await studioMediaStore.cleanupOrphanParts()');
    const install = source.indexOf('installCreativeStudioProtocol(protocol, studioMediaStore)');

    expect(register).toBeGreaterThanOrEqual(0);
    expect(ready).toBeGreaterThan(register);
    expect(initialize).toBeGreaterThanOrEqual(0);
    expect(cleanup).toBeGreaterThan(initialize);
    expect(install).toBeGreaterThan(cleanup);
  });
});
