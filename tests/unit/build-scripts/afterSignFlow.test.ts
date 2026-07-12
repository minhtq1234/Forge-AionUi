import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

type CommandResult = {
  error?: Error;
  status: number | null;
  stdout: string;
  stderr: string;
};
type BuildContext = {
  electronPlatformName: string;
  appOutDir: string;
  packager: { appInfo: { productFilename: string; id: string } };
};
type Dependencies = {
  env: NodeJS.ProcessEnv;
  logger: { log: (message: string) => void; warn: (message: string) => void };
  notarize: (options: Record<string, string>) => Promise<void>;
  spawnSync: (command: string, args: string[], options: { encoding: string }) => CommandResult;
};
type AfterSignModule = {
  runAfterSign: (context: BuildContext, dependencies: Dependencies) => Promise<void>;
};

const { runAfterSign } = require('../../../scripts/afterSign.js') as AfterSignModule;

const context: BuildContext = {
  electronPlatformName: 'darwin',
  appOutDir: '/tmp/out',
  packager: { appInfo: { productFilename: 'Forge', id: 'com.forge.desktop' } },
};
const stableEnv: NodeJS.ProcessEnv = {
  FORGE_RELEASE_CHANNEL: 'stable',
  appleId: 'release@example.com',
  appleIdPassword: 'fixture-password',
  teamId: 'TEAM123456',
  CSC_NAME: 'Developer ID Application: Forge Corp (TEAM123456)',
};
const trustedOutput = `
Signature size=8971
Authority=Developer ID Application: Forge Corp (TEAM123456)
Authority=Developer ID Certification Authority
TeamIdentifier=TEAM123456
`;

function success(stdout = '', stderr = ''): CommandResult {
  return { status: 0, stdout, stderr };
}

function createDependencies(env: NodeJS.ProcessEnv = stableEnv): Dependencies {
  return {
    env,
    logger: { log: vi.fn(), warn: vi.fn() },
    notarize: vi.fn().mockResolvedValue(undefined),
    spawnSync: vi.fn().mockReturnValueOnce(success()).mockReturnValueOnce(success('', trustedOutput)),
  };
}

describe('macOS afterSign release flow', () => {
  it('rejects a stable build before ad-hoc fallback when codesign verification fails', async () => {
    const dependencies = createDependencies();
    dependencies.spawnSync = vi.fn().mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'code object is not signed at all',
    });

    await expect(runAfterSign(context, dependencies)).rejects.toThrow('valid Developer ID signature');
    expect(dependencies.spawnSync).toHaveBeenCalledTimes(1);
  });

  it('notarizes a stable build after trusted signature verification', async () => {
    const dependencies = createDependencies();

    await runAfterSign(context, dependencies);

    expect(dependencies.notarize).toHaveBeenCalledWith({
      tool: 'notarytool',
      appBundleId: 'com.forge.desktop',
      appPath: '/tmp/out/Forge.app',
      appleId: stableEnv.appleId,
      appleIdPassword: stableEnv.appleIdPassword,
      teamId: stableEnv.teamId,
    });
  });

  it('propagates stable notarization failure without logging secrets', async () => {
    const dependencies = createDependencies();
    dependencies.notarize = vi.fn().mockRejectedValue(new Error('Apple rejected request'));

    await expect(runAfterSign(context, dependencies)).rejects.toThrow('Stable macOS release notarization failed');
    const loggedValues = [
      ...vi.mocked(dependencies.logger.log).mock.calls,
      ...vi.mocked(dependencies.logger.warn).mock.calls,
    ].flat();
    expect(loggedValues.join('\n')).not.toContain(stableEnv.appleIdPassword);
  });

  it('keeps non-stable unsigned builds on the ad-hoc warning path', async () => {
    const dependencies = createDependencies({ FORGE_RELEASE_CHANNEL: 'non-stable' });
    dependencies.spawnSync = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'unsigned' })
      .mockReturnValueOnce(success());

    await expect(runAfterSign(context, dependencies)).resolves.toBeUndefined();
    expect(dependencies.spawnSync).toHaveBeenLastCalledWith(
      'codesign',
      ['--force', '--deep', '--sign', '-', '/tmp/out/Forge.app'],
      { encoding: 'utf8' }
    );
    expect(dependencies.logger.warn).toHaveBeenCalledWith(expect.stringContaining('not suitable for a stable release'));
  });

  it('keeps non-stable notarization failure warning-only', async () => {
    const dependencies = createDependencies({
      FORGE_RELEASE_CHANNEL: 'non-stable',
      appleId: stableEnv.appleId,
      appleIdPassword: stableEnv.appleIdPassword,
      teamId: stableEnv.teamId,
    });
    dependencies.notarize = vi.fn().mockRejectedValue(new Error('temporary failure'));

    await expect(runAfterSign(context, dependencies)).resolves.toBeUndefined();
    expect(dependencies.logger.warn).toHaveBeenCalledWith(expect.stringContaining('notarization failed'));
  });
});
