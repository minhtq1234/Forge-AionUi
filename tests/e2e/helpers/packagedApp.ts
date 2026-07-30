/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

export type PackagedApp = {
  executablePath: string;
  cwd: string;
};

export type ResolvePackagedAppInput = {
  outDir: string;
  platform: NodeJS.Platform;
  productName: string;
};

const unique = (values: string[]): string[] => [...new Set(values)];

const isExecutableFile = (file: string, platform: NodeJS.Platform): boolean => {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const safeProductName = (productName: string): string | null => {
  const normalized = productName.trim();
  return normalized.length > 0 && path.basename(normalized) === normalized ? normalized : null;
};

/** Resolves the current packaged product executable with legacy-name fallbacks. */
export const resolvePackagedApp = ({ outDir, platform, productName }: ResolvePackagedAppInput): PackagedApp | null => {
  if (!fs.existsSync(outDir)) return null;
  const currentProductName = safeProductName(productName);
  if (currentProductName === null) return null;

  if (platform === 'win32') {
    const executableNames = unique([`${currentProductName}.exe`, 'AionUi.exe']);
    for (const dir of ['win-unpacked', 'win-x64-unpacked', 'win-arm64-unpacked']) {
      const cwd = path.join(outDir, dir);
      for (const executableName of executableNames) {
        const executablePath = path.join(cwd, executableName);
        if (isExecutableFile(executablePath, platform)) return { executablePath, cwd };
      }
    }
    return null;
  }

  if (platform === 'darwin') {
    for (const dir of ['mac-arm64', 'mac-x64', 'mac', 'mac-universal']) {
      const cwd = path.join(outDir, dir);
      if (!fs.existsSync(cwd)) continue;

      const appBundles = fs
        .readdirSync(cwd)
        .filter((file) => file.endsWith('.app'))
        .toSorted((left, right) => left.localeCompare(right));
      const preferredBundle = `${currentProductName}.app`;
      const orderedBundles = appBundles.includes(preferredBundle)
        ? [preferredBundle, ...appBundles.filter((bundle) => bundle !== preferredBundle)]
        : appBundles;

      for (const appBundle of orderedBundles) {
        const executableDir = path.join(cwd, appBundle, 'Contents', 'MacOS');
        if (!fs.existsSync(executableDir)) continue;

        const bundleName = path.basename(appBundle, '.app');
        const executableNames = unique([
          bundleName,
          currentProductName,
          ...fs.readdirSync(executableDir).toSorted((left, right) => left.localeCompare(right)),
        ]);
        for (const executableName of executableNames) {
          const executablePath = path.join(executableDir, executableName);
          if (isExecutableFile(executablePath, platform)) return { executablePath, cwd };
        }
      }
    }
    return null;
  }

  const executableNames = unique([currentProductName, currentProductName.toLowerCase(), 'aionui', 'AionUi']);
  for (const dir of ['linux-unpacked', 'linux-x64-unpacked', 'linux-arm64-unpacked']) {
    const cwd = path.join(outDir, dir);
    for (const executableName of executableNames) {
      const executablePath = path.join(cwd, executableName);
      if (isExecutableFile(executablePath, platform)) return { executablePath, cwd };
    }
  }
  return null;
};
