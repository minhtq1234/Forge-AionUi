/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Forge is desktop-only (D1): startDesktopWebUI is the single chokepoint every
 * caller funnels through — the webui.start IPC bridge, index.ts WebUI mode, and
 * the boot-time restoreDesktopWebUIFromPreferences() auto-restore path. It must
 * force the WebUI to bind loopback-only, ignoring any caller-supplied or
 * persisted allowRemote. This test specifically guards the boot-restore bypass:
 * a stale persisted `allowRemote: true` must NOT reach startWebHost.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startWebHostMock = vi.hoisted(() => vi.fn());

vi.mock('@aionui/web-host', () => ({
  startWebHost: startWebHostMock,
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    getAppPath: () => '/tmp/aionui-test-app',
  },
}));

vi.mock('@process/utils/initStorage', () => ({
  getSystemDir: () => ({
    cacheDir: '/tmp/aionui-test/cache',
    workDir: '/tmp/aionui-test/work',
    logDir: '/tmp/aionui-test/logs',
  }),
}));

vi.mock('@process/utils/utils', () => ({
  getDataPath: () => '/tmp/aionui-test/data',
}));

// httpBridge is imported by webuiConfig but not exercised by startDesktopWebUI.
vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: vi.fn(),
}));

describe('startDesktopWebUI — Forge desktop-only chokepoint (D1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort = 4123;
    startWebHostMock.mockResolvedValue({
      port: 25808,
      localUrl: 'http://localhost:25808',
      stop: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  });

  it('forces allowRemote:false into startWebHost even when the caller asks for remote (boot-restore bypass)', async () => {
    const { startDesktopWebUI } = await import('@process/utils/webuiConfig');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Simulate restoreDesktopWebUIFromPreferences() replaying a stale persisted
    // `webui.desktop.allowRemote: true` into the shared chokepoint.
    const handle = await startDesktopWebUI({ port: 25808, allowRemote: true });

    expect(startWebHostMock).toHaveBeenCalledTimes(1);
    const hostOpts = startWebHostMock.mock.calls[0][0] as { allowRemote?: boolean };
    expect(hostOpts.allowRemote).toBe(false);

    // The recorded/handle value must stay consistent with the effective bind.
    expect(handle.allowRemote).toBe(false);
    expect(handle.networkUrl).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).not.toContain('true');
    warn.mockRestore();
  });

  it('forces allowRemote:false into startWebHost when the caller omits the flag', async () => {
    const { startDesktopWebUI } = await import('@process/utils/webuiConfig');

    await startDesktopWebUI({ port: 25808 });

    const hostOpts = startWebHostMock.mock.calls[0][0] as { allowRemote?: boolean };
    expect(hostOpts.allowRemote).toBe(false);
  });
});

describe('desktop WebUI remote-access compatibility policy', () => {
  const remoteSwitchCases: ReadonlyArray<[string, string | undefined, boolean, string[]]> = [
    ['a bare remote switch', undefined, true, ['--remote']],
    ['a truthy remote switch', 'true', true, ['--remote']],
    ['a false-valued remote switch', 'false', true, []],
    ['an off-valued remote switch', 'off', true, []],
    ['a zero-valued remote switch', '0', true, []],
    ['an absent remote switch', undefined, false, []],
  ];

  it.each(remoteSwitchCases)(
    'preserves %s when passing it to the policy',
    async (_label, switchValue, hasRemoteSwitch, expected) => {
      const { resolveRemoteAccessRequestSources, resolveRemoteSwitchValue } =
        await import('@process/utils/webuiConfig');

      const remoteSwitchValue = resolveRemoteSwitchValue(hasRemoteSwitch, switchValue);

      expect(resolveRemoteAccessRequestSources({}, remoteSwitchValue)).toEqual(expected);
    }
  );

  it.each(remoteSwitchCases)(
    'coordinates %s from the Electron entrypoint boundary',
    async (_label, switchValue, hasRemoteSwitch, expected) => {
      const { resolveElectronRemoteAccessRequestSources } = await import('@process/utils/webuiConfig');

      expect(resolveElectronRemoteAccessRequestSources({}, hasRemoteSwitch, switchValue, {})).toEqual(expected);
    }
  );

  it('detects truthy CLI, environment, host, and config requests', async () => {
    const { resolveRemoteAccessRequestSources } = await import('@process/utils/webuiConfig');

    expect(
      resolveRemoteAccessRequestSources({ allowRemote: true }, true, {
        AIONUI_ALLOW_REMOTE: 'yes',
        AIONUI_REMOTE: '1',
        AIONUI_HOST: '::',
      })
    ).toEqual(['--remote', 'AIONUI_ALLOW_REMOTE', 'AIONUI_REMOTE', 'AIONUI_HOST', 'allowRemote']);
  });

  it('ignores false-valued and loopback controls', async () => {
    const { resolveRemoteAccessRequestSources } = await import('@process/utils/webuiConfig');

    expect(
      resolveRemoteAccessRequestSources({ allowRemote: false }, false, {
        AIONUI_ALLOW_REMOTE: 'false',
        AIONUI_REMOTE: 'off',
        AIONUI_HOST: '127.0.0.1',
      })
    ).toEqual([]);
  });

  it('emits one warning without configuration values', async () => {
    const { warnUnsupportedDesktopRemoteAccess } = await import('@process/utils/webuiConfig');
    const warn = vi.fn();

    warnUnsupportedDesktopRemoteAccess(['--remote', 'AIONUI_HOST'], warn);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[WebUI] Remote access requested by --remote, AIONUI_HOST, but Forge WebUI is local-only; binding to 127.0.0.1.'
    );
  });

  it('does not warn without a remote request', async () => {
    const { warnUnsupportedDesktopRemoteAccess } = await import('@process/utils/webuiConfig');
    const warn = vi.fn();

    warnUnsupportedDesktopRemoteAccess([], warn);

    expect(warn).not.toHaveBeenCalled();
  });
});
