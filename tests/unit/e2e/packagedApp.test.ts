/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolvePackagedApp } from '../../e2e/helpers/packagedApp';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'packaged-app-resolver-'));
  temporaryRoots.push(root);
  return root;
};

const createExecutable = async (file: string): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '');
  await chmod(file, 0o755);
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('packaged app resolver', () => {
  it('prefers the current Windows product executable over a legacy fallback', async () => {
    const outDir = await createRoot();
    await createExecutable(path.join(outDir, 'win-unpacked', 'AionUi.exe'));
    await createExecutable(path.join(outDir, 'win-unpacked', 'Forge.exe'));

    expect(resolvePackagedApp({ outDir, platform: 'win32', productName: 'Forge' })).toEqual({
      executablePath: path.join(outDir, 'win-unpacked', 'Forge.exe'),
      cwd: path.join(outDir, 'win-unpacked'),
    });
  });

  it('prefers the current Linux product executable over legacy names', async () => {
    const outDir = await createRoot();
    await createExecutable(path.join(outDir, 'linux-unpacked', 'aionui'));
    await createExecutable(path.join(outDir, 'linux-unpacked', 'Forge'));

    expect(resolvePackagedApp({ outDir, platform: 'linux', productName: 'Forge' })).toEqual({
      executablePath: path.join(outDir, 'linux-unpacked', 'Forge'),
      cwd: path.join(outDir, 'linux-unpacked'),
    });
  });

  it('deterministically prefers the current macOS bundle and executable', async () => {
    const outDir = await createRoot();
    await createExecutable(path.join(outDir, 'mac-arm64', 'AionUi.app', 'Contents', 'MacOS', 'AionUi'));
    await createExecutable(path.join(outDir, 'mac-arm64', 'Forge.app', 'Contents', 'MacOS', 'Forge'));

    expect(resolvePackagedApp({ outDir, platform: 'darwin', productName: 'Forge' })).toEqual({
      executablePath: path.join(outDir, 'mac-arm64', 'Forge.app', 'Contents', 'MacOS', 'Forge'),
      cwd: path.join(outDir, 'mac-arm64'),
    });
  });

  it('does not accept a non-executable macOS bundle-named file', async () => {
    const outDir = await createRoot();
    const executable = path.join(outDir, 'mac-arm64', 'Forge.app', 'Contents', 'MacOS', 'Forge');
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, '');
    await chmod(executable, 0o644);

    expect(resolvePackagedApp({ outDir, platform: 'darwin', productName: 'Forge' })).toBeNull();
  });
});
