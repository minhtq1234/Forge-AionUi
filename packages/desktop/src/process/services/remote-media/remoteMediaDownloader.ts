/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export type RemoteMediaErrorCode =
  | 'invalid_remote_url'
  | 'unsafe_remote_address'
  | 'remote_timeout'
  | 'remote_too_large'
  | 'remote_download_failed';

/** Deliberately opaque: remote URLs and transport details never leave main. */
export class RemoteMediaError extends Error {
  readonly code: RemoteMediaErrorCode;

  constructor(code: RemoteMediaErrorCode) {
    super(code);
    this.name = 'RemoteMediaError';
    this.code = code;
  }
}

export type RemoteDnsAddress = { address: string; family: 4 | 6 };

export type RemoteMediaPolicyDeps = {
  lookup: (hostname: string) => Promise<RemoteDnsAddress[]>;
  trustedPrivateGatewayOrigin?: string;
};

export type ValidatedRemoteMediaTarget = {
  url: URL;
  hostname: string;
  port: number;
  address: string;
  family: 4 | 6;
};

type DestroyableBody = AsyncIterable<Uint8Array> & {
  destroy?: (error?: Error) => void;
  resume?: () => void;
};

export type RemoteMediaResponse = {
  statusCode: number;
  headers: Record<string, string | undefined>;
  remoteAddress: string | undefined;
  body: AsyncIterable<Uint8Array>;
  /** Optional seams let tests and non-Node adapters clean up without buffering. */
  destroy?: (error?: Error) => void;
  drain?: () => void;
};

export type RemoteMediaRequestOptions = { signal?: AbortSignal };

export type RemoteMediaDownloadDeps = RemoteMediaPolicyDeps & {
  request: (target: ValidatedRemoteMediaTarget, options?: RemoteMediaRequestOptions) => Promise<RemoteMediaResponse>;
  write: (chunk: Buffer) => Promise<void>;
  maxBytes: number;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  setTimer?: (callback: () => void, timeoutMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

/** Finite whole-download budget used when a caller does not specify one. */
export const REMOTE_MEDIA_DEFAULT_TIMEOUT_MS = 120_000;

export type RemoteMediaDownloadResult = {
  byteSize: number;
  /** Lowercase media type without parameters from the final 2xx response. */
  contentType: string | null;
};

const defaultPort = (protocol: string): number => (protocol === 'https:' ? 443 : 80);

const normalizedHost = (hostname: string): string => hostname.replace(/^\[|\]$/g, '').toLowerCase();

const hostHeader = (target: ValidatedRemoteMediaTarget): string => {
  const host = target.hostname.includes(':') ? `[${target.hostname}]` : target.hostname;
  return target.port === defaultPort(target.url.protocol) ? host : `${host}:${target.port}`;
};

/**
 * Node transport with DNS pinning. The hostname remains in Host/SNI so TLS
 * certificate validation is still performed against the original URL host.
 */
export const createNodeRemoteMediaRequest =
  (timeoutMs: number) =>
  (target: ValidatedRemoteMediaTarget, options?: RemoteMediaRequestOptions): Promise<RemoteMediaResponse> =>
    new Promise((resolve, reject) => {
      const client = target.url.protocol === 'https:' ? https : http;
      const targetIsIp = isIP(target.hostname) !== 0;
      let settled = false;
      const fail = (error: Error): void => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      const request = client.request(
        {
          protocol: target.url.protocol,
          hostname: target.hostname,
          port: target.port,
          path: `${target.url.pathname}${target.url.search}`,
          method: 'GET',
          headers: { Host: hostHeader(target) },
          servername: target.url.protocol === 'https:' && !targetIsIp ? target.hostname : undefined,
          signal: options?.signal,
          lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
        },
        (response) => {
          if (settled) {
            response.destroy();
            return;
          }
          settled = true;
          const headers = Object.fromEntries(
            Object.entries(response.headers).map(([name, value]) => [name, Array.isArray(value) ? value[0] : value])
          );
          resolve({
            statusCode: response.statusCode ?? 0,
            headers,
            remoteAddress: response.socket.remoteAddress,
            body: response,
            destroy: (error) => response.destroy(error),
            drain: () => response.resume(),
          });
        }
      );
      request.once('error', (error) =>
        fail(error instanceof RemoteMediaError ? error : new RemoteMediaError('remote_download_failed'))
      );
      request.setTimeout(timeoutMs, () => request.destroy(new RemoteMediaError('remote_timeout')));
      request.end();
    });

const ipv4Number = (address: string): number =>
  address.split('.').reduce((result, part) => (result << 8) | Number(part), 0) >>> 0;

const inIpv4Cidr = (address: string, network: string, prefix: number): boolean => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(network) & mask);
};

