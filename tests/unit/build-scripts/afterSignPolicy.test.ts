import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

type ReleaseChannel = 'stable' | 'non-stable';
type CodesignMetadata = {
  authorities: string[];
  signature: string | null;
  teamIdentifier: string | null;
};
type StableConfig = {
  appleId: string;
  appleIdPassword: string;
  teamId: string;
  cscName: string;
};
type AfterSignPolicy = {
  classifyReleaseRef: (ref: string | undefined) => ReleaseChannel;
  resolveReleaseChannel: (value: string | undefined) => ReleaseChannel;
  readStableReleaseConfig: (env: NodeJS.ProcessEnv) => StableConfig;
  parseCodesignMetadata: (output: string) => CodesignMetadata;
  assertTrustedSignature: (metadata: CodesignMetadata, config: StableConfig) => void;
};

const policy = require('../../../scripts/afterSign.js') as AfterSignPolicy;

const config: StableConfig = {
  appleId: 'release@example.com',
  appleIdPassword: 'fixture-password',
  teamId: 'TEAM123456',
  cscName: 'Developer ID Application: Forge Corp (TEAM123456)',
};

describe('stable macOS release policy', () => {
  it.each([
    ['refs/tags/v1.0.0', 'stable'],
    ['refs/tags/v12.34.56', 'stable'],
    ['refs/heads/dev', 'non-stable'],
    ['refs/tags/v1.0.0-alpha.1', 'non-stable'],
    ['refs/tags/v1.0.0-beta.1', 'non-stable'],
    ['refs/tags/v1.0.0-rc.1', 'non-stable'],
    ['refs/tags/v1.0', 'non-stable'],
    ['refs/tags/release-1.0.0', 'non-stable'],
    [undefined, 'non-stable'],
  ] as const)('classifies %s as %s', (ref, expected) => {
    expect(policy.classifyReleaseRef(ref)).toBe(expected);
  });

  it('rejects an unknown explicit release channel instead of downgrading it', () => {
    expect(() => policy.resolveReleaseChannel('production')).toThrow('Unsupported FORGE_RELEASE_CHANNEL: production');
  });

  it.each(['appleId', 'appleIdPassword', 'teamId', 'CSC_NAME'] as const)(
    'rejects stable configuration missing %s',
    (key) => {
      const env: NodeJS.ProcessEnv = {
        appleId: config.appleId,
        appleIdPassword: config.appleIdPassword,
        teamId: config.teamId,
        CSC_NAME: config.cscName,
      };
      delete env[key];

      expect(() => policy.readStableReleaseConfig(env)).toThrow(key);
    }
  );

  it('parses Developer ID signing metadata', () => {
    const metadata = policy.parseCodesignMetadata(`
Signature size=8971
Authority=Developer ID Application: Forge Corp (TEAM123456)
Authority=Developer ID Certification Authority
TeamIdentifier=TEAM123456
`);

    expect(metadata).toEqual({
      authorities: ['Developer ID Application: Forge Corp (TEAM123456)', 'Developer ID Certification Authority'],
      signature: '8971',
      teamIdentifier: 'TEAM123456',
    });
  });

  it('rejects ad-hoc signing evidence', () => {
    expect(() =>
      policy.assertTrustedSignature({ authorities: [], signature: 'adhoc', teamIdentifier: null }, config)
    ).toThrow('ad-hoc');
  });

  it('rejects a mismatched Apple team', () => {
    expect(() =>
      policy.assertTrustedSignature(
        {
          authorities: [config.cscName],
          signature: '8971',
          teamIdentifier: 'OTHERTEAM',
        },
        config
      )
    ).toThrow('Apple team');
  });

  it('rejects a mismatched Developer ID identity', () => {
    expect(() =>
      policy.assertTrustedSignature(
        {
          authorities: ['Developer ID Application: Other Corp (TEAM123456)'],
          signature: '8971',
          teamIdentifier: config.teamId,
        },
        config
      )
    ).toThrow('Developer ID identity');
  });
});
