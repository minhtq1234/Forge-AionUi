import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  compactContextLocally: vi.fn(async () => ({
    snapshot: {},
    through_turn_id: 'turn-1',
    model: { provider_id: 'provider-1', model: 'model-1' },
  })),
  provider: vi.fn(),
  initApplicationBridge: vi.fn(),
  initDialogBridge: vi.fn(),
  initNotificationBridge: vi.fn(),
  initSystemSettingsBridge: vi.fn(),
  initThemeBridge: vi.fn(),
  initUpdateBridge: vi.fn(),
  initWebuiBridge: vi.fn(),
  initWindowControlsBridge: vi.fn(),
}));

vi.mock('@process/bridge/applicationBridge', () => ({ initApplicationBridge: mocks.initApplicationBridge }));
vi.mock('@process/bridge/dialogBridge', () => ({ initDialogBridge: mocks.initDialogBridge }));
vi.mock('@process/bridge/notificationBridge', () => ({ initNotificationBridge: mocks.initNotificationBridge }));
vi.mock('@process/bridge/systemSettingsBridge', () => ({ initSystemSettingsBridge: mocks.initSystemSettingsBridge }));
vi.mock('@process/bridge/themeBridge', () => ({ initThemeBridge: mocks.initThemeBridge }));
vi.mock('@process/bridge/updateBridge', () => ({ initUpdateBridge: mocks.initUpdateBridge }));
vi.mock('@process/bridge/webuiBridge', () => ({ initWebuiBridge: mocks.initWebuiBridge }));
vi.mock('@process/bridge/windowControlsBridge', () => ({
  initWindowControlsBridge: mocks.initWindowControlsBridge,
  registerWindowMaximizeListeners: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    localContextCompaction: {
      generate: { provider: mocks.provider },
    },
  },
}));

vi.mock('@process/services/contextCompactionService', () => ({
  compactContextLocally: mocks.compactContextLocally,
}));

import { initAllBridges, initContextCompactionBridge } from '@process/bridge';

describe('initContextCompactionBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the main-process provider and delegates compaction requests', async () => {
    initContextCompactionBridge();

    expect(mocks.provider).toHaveBeenCalledOnce();
    const handler = mocks.provider.mock.calls[0]?.[0] as (input: { conversation_id: string }) => Promise<unknown>;
    const input = { conversation_id: 'conversation-1' };

    await expect(handler(input)).resolves.toEqual({
      ok: true,
      result: {
        snapshot: {},
        through_turn_id: 'turn-1',
        model: { provider_id: 'provider-1', model: 'model-1' },
      },
    });

    expect(mocks.compactContextLocally).toHaveBeenCalledWith(input);
  });

  it('returns a fulfilled error envelope so renderer invocations cannot hang', async () => {
    mocks.compactContextLocally.mockRejectedValueOnce(
      Object.assign(new Error('provider_rate_limited'), { code: 'provider_rate_limited' })
    );
    initContextCompactionBridge();
    const handler = mocks.provider.mock.calls[0]?.[0] as (input: { conversation_id: string }) => Promise<unknown>;

    await expect(handler({ conversation_id: 'conversation-1' })).resolves.toEqual({
      ok: false,
      error_code: 'provider_rate_limited',
    });
  });

  it('keeps context compaction registered in the top-level bridge initializer', () => {
    initAllBridges();

    expect(mocks.provider).toHaveBeenCalledOnce();
  });
});