const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
];

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ...PRIVATE_IPV4_RANGES,
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const isPrivateIpv4 = (address: string): boolean =>
  PRIVATE_IPV4_RANGES.some(([network, prefix]) => inIpv4Cidr(address, network, prefix));

const isBlockedIpv4 = (address: string): boolean =>
  BLOCKED_IPV4_RANGES.some(([network, prefix]) => inIpv4Cidr(address, network, prefix));

/** Turns IPv6 spellings (including dotted mapped form) into eight groups. */
const ipv6Groups = (value: string): number[] | null => {
  const address = normalizedHost(value);
  if (!address || address.includes('%')) return null;
  let source = address;
  if (source.includes('.')) {
    const splitAt = source.lastIndexOf(':');
    if (splitAt < 0) return null;
    const ipv4 = source.slice(splitAt + 1);
    if (isIP(ipv4) !== 4) return null;
    const number = ipv4Number(ipv4);
    source = `${source.slice(0, splitAt)}:${(number >>> 16).toString(16)}:${(number & 0xffff).toString(16)}`;
  }
  const halves = source.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const groups = half.split(':').map((part) => Number.parseInt(part, 16));
    return groups.every((part, index) => /^[0-9a-f]{1,4}$/i.test(half.split(':')[index] ?? '') && part <= 0xffff)
      ? groups
      : null;
  };
  const left = parseHalf(halves[0] ?? '');
  const right = parseHalf(halves[1] ?? '');
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  if (left.length + right.length >= 8) return null;
  return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right];
};

const mappedIpv4 = (groups: number[]): string | null => {
  if (groups.length !== 8 || !groups.slice(0, 5).every((part) => part === 0) || groups[5] !== 0xffff) return null;
  const value = ((groups[6] ?? 0) << 16) | (groups[7] ?? 0);
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
};

const isPrivateIpv6 = (address: string): boolean => {
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const mapped = mappedIpv4(groups);
  return mapped !== null ? isPrivateIpv4(mapped) : ((groups[0] ?? 0) & 0xfe00) === 0xfc00;
};

const isBlockedIpv6 = (address: string): boolean => {
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const mapped = mappedIpv4(groups);
  if (mapped !== null) return isBlockedIpv4(mapped);
  if (groups.every((part) => part === 0) || (groups.slice(0, 7).every((part) => part === 0) && groups[7] === 1))
    return true;
  const first = groups[0] ?? 0;
  if (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00
  )
    return true;
  // Documentation and discard-only ranges are not remotely routable media origins.
  if (
    (groups[0] === 0x2001 && groups[1] === 0x0db8) ||
    (groups[0] === 0x0100 && groups.slice(1, 4).every((part) => part === 0))
  )
    return true;
  return false;
};

export const isBlockedRemoteAddress = (address: string): boolean => {
  const normalized = normalizedHost(address);
  const kind = isIP(normalized);
  if (kind === 4) return isBlockedIpv4(normalized);
  if (kind === 6) return isBlockedIpv6(normalized);
  return true;
};

const isPrivateRemoteAddress = (address: string): boolean => {
  const normalized = normalizedHost(address);
  const kind = isIP(normalized);
  return kind === 4 ? isPrivateIpv4(normalized) : kind === 6 && isPrivateIpv6(normalized);
};

const normalizedOrigin = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (
      parsed.username ||
      parsed.password ||
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      return null;
    return `${parsed.protocol}//${normalizedHost(parsed.hostname)}:${parsed.port || defaultPort(parsed.protocol)}`;
  } catch {
    return null;
  }
};

const targetOrigin = (url: URL): string =>
  `${url.protocol}//${normalizedHost(url.hostname)}:${url.port || defaultPort(url.protocol)}`;

const resolveAddresses = async (url: URL, lookup: RemoteMediaPolicyDeps['lookup']): Promise<RemoteDnsAddress[]> => {
  const literal = normalizedHost(url.hostname);
  const literalKind = isIP(literal);
  let answers: RemoteDnsAddress[];
  try {
    answers =
      literalKind === 4 || literalKind === 6
        ? [{ address: literal, family: literalKind as 4 | 6 }]
        : await lookup(literal);
  } catch (error) {
    if (error instanceof RemoteMediaError) throw error;
    throw new RemoteMediaError('remote_download_failed');
  }
  if (
    answers.length === 0 ||
    answers.some((answer) => {
      const normalized = normalizedHost(answer.address);
      return (answer.family !== 4 && answer.family !== 6) || isIP(normalized) !== answer.family;
    })
  ) {
    throw new RemoteMediaError('unsafe_remote_address');
  }
  return answers.map((answer) => ({ ...answer, address: normalizedHost(answer.address) }));
};

