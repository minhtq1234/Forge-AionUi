/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getIsolatedE2EUserDataPath, isIsolatedE2EUserDataPath } from '@/common/platform';

const originalTestMode = process.env.AIONUI_E2E_TEST;
const originalUserDataDir = process.env.AIONUI_E2E_USER_DATA_DIR;

const restoreEnvironment = (key: 'AIONUI_E2E_TEST' | 'AIONUI_E2E_USER_DATA_DIR', value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

describe('getIsolatedE2EUserDataPath', () => {
  afterEach(() => {
    restoreEnvironment('AIONUI_E2E_TEST', originalTestMode);
    restoreEnvironment('AIONUI_E2E_USER_DATA_DIR', originalUserDataDir);
  });

  it('ignores the override unless explicit E2E mode is active', () => {
    delete process.env.AIONUI_E2E_TEST;
    process.env.AIONUI_E2E_USER_DATA_DIR = '/tmp/weprompt-e2e-user-data';

    expect(getIsolatedE2EUserDataPath()).toBeNull();
  });

  it('returns a normalized absolute override only for explicit E2E mode', () => {
    process.env.AIONUI_E2E_TEST = '1';
    process.env.AIONUI_E2E_USER_DATA_DIR = '  ./temporary-e2e-profile  ';

    expect(getIsolatedE2EUserDataPath()).toBe(path.resolve('temporary-e2e-profile'));
  });

  it('matches only the active isolated profile root', () => {
    process.env.AIONUI_E2E_TEST = '1';
    process.env.AIONUI_E2E_USER_DATA_DIR = '/tmp/weprompt-e2e-user-data';

    expect(isIsolatedE2EUserDataPath('/tmp/weprompt-e2e-user-data')).toBe(true);
    expect(isIsolatedE2EUserDataPath('/tmp/weprompt-e2e-user-data-other')).toBe(false);
  });
});
