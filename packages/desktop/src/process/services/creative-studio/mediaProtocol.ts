/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;

export type StudioProtocolAssetLocation = { projectId: string; assetId: string };
export type StudioByteRange = { start: number; end: number };

/** Rejects every non-canonical URL before it reaches a filesystem resolver. */
export const parseCreativeStudioAssetUrl = (value: string): StudioProtocolAssetLocation | null => {
  try {
    // URL normalisation erases empty query/hash/userinfo delimiters, so reject
    // their raw spellings before constructing URL.
    if (/[?#@]/.test(value) || /%2f|%5c/i.test(value)) return null;
    const url = new URL(value);
    if (
      url.protocol !== 'weprompt-studio:' ||
      url.hostname !== 'asset' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const segments = url.pathname.split('/');
    if (segments.length !== 3 || segments[0] !== '' || !SAFE_ID.test(segments[1]) || !SAFE_ID.test(segments[2])) {
      return null;
    }
    return { projectId: segments[1], assetId: segments[2] };
  } catch {
    return null;
  }
};

/** Parses exactly one satisfiable RFC 7233 byte range. */
export const parseSingleByteRange = (header: string | null, size: number): StudioByteRange | null => {
  if (header === null) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || size < 1) return null;
  const [, startText, endText] = match;
  if (startText === '' && endText === '') return null;
  if (startText === '') {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText === '' ? size - 1 : Number(endText);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size)
    return null;
  return { start, end: Math.min(end, size - 1) };
};

export type CreativeStudioSchemeRegistrar = {
  registerSchemesAsPrivileged(schemes: Array<{ scheme: string; privileges: Record<string, boolean> }>): void;
};

let didRegisterScheme = false;

/** Must be called synchronously, before Electron's `app.whenReady()`. */
export const registerCreativeStudioScheme = (registrar: CreativeStudioSchemeRegistrar): void => {
  if (didRegisterScheme) return;
  registrar.registerSchemesAsPrivileged([
    {
      scheme: 'weprompt-studio',
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: false, corsEnabled: false },
    },
  ]);
  didRegisterScheme = true;
};

export type CreativeStudioProtocolInstaller = {
  handle(scheme: string, handler: (request: Request) => Promise<Response>): void;
};

export type CreativeStudioAssetResolver = {
  resolveAsset(
    projectId: string,
    assetId: string
  ): Promise<{
    asset: { mimeType: string; byteSize: number };
    openVerifiedStream: (start?: number, end?: number) => Promise<Readable>;
  } | null>;
};

const protocolHeaders = (mimeType: string, byteSize: number): Headers =>
  new Headers({
    'Content-Type': mimeType,
    'Content-Length': String(byteSize),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });

/** Installs only after managed Studio storage is initialized. */
export const installCreativeStudioProtocol = (
  installer: CreativeStudioProtocolInstaller,
  resolver: CreativeStudioAssetResolver
): void => {
  installer.handle('weprompt-studio', async (request) => {
    const assetAddress = parseCreativeStudioAssetUrl(request.url);
    if (!assetAddress || (request.method !== 'GET' && request.method !== 'HEAD'))
      return new Response(null, { status: 404 });
    const resolved = await resolver.resolveAsset(assetAddress.projectId, assetAddress.assetId);
    if (!resolved) return new Response(null, { status: 404 });
    if (resolved.asset.byteSize === 0) {
      if (request.headers.has('range')) {
        const headers = protocolHeaders(resolved.asset.mimeType, 0);
        headers.set('Content-Range', 'bytes */0');
        return new Response(null, { status: 416, headers });
      }
      return new Response(null, { status: 200, headers: protocolHeaders(resolved.asset.mimeType, 0) });
    }
    const range = parseSingleByteRange(request.headers.get('range'), resolved.asset.byteSize);
    if (!range) {
      const headers = protocolHeaders(resolved.asset.mimeType, 0);
      headers.set('Content-Range', `bytes */${resolved.asset.byteSize}`);
      return new Response(null, { status: 416, headers });
    }
    const partial = request.headers.has('range');
    const length = range.end - range.start + 1;
    const headers = protocolHeaders(resolved.asset.mimeType, length);
    if (partial) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${resolved.asset.byteSize}`);
    const body =
      request.method === 'HEAD'
        ? null
        : (Readable.toWeb(await resolved.openVerifiedStream(range.start, range.end)) as ReadableStream<Uint8Array>);
    return new Response(body, { status: partial ? 206 : 200, headers });
  });
};