/** Validates before every initial or redirected request. */
export const validateRemoteMediaTarget = async (
  url: URL,
  deps: RemoteMediaPolicyDeps
): Promise<ValidatedRemoteMediaTarget> => {
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || !url.hostname) {
    throw new RemoteMediaError('invalid_remote_url');
  }
  const addresses = await resolveAddresses(url, deps.lookup);
  const trustedGateway = normalizedOrigin(deps.trustedPrivateGatewayOrigin ?? '') === targetOrigin(url);
  const allPublic = addresses.every((answer) => !isBlockedRemoteAddress(answer.address));
  const allPrivate = addresses.every((answer) => isPrivateRemoteAddress(answer.address));
  const trustedPrivateGateway = trustedGateway && allPrivate;
  // A gateway exception is deliberately narrow: it never relaxes loopback,
  // link-local/metadata, CGNAT, multicast, or mixed public/private DNS.
  // Plain HTTP is reserved exclusively for that private gateway; public
  // provider outputs and every other origin must use HTTPS.
  if (
    (url.protocol === 'http:' && !trustedPrivateGateway) ||
    (url.protocol === 'https:' && !allPublic && !trustedPrivateGateway)
  ) {
    throw new RemoteMediaError('unsafe_remote_address');
  }
  const first = addresses[0];
  if (!first) throw new RemoteMediaError('unsafe_remote_address');
  return {
    url,
    hostname: normalizedHost(url.hostname),
    port: Number(url.port || defaultPort(url.protocol)),
    address: first.address,
    family: first.family,
  };
};

const asHeaderValue = (headers: RemoteMediaResponse['headers'], name: string): string | undefined =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];

const normalizedPeerAddress = (address: string): string | null => {
  const normalized = normalizedHost(address);
  if (isIP(normalized) === 4) {
    const value = ipv4Number(normalized);
    return `0000:0000:0000:0000:0000:ffff:${(value >>> 16).toString(16).padStart(4, '0')}:${(value & 0xffff).toString(16).padStart(4, '0')}`;
  }
  const groups = ipv6Groups(normalized);
  return groups ? groups.map((group) => group.toString(16).padStart(4, '0')).join(':') : null;
};

const peerMatchesTarget = (peer: string | undefined, target: ValidatedRemoteMediaTarget): boolean =>
  peer !== undefined && normalizedPeerAddress(peer) === normalizedPeerAddress(target.address);

const cleanupResponse = (response: RemoteMediaResponse | undefined, _error: Error): void => {
  if (!response) return;
  let destroyed = false;
  try {
    if (response.destroy) {
      response.destroy();
      destroyed = true;
    }
  } catch {
    // Cleanup must never replace the stable remote-media error.
  }
  if (!destroyed) {
    try {
      (response.body as DestroyableBody).destroy?.();
      destroyed = true;
    } catch {
      // Cleanup must never replace the stable remote-media error.
    }
  }
  if (!destroyed) {
    try {
      response.drain?.();
    } catch {
      // Cleanup must never replace the stable remote-media error.
    }
    try {
      (response.body as DestroyableBody).resume?.();
    } catch {
      // Cleanup must never replace the stable remote-media error.
    }
  }
};

type RemoteMediaDeadline = {
  signal: AbortSignal;
  run<T>(operation: () => Promise<T>): Promise<T>;
  setActiveResponse(response: RemoteMediaResponse | undefined): void;
  didTimeout(): boolean;
  close(): void;
};

/** One deadline owns DNS, all redirects, the request, and streamed writes. */
const createRemoteMediaDeadline = (deps: RemoteMediaDownloadDeps): RemoteMediaDeadline => {
  const controller = new AbortController();
  let timedOut = false;
  let activeResponse: RemoteMediaResponse | undefined;
  let rejectAbort: ((reason: RemoteMediaError) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject as (reason: RemoteMediaError) => void;
  });
  // The timer can be injected synchronously; mark this promise handled before
  // arming it, while `run` still races against the original rejection.
  void aborted.catch((): undefined => undefined);
  const abort = (code: 'remote_timeout' | 'remote_download_failed'): void => {
    if (controller.signal.aborted) return;
    timedOut = code === 'remote_timeout';
    const error = new RemoteMediaError(code);
    controller.abort();
    cleanupResponse(activeResponse, error);
    rejectAbort?.(error);
  };
  const externalAbort = (): void => abort('remote_download_failed');
  deps.signal?.addEventListener('abort', externalAbort, { once: true });
  if (deps.signal?.aborted) externalAbort();

  const timeoutMs = deps.timeoutMs ?? REMOTE_MEDIA_DEFAULT_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const timer =
    !controller.signal.aborted && timeoutMs !== undefined && Number.isSafeInteger(timeoutMs) && timeoutMs > 0
      ? setTimer(() => abort('remote_timeout'), timeoutMs)
      : undefined;

  const close = (): void => {
    if (timer !== undefined) clearTimer(timer);
    deps.signal?.removeEventListener('abort', externalAbort);
  };

  return {
    signal: controller.signal,
    run: async <T>(operation: () => Promise<T>): Promise<T> => {
      if (controller.signal.aborted) {
        throw new RemoteMediaError(timedOut ? 'remote_timeout' : 'remote_download_failed');
      }
      const result = await Promise.race([operation(), aborted]);
      if (controller.signal.aborted) {
        throw new RemoteMediaError(timedOut ? 'remote_timeout' : 'remote_download_failed');
      }
      return result;
    },
    setActiveResponse: (response) => {
      activeResponse = response;
    },
    didTimeout: () => timedOut,
    close,
  };
};

