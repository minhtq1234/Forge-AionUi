import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const caller = readFileSync(resolve(root, '.github/workflows/build-and-release.yml'), 'utf8');
const reusable = readFileSync(resolve(root, '.github/workflows/_build-reusable.yml'), 'utf8');

describe('stable macOS release workflow contract', () => {
  it('classifies the caller ref and passes the result to the reusable workflow', () => {
    expect(caller).toContain('release_channel: ${{ steps.release-channel.outputs.release_channel }}');
    expect(caller).toContain('classifyReleaseRef(process.env.RELEASE_REF)');
    expect(caller).toContain('release_channel: ${{ needs.code-quality.outputs.release_channel }}');
  });

  it('defaults reusable callers to non-stable and forwards the channel to macOS', () => {
    expect(reusable).toMatch(/release_channel:\n\s+description:[^\n]+\n\s+type: string\n\s+default: 'non-stable'/);
    expect(reusable).toContain('FORGE_RELEASE_CHANNEL: ${{ inputs.release_channel }}');
  });

  it('preflights stable signing config and forces Electron Builder signing before the build', () => {
    const macBuildStep = reusable.slice(
      reusable.indexOf('- name: Build with electron-builder (macOS)'),
      reusable.indexOf('# Linux: Standard build without special error handling')
    );
    const preflight = macBuildStep.indexOf('readStableReleaseConfig(process.env)');
    const forcedSigning = macBuildStep.indexOf('--config.forceCodeSigning=true');
    const build = macBuildStep.indexOf('2>&1 | tee');

    expect(preflight).toBeGreaterThan(-1);
    expect(forcedSigning).toBeGreaterThan(preflight);
    expect(macBuildStep.slice(preflight, forcedSigning)).toContain('exit 1');
    expect(build).toBeGreaterThan(forcedSigning);
  });

  it('checks stable failure before the DMG warning-only exception', () => {
    const stableGuard = reusable.indexOf('if [ "${FORGE_RELEASE_CHANNEL}" = "stable" ]; then');
    const dmgException = reusable.indexOf('if [ "$DMG_EXISTS" = true ]; then');

    expect(stableGuard).toBeGreaterThan(-1);
    expect(dmgException).toBeGreaterThan(stableGuard);
    expect(reusable.slice(stableGuard, dmgException)).toContain('exit $BUILD_EXIT_CODE');
  });
});
