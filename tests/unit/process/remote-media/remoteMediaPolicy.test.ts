/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { RemoteMediaError } from '@process/services/remote-media/remoteMediaDownloader';
import { validateRemoteMediaTarget } from '@process/services/remote-media/remoteMediaDownloader';

describe('validateRemoteMediaTarget', () => {
  it('pins a public HTTPS address while retaining the original hostname', async () => {
    const target = await validateRemoteMediaTarget(new URL('https://media.example.test/output.png'), {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    });

    expect(target.hostname).toBe('media.example.test');
    expect(target.address).toBe('8.8.8.8');
    expect(target.port).toBe(443);
  });

  it('rejects an ordinary public HTTP provider output', async () => {
    await expect(
      validateRemoteMediaTarget(new URL('http://media.example.test/output.png'), {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'unsafe_remote_address' });
  });

  it.each(['file:///tmp/output.png', 'https://user:secret@media.example.test/output.png'])(
    'rejects an unsafe remote URL without preserving its sensitive detail: %s',
    async (value) => {
      await expect(
        validateRemoteMediaTarget(new URL(value), { lookup: async () => [{ address: '8.8.8.8', family: 4 }] })
      ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'invalid_remote_url' });
    }
  );

  it.each(['127.0.0.1', '10.1.2.3', '100.64.0.1', '169.254.1.1', '224.0.0.1', '::1', 'fc00::1'])(
    'rejects a blocked resolved address: %s',
    async (address) => {
      await expect(
        validateRemoteMediaTarget(new URL('https://media.example.test/output.png'), {
          lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
        })
      ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'unsafe_remote_address' });
    }
  );

  it.each(['240.0.0.1', '255.255.255.255', '::ffff:127.0.0.1', 'fe80::1', 'fec0::1', 'ff02::1'])(
    'rejects reserved, broadcast, and mapped blocked addresses: %s',
    async (address) => {
      await expect(
        validateRemoteMediaTarget(new URL('https://media.example.test/output.png'), {
          lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
        })
      ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'unsafe_remote_address' });
    }
  );

  it('collapses resolver failures to an opaque remote-media error', async () => {
    const rejection = validateRemoteMediaTarget(new URL('https://secret-host.example/output.png'), {
      lookup: async () => {
        throw new Error('getaddrinfo leaked secret-host.example');
      },
    }).catch((error: unknown) => error);

    await expect(rejection).resolves.toMatchObject<Partial<RemoteMediaError>>({
      name: 'RemoteMediaError',
      code: 'remote_download_failed',
      message: 'remote_download_failed',
    });
  });

  it('rejects a hostname with mixed public and private answers', async () => {
    await expect(
      validateRemoteMediaTarget(new URL('https://media.example.test/output.png'), {
        lookup: async () => [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'unsafe_remote_address' });
  });

  it('allows a private HTTP target only for the exact configured media gateway origin', async () => {
    const target = await validateRemoteMediaTarget(new URL('http://gateway.internal:8080/v1/output'), {
      trustedPrivateGatewayOrigin: 'http://gateway.internal:8080',
      lookup: async () => [{ address: '10.0.0.8', family: 4 }],
    });

    expect(target.address).toBe('10.0.0.8');

    await expect(
      validateRemoteMediaTarget(new URL('http://gateway.internal:8081/v1/output'), {
        trustedPrivateGatewayOrigin: 'http://gateway.internal:8080',
        lookup: async () => [{ address: '10.0.0.8', family: 4 }],
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'unsafe_remote_address' });
  });

  it('does not let a trusted HTTP origin exception apply when that origin resolves publicly', async () => {
    await expect(
      validateRemoteMediaTarget(new URL('http://gateway.internal:8080/v1/output'), {
        trustedPrivateGatewayOrigin: 'http://gateway.internal:8080',
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      })
    ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'unsafe_remote_address' });
  });

  it('allows only an all-private answer set at the exact trusted gateway origin', async () => {
    await expect(
      validateRemoteMediaTarget(new URL('http://gateway.internal:8080/v1/output'), {
        trustedPrivateGatewayOrigin: 'http://gateway.internal:8080',
        lookup: async () => [
          { address: '10.0.0.8', family: 4 },
          { address: '192.168.0.8', family: 4 },
        ],
      })
    ).resolves.toMatchObject({ address: '10.0.0.8' });

    for (const addresses of [
      [
        { address: '10.0.0.8', family: 4 as const },
        { address: '8.8.8.8', family: 4 as const },
      ],
      [{ address: '127.0.0.1', family: 4 as const }],
      [{ address: '169.254.169.254', family: 4 as const }],
    ]) {
      await expect(
        validateRemoteMediaTarget(new URL('http://gateway.internal:8080/v1/output'), {
          trustedPrivateGatewayOrigin: 'http://gateway.internal:8080',
          lookup: async () => addresses,
        })
      ).rejects.toMatchObject<Partial<RemoteMediaError>>({ code: 'unsafe_remote_address' });
    }
  });
});
