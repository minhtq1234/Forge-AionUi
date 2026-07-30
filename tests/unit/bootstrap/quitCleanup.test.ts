/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { installQuitCleanup } from '@/process/startup/quitCleanup';

type BeforeQuitEvent = {
  preventDefault: () => void;
};

const flushMicrotasks = async (remaining = 10): Promise<void> => {
  if (remaining === 0) return;
  await Promise.resolve();
  await flushMicrotasks(remaining - 1);
};

describe('installQuitCleanup', () => {
  it('prevents the first quit until cleanup finishes, then requests quit again', async () => {
    const calls: string[] = [];
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    let resolveStopBackend: (() => void) | undefined;

    const quitApp = vi.fn(() => calls.push('quit-app'));
    const stopBackend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          calls.push('stop-backend-start');
          resolveStopBackend = resolve;
        })
    );

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp,
      setIsQuitting: (value) => calls.push(`set-quitting:${value}`),
      markExplicitQuit: () => calls.push('mark-explicit-quit'),
      destroyTray: () => calls.push('destroy-tray'),
      disposeCronResumeListener: () => calls.push('dispose-cron'),
      cancelAppOperations: () => calls.push('cancel-app-operations'),
      disposeCreativeStudio: async () => calls.push('dispose-creative-studio'),
      disposeOfficeArtifacts: async () => calls.push('dispose-office-artifacts'),
      stopBackend,
      destroyPetWindow: () => calls.push('destroy-pet'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    const preventDefault = vi.fn();
    beforeQuitHandler?.({ preventDefault });
    await flushMicrotasks();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(quitApp).not.toHaveBeenCalled();
    expect(calls).toEqual([
      'set-quitting:true',
      'mark-explicit-quit',
      'destroy-tray',
      'dispose-cron',
      'cancel-app-operations',
      'dispose-creative-studio',
      'stop-backend-start',
    ]);

    resolveStopBackend?.();
    await flushMicrotasks();

    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'set-quitting:true',
      'mark-explicit-quit',
      'destroy-tray',
      'dispose-cron',
      'cancel-app-operations',
      'dispose-creative-studio',
      'stop-backend-start',
      'dispose-office-artifacts',
      'destroy-pet',
      'quit-app',
    ]);
  });

  it('allows the second before-quit after cleanup has completed', async () => {
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    const cancelAppOperations = vi.fn();

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp: vi.fn(),
      setIsQuitting: vi.fn(),
      markExplicitQuit: vi.fn(),
      destroyTray: vi.fn(),
      disposeCronResumeListener: vi.fn(),
      cancelAppOperations,
      disposeCreativeStudio: async () => {},
      disposeOfficeArtifacts: async () => {},
      stopBackend: async () => {},
      destroyPetWindow: vi.fn(),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await flushMicrotasks();

    const preventDefault = vi.fn();
    beforeQuitHandler?.({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(cancelAppOperations).toHaveBeenCalledTimes(1);
  });

  it('awaits Creative Studio disposal after App Operations and before backend shutdown', async () => {
    const calls: string[] = [];
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    let resolveStudio: (() => void) | undefined;

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp: () => calls.push('quit-app'),
      setIsQuitting: vi.fn(),
      markExplicitQuit: vi.fn(),
      destroyTray: vi.fn(),
      disposeCronResumeListener: vi.fn(),
      cancelAppOperations: () => calls.push('cancel-app-operations'),
      disposeCreativeStudio: () =>
        new Promise<void>((resolve) => {
          calls.push('dispose-creative-studio-start');
          resolveStudio = resolve;
        }),
      disposeOfficeArtifacts: async () => calls.push('dispose-office-artifacts'),
      stopBackend: async () => calls.push('stop-backend'),
      destroyPetWindow: () => calls.push('destroy-pet'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await flushMicrotasks();

    expect(calls).toEqual(['cancel-app-operations', 'dispose-creative-studio-start']);

    resolveStudio?.();
    await flushMicrotasks();

    expect(calls).toEqual([
      'cancel-app-operations',
      'dispose-creative-studio-start',
      'stop-backend',
      'dispose-office-artifacts',
      'destroy-pet',
      'quit-app',
    ]);
  });

  it('logs Creative Studio disposal failure and continues remaining cleanup', async () => {
    const calls: string[] = [];
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    const failure = new Error('studio-dispose-failed');
    const logError = vi.fn();

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp: () => calls.push('quit-app'),
      setIsQuitting: vi.fn(),
      markExplicitQuit: vi.fn(),
      destroyTray: vi.fn(),
      disposeCronResumeListener: vi.fn(),
      cancelAppOperations: () => calls.push('cancel-app-operations'),
      disposeCreativeStudio: async () => {
        calls.push('dispose-creative-studio');
        throw failure;
      },
      disposeOfficeArtifacts: async () => calls.push('dispose-office-artifacts'),
      stopBackend: async () => calls.push('stop-backend'),
      destroyPetWindow: () => calls.push('destroy-pet'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError,
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await flushMicrotasks();

    expect(calls).toEqual([
      'cancel-app-operations',
      'dispose-creative-studio',
      'stop-backend',
      'dispose-office-artifacts',
      'destroy-pet',
      'quit-app',
    ]);
    expect(logError).toHaveBeenCalledWith('[App] Failed to dispose Creative Studio:', failure);
  });
});
