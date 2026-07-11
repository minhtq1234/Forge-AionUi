/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { session } from 'electron';

import { OFFICE_PREVIEW_PARTITION } from '@/common/types/office/artifactEditor';

const SELF_CONTAINED_SCHEMES = new Set(['data:', 'blob:']);
const LOOPBACK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const activeEndpoints = new Map<string, number>();

let isInstalled = false;

export type OfficePreviewRequestContext = {
  referrer?: string;
  resourceType?: string;
};

function loopbackEndpoint(url: URL): string | undefined {
  if (!LOOPBACK_SCHEMES.has(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) return undefined;
  const port = url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80');
  return `loopback:${port}`;
}

export type RetainedOfficePreviewOrigin = { url: string; release: () => void };

export function retainOfficePreviewOrigin(url: string): RetainedOfficePreviewOrigin {
  const proxyMatch = url.match(/^\/api\/(?:office-watch-proxy|ppt-proxy)\/(\d+)(?:\/.*)?$/);
  const normalizedUrl = proxyMatch ? `http://127.0.0.1:${proxyMatch[1]}/` : url;
  const parsed = new URL(normalizedUrl);
  const endpoint = loopbackEndpoint(parsed);
  if (!endpoint || parsed.protocol !== 'http:' || !parsed.port) throw new Error('Invalid Office preview origin');

  activeEndpoints.set(endpoint, (activeEndpoints.get(endpoint) ?? 0) + 1);
  let released = false;
  return {
    url: normalizedUrl,
    release: () => {
      if (released) return;
      released = true;
      const count = activeEndpoints.get(endpoint) ?? 0;
      if (count <= 1) activeEndpoints.delete(endpoint);
      else activeEndpoints.set(endpoint, count - 1);
    },
  };
}

export function isAllowedOfficePreviewRequest(url: string, context?: OfficePreviewRequestContext): boolean {
  try {
    const parsed = new URL(url);
    if (SELF_CONTAINED_SCHEMES.has(parsed.protocol)) return true;
    const targetEndpoint = loopbackEndpoint(parsed);
    if (!targetEndpoint || !activeEndpoints.has(targetEndpoint)) return false;
    if (!context) return true;

    if (!context.referrer) return context.resourceType === 'mainFrame';
    return loopbackEndpoint(new URL(context.referrer)) === targetEndpoint;
  } catch {
    return false;
  }
}

export function installOfficePreviewSession(): void {
  if (isInstalled) return;

  const officeSession = session.fromPartition(OFFICE_PREVIEW_PARTITION);
  officeSession.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel: !isAllowedOfficePreviewRequest(details.url, {
        referrer: details.referrer,
        resourceType: details.resourceType,
      }),
    });
  });
  isInstalled = true;
}
