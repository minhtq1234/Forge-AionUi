/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversationGet: vi.fn(),
  getState: vi.fn(),
  preparePreview: vi.fn(),
  startPreview: vi.fn(),
  releasePreview: vi.fn(),
  inspect: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
}));

const registeredProviders = new Map<string, (params: unknown) => Promise<unknown>>();

function provider(name: string): { provider: (handler: (params: unknown) => Promise<unknown>) => void } {
  return {
    provider: (handler) => registeredProviders.set(name, handler),
  };
}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getLoginItemSettings: vi.fn(() => ({})),
    setLoginItemSettings: vi.fn(),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { get: { invoke: mocks.conversationGet } },
    officeArtifact: {
      getState: provider('getState'),
      preparePreview: provider('preparePreview'),
      startPreview: provider('startPreview'),
      releasePreview: provider('releasePreview'),
      inspect: provider('inspect'),
      apply: provider('apply'),
      undo: provider('undo'),
    },
    application: {
      restart: provider('restart'),
      isDevToolsOpened: provider('isDevToolsOpened'),
      openDevTools: provider('openDevTools'),
      getZoomFactor: provider('getZoomFactor'),
      setZoomFactor: provider('setZoomFactor'),
      writeRendererLog: provider('writeRendererLog'),
      getCdpStatus: provider('getCdpStatus'),
      updateCdpConfig: provider('updateCdpConfig'),
      getStartOnBootStatus: provider('getStartOnBootStatus'),
      setStartOnBoot: provider('setStartOnBoot'),
      getGpuStatus: provider('getGpuStatus'),
      setGpuOverride: provider('setGpuOverride'),
    },
  },
}));

vi.mock('@process/services/office-artifact', () => ({
  officeArtifactService: {
    getState: mocks.getState,
    preparePreview: mocks.preparePreview,
    startPreview: mocks.startPreview,
    releasePreview: mocks.releasePreview,
    inspect: mocks.inspect,
    apply: mocks.apply,
    undo: mocks.undo,
  },
}));

vi.mock('@process/utils/initStorage', () => ({ ProcessConfig: { set: vi.fn() } }));
vi.mock('@process/utils/zoom', () => ({ getZoomFactor: vi.fn(), setZoomFactor: vi.fn() }));
vi.mock('@process/utils/configureChromium', () => ({ getCdpStatus: vi.fn(), updateCdpConfig: vi.fn() }));
vi.mock('@process/utils/gpuRecovery', () => ({ getGpuStatus: vi.fn(), setGpuUserOverride: vi.fn() }));
vi.mock('@process/bridge/applicationBridgeCore', () => ({ initApplicationBridgeCore: vi.fn() }));
vi.mock('@process/bridge/restartApplication', () => ({ restartApplication: vi.fn() }));

import { initApplicationBridge } from '@process/bridge/applicationBridge';

describe('applicationBridge Office artifact authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredProviders.clear();
    initApplicationBridge();
  });

  it('rejects a forged root workspace using the conversation workspace fetched in main', async () => {
    mocks.conversationGet.mockResolvedValue({ extra: { workspace: '/trusted/workspace' } });
    mocks.getState.mockImplementation(async (request: { workspace: string }) =>
      request.workspace === '/'
        ? { ok: true, version: 'forged', undoDepth: 0 }
        : { ok: false, code: 'OUTSIDE_WORKSPACE' }
    );

    const getState = registeredProviders.get('getState');
    const result = await getState?.({
      conversationId: 'conversation-1',
      workspace: '/',
      filePath: '/private/forged.docx',
    });

    expect(mocks.conversationGet).toHaveBeenCalledWith({ id: 'conversation-1' });
    expect(mocks.getState).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      workspace: '/trusted/workspace',
      filePath: '/private/forged.docx',
    });
    expect(result).toEqual({ ok: false, code: 'OUTSIDE_WORKSPACE' });
  });

  it('denies artifact access when the conversation has no authoritative workspace', async () => {
    mocks.conversationGet.mockResolvedValue({ extra: {} });

    const inspect = registeredProviders.get('inspect');
    const result = await inspect?.({
      conversationId: 'conversation-1',
      workspace: '/',
      filePath: '/private/forged.docx',
      expectedVersion: 'v1',
      selection: {
        kind: 'word',
        path: '/body/p[1]',
        paragraphText: 'Text',
        selectedText: 'Text',
        start: 0,
        end: 4,
      },
    });

    expect(result).toEqual({ ok: false, code: 'OUTSIDE_WORKSPACE' });
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
});
