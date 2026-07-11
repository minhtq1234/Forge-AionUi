/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPTER_BRIDGE_EVENT_KEY } from '@/common/adapter/native/constants';
import { initMainAdapterWithWindow } from '@/common/adapter/main';

type FakeWebContents = {
  isDestroyed: () => boolean;
  send: ReturnType<typeof vi.fn>;
};

type FakeBrowserWindow = {
  isDestroyed: () => boolean;
  on: ReturnType<typeof vi.fn>;
  webContents: FakeWebContents;
};

type InvokeEvent = {
  sender: FakeWebContents;
};

type InvokeHandler = (event: InvokeEvent, info: unknown) => unknown;

const mocks = vi.hoisted(() => ({
  bridgeEmitter: {
    emit: vi.fn(),
  },
  handlers: new Map<string, InvokeHandler>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    adapter: (config: { on: (emitter: typeof mocks.bridgeEmitter) => void }) => {
      config.on(mocks.bridgeEmitter);
    },
  },
}));

const registeredWindowDisposers: Array<() => void> = [];

function createRegisteredSender(): FakeWebContents {
  const webContents: FakeWebContents = {
    isDestroyed: () => false,
    send: vi.fn(),
  };
  const window: FakeBrowserWindow = {
    isDestroyed: () => false,
    on: vi.fn(),
    webContents,
  };
  registeredWindowDisposers.push(initMainAdapterWithWindow(window as never));
  return webContents;
}

function getInvokeHandler(): InvokeHandler {
  const handler = mocks.handlers.get(ADAPTER_BRIDGE_EVENT_KEY);
  expect(handler).toBeDefined();
  return handler!;
}

function createRequest(name: string, data: unknown = undefined): string {
  return JSON.stringify({
    name,
    data: {
      id: 'request-1234',
      data,
    },
  });
}

beforeEach(() => {
  mocks.bridgeEmitter.emit.mockReset();
});

afterEach(() => {
  while (registeredWindowDisposers.length > 0) {
    registeredWindowDisposers.pop()?.();
  }
});

describe('main adapter IPC security boundary', () => {
  it('allows a registered window to invoke a manifested native provider', async () => {
    const sender = createRegisteredSender();
    const request = createRequest('subscribe-webui.start', { port: 25808 });

    await getInvokeHandler()({ sender }, request);

    expect(mocks.bridgeEmitter.emit).toHaveBeenCalledWith('subscribe-webui.start', {
      id: 'request-1234',
      data: { port: 25808 },
    });
  });

  it('rejects calls from a renderer that is not registered with the adapter', async () => {
    const sender: FakeWebContents = {
      isDestroyed: () => false,
      send: vi.fn(),
    };

    await expect(getInvokeHandler()({ sender }, createRequest('subscribe-webui.start'))).rejects.toThrow(
      /sender is not registered/i
    );
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects provider names that are absent from the native channel manifest', async () => {
    const sender = createRegisteredSender();

    await expect(getInvokeHandler()({ sender }, createRequest('subscribe-unknown.privileged-action'))).rejects.toThrow(
      /operation is not allowed/i
    );
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without dispatching an event', async () => {
    const sender = createRegisteredSender();

    await expect(getInvokeHandler()({ sender }, '{broken')).rejects.toThrow(/malformed json/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects an envelope without a request id', async () => {
    const sender = createRegisteredSender();
    const request = JSON.stringify({
      name: 'subscribe-webui.start',
      data: { data: { port: 25808 } },
    });

    await expect(getInvokeHandler()({ sender }, request)).rejects.toThrow(/invalid envelope/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects inbound payloads larger than 16 MiB before parsing them', async () => {
    const sender = createRegisteredSender();
    const oversizedRequest = createRequest('subscribe-theme:set-active', 'x'.repeat(16 * 1024 * 1024));

    await expect(getInvokeHandler()({ sender }, oversizedRequest)).rejects.toThrow(/payload exceeds/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects unknown provider payload fields before dispatch', async () => {
    const sender = createRegisteredSender();
    const request = createRequest('subscribe-webui.start', { port: 25808, unexpected: true });

    await expect(getInvokeHandler()({ sender }, request)).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects a payload supplied to a void provider before dispatch', async () => {
    const sender = createRegisteredSender();
    const request = createRequest('subscribe-window-controls:close', { force: true });

    await expect(getInvokeHandler()({ sender }, request)).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('rejects invalid nested provider data before dispatch', async () => {
    const sender = createRegisteredSender();
    const request = createRequest('subscribe-show-open', {
      filters: [{ name: 'Docs', extensions: ['pdf'], unexpected: true }],
    });

    await expect(getInvokeHandler()({ sender }, request)).rejects.toThrow(/invalid operation payload/i);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });

  it('does not expose rejected payload values in the adapter error', async () => {
    const sender = createRegisteredSender();
    const secret = 'secret-adapter-value';
    const request = createRequest('subscribe-notification.show', {
      title: 'Notice',
      body: 'Body',
      token: secret,
    });

    let thrown: unknown;
    try {
      await getInvokeHandler()({ sender }, request);
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).toContain('invalid operation payload');
    expect(String(thrown)).not.toContain(secret);
    expect(mocks.bridgeEmitter.emit).not.toHaveBeenCalled();
  });
});