/**
 * A dependency-injected streaming downloader. It has exactly one production
 * transport path (node:http/node:https) and never buffers a remote body.
 */
export const downloadRemoteMedia = async (
  value: string,
  deps: RemoteMediaDownloadDeps
): Promise<RemoteMediaDownloadResult> => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteMediaError('invalid_remote_url');
  }
  const maxRedirects = deps.maxRedirects ?? 3;
  const timeoutMs = deps.timeoutMs ?? REMOTE_MEDIA_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    !Number.isSafeInteger(deps.maxBytes) ||
    deps.maxBytes < 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new RemoteMediaError('remote_download_failed');
  }

  const deadline = createRemoteMediaDeadline({ ...deps, timeoutMs });
  const lookupWithDeadline = (hostname: string): Promise<RemoteDnsAddress[]> =>
    deadline.run(() => deps.lookup(hostname));
  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const target = await validateRemoteMediaTarget(url, {
        lookup: lookupWithDeadline,
        trustedPrivateGatewayOrigin: deps.trustedPrivateGatewayOrigin,
      });
      let response: RemoteMediaResponse;
      try {
        response = await deadline.run(() => deps.request(target, { signal: deadline.signal }));
      } catch (error) {
        if (error instanceof RemoteMediaError) throw error;
        throw new RemoteMediaError(deadline.didTimeout() ? 'remote_timeout' : 'remote_download_failed');
      }
      deadline.setActiveResponse(response);
      const fail = (code: RemoteMediaErrorCode): never => {
        const error = new RemoteMediaError(deadline.didTimeout() ? 'remote_timeout' : code);
        cleanupResponse(response, error);
        deadline.setActiveResponse(undefined);
        throw error;
      };

      if (!peerMatchesTarget(response.remoteAddress, target)) fail('remote_download_failed');
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = asHeaderValue(response.headers, 'location');
        if (!location || redirectCount === maxRedirects) fail('remote_download_failed');
        cleanupResponse(response, new RemoteMediaError('remote_download_failed'));
        deadline.setActiveResponse(undefined);
        try {
          url = new URL(location, url);
        } catch {
          throw new RemoteMediaError('invalid_remote_url');
        }
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) fail('remote_download_failed');
      const responseContentType = asHeaderValue(response.headers, 'content-type');
      const contentType =
        responseContentType === undefined ? null : responseContentType.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== null && !/^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/.test(contentType)) {
        fail('remote_download_failed');
      }
      const declaredLength = asHeaderValue(response.headers, 'content-length');
      if (declaredLength !== undefined) {
        if (!/^(?:0|[1-9]\d*)$/.test(declaredLength)) fail('remote_download_failed');
        const parsed = Number(declaredLength);
        if (!Number.isSafeInteger(parsed) || parsed < 0) fail('remote_download_failed');
        if (parsed > deps.maxBytes) fail('remote_too_large');
      }
      let byteSize = 0;
      try {
        await deadline.run(async () => {
          for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk);
            byteSize += buffer.length;
            if (byteSize > deps.maxBytes) fail('remote_too_large');
            await deps.write(buffer);
          }
        });
      } catch (error) {
        if (error instanceof RemoteMediaError) throw error;
        fail('remote_download_failed');
      }
      if (deadline.didTimeout()) fail('remote_timeout');
      if (declaredLength !== undefined && byteSize !== Number(declaredLength)) fail('remote_download_failed');
      deadline.setActiveResponse(undefined);
      return { byteSize, contentType };
    }
    throw new RemoteMediaError('remote_download_failed');
  } finally {
    deadline.close();
  }
};
