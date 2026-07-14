/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OfficeArtifactSelection } from '@/common/types/office/artifactEditor';
import type { WebviewHostProps } from '@/renderer/components/media/WebviewHost';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startInvoke: vi.fn(),
  stopInvoke: vi.fn(),
  preparePreviewInvoke: vi.fn(),
  releasePreviewInvoke: vi.fn(),
  startPreviewInvoke: vi.fn(),
  openFileInvoke: vi.fn(),
  showItemInFolderInvoke: vi.fn(),
  statusOn: vi.fn(),
  buildOfficeGuestScript: vi.fn(),
  parseOfficeGuestMessage: vi.fn(),
  translate: (key: string) => key,
  webviewProps: { current: null as WebviewHostProps | null },
  webviewPropsByUrl: new Map<string, WebviewHostProps>(),
}));

vi.mock('@/common', () => {
  const bridge = {
    start: { invoke: mocks.startInvoke },
    stop: { invoke: mocks.stopInvoke },
    status: { on: mocks.statusOn },
  };

  return {
    ipcBridge: {
      officeArtifact: {
        preparePreview: { invoke: mocks.preparePreviewInvoke },
        startPreview: { invoke: mocks.startPreviewInvoke },
        releasePreview: { invoke: mocks.releasePreviewInvoke },
      },
      shell: {
        openFile: { invoke: mocks.openFileInvoke },
        showItemInFolder: { invoke: mocks.showItemInFolderInvoke },
      },
      pptPreview: bridge,
      wordPreview: bridge,
      excelPreview: bridge,
    },
  };
});

vi.mock('@/common/adapter/httpBridge', () => ({
  getBaseUrl: () => '',
  isBackendHttpError: () => false,
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Preview/components/ArtifactEditor/officeGuestBridge', () => ({
  buildOfficeGuestScript: mocks.buildOfficeGuestScript,
  parseOfficeGuestMessage: mocks.parseOfficeGuestMessage,
}));

vi.mock('@/renderer/components/media/WebviewHost', () => ({
  default: (props: WebviewHostProps) => {
    mocks.webviewProps.current = props;
    mocks.webviewPropsByUrl.set(props.url, props);
    return <div data-testid='webview-host' data-url={props.url} />;
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Alert: ({ content }: { content?: React.ReactNode }) => <div role='alert'>{content}</div>,
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
  Spin: () => <div data-testid='spin' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}));

import { OFFICE_PREVIEW_PARTITION } from '@/common/types/office/artifactEditor';
import OfficeWatchViewer from '@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushOfficeWatchStart(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();
  });
}

const wordSelection: OfficeArtifactSelection = {
  kind: 'word',
  path: '/body/p[1]',
  paragraphText: 'Quarterly revenue',
  selectedText: 'revenue',
  start: 10,
  end: 17,
};

describe('OfficeWatchViewer lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.startInvoke.mockReset();
    mocks.startInvoke.mockResolvedValue({ url: '/api/office-watch-proxy/18791' });
    mocks.stopInvoke.mockReset();
    mocks.stopInvoke.mockResolvedValue(undefined);
    mocks.preparePreviewInvoke.mockReset();
    mocks.preparePreviewInvoke.mockResolvedValue({
      ok: true,
      leaseId: 'preview-lease-1',
      filePath: '/preview/a.docx',
      workspace: '/preview',
    });
    mocks.releasePreviewInvoke.mockReset();
    mocks.releasePreviewInvoke.mockResolvedValue({ ok: true });
    mocks.startPreviewInvoke.mockReset();
    mocks.startPreviewInvoke.mockImplementation(async (request: { url?: string }) => ({
      ok: true,
      url: request.url ?? 'http://127.0.0.1:26318/',
    }));
    mocks.openFileInvoke.mockReset();
    mocks.openFileInvoke.mockResolvedValue(undefined);
    mocks.showItemInFolderInvoke.mockReset();
    mocks.showItemInFolderInvoke.mockResolvedValue(undefined);
    mocks.statusOn.mockReset();
    mocks.statusOn.mockImplementation(() => vi.fn());
    mocks.buildOfficeGuestScript.mockReset();
    mocks.buildOfficeGuestScript.mockReturnValue('install-word-selection-bridge');
    mocks.parseOfficeGuestMessage.mockReset();
    mocks.webviewProps.current = null;
    mocks.webviewPropsByUrl.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps the initial loader over the mounted host until the guest finishes loading', async () => {
    render(<OfficeWatchViewer docType='word' file_path='/w/a.docx' workspace='/w' refreshToken='1' />);

    expect(screen.getByTestId('office-preview-loading')).toBeVisible();
    await flushOfficeWatchStart();

    expect(screen.getByTestId('office-preview-webview')).toBeVisible();
    expect(mocks.webviewProps.current?.showViewerControls).toBe(true);
    expect(screen.getByTestId('office-preview-loading')).toBeVisible();

    act(() => mocks.webviewProps.current?.onDidFinishLoad?.());

    expect(screen.queryByTestId('office-preview-loading')).not.toBeInTheDocument();
  });

  it('watches an isolated Word copy and releases it after the watcher stops', async () => {
    const view = render(
      <OfficeWatchViewer
        docType='word'
        conversationId='conversation-1'
        file_path='/w/a.docx'
        workspace='/w'
        refreshToken='1'
      />
    );
    await flushOfficeWatchStart();

    expect(mocks.preparePreviewInvoke).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      workspace: '/w',
      filePath: '/w/a.docx',
    });
    expect(mocks.startInvoke).toHaveBeenCalledWith({ file_path: '/preview/a.docx', workspace: '/preview' });
    expect(mocks.startPreviewInvoke).toHaveBeenCalledWith({
      leaseId: 'preview-lease-1',
      url: 'http://127.0.0.1:18791/',
    });

    view.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.stopInvoke).toHaveBeenCalledWith({ file_path: '/preview/a.docx' });
    expect(mocks.releasePreviewInvoke).toHaveBeenCalledWith({ leaseId: 'preview-lease-1' });
  });

  it('retains the preview lease when watcher shutdown fails', async () => {
    mocks.stopInvoke.mockRejectedValueOnce(new Error('watcher still running'));
    const view = render(
      <OfficeWatchViewer
        docType='word'
        conversationId='conversation-1'
        file_path='/w/a.docx'
        workspace='/w'
        refreshToken='1'
      />
    );
    await flushOfficeWatchStart();

    view.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.stopInvoke).toHaveBeenCalledWith({ file_path: '/preview/a.docx' });
    expect(mocks.releasePreviewInvoke).not.toHaveBeenCalled();
  });

  it('uses the main-process watch session for a slow desktop Excel preview', async () => {
    const view = render(
      <OfficeWatchViewer
        docType='excel'
        conversationId='conversation-1'
        file_path='/w/model.xlsx'
        workspace='/w'
        refreshToken='1'
      />
    );
    await flushOfficeWatchStart();

    expect(mocks.startPreviewInvoke).toHaveBeenCalledWith({ leaseId: 'preview-lease-1' });
    expect(mocks.startInvoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('webview-host')).toHaveAttribute('data-url', 'http://127.0.0.1:26318/');
    expect(mocks.webviewProps.current?.showViewerControls).toBe(true);

    view.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.stopInvoke).not.toHaveBeenCalled();
    expect(mocks.releasePreviewInvoke).toHaveBeenCalledWith({ leaseId: 'preview-lease-1' });
  });

  it('keeps the original file safe and offers desktop fallbacks when preview startup fails', async () => {
    mocks.startInvoke.mockResolvedValueOnce({ error: 'OFFICECLI_NOT_FOUND' });
    render(<OfficeWatchViewer docType='word' conversationId='conversation-1' file_path='/w/a.docx' workspace='/w' />);
    await flushOfficeWatchStart();

    expect(screen.getByText('preview.office.errors.originalSafe')).toBeVisible();
    fireEvent.click(screen.getByText('preview.office.editor.openDesktop'));
    fireEvent.click(screen.getByText('preview.office.editor.reveal'));

    expect(mocks.openFileInvoke).toHaveBeenCalledWith('/w/a.docx');
    expect(mocks.showItemInFolderInvoke).toHaveBeenCalledWith('/w/a.docx');
  });

  it('keeps PPT on its existing source path', async () => {
    render(<OfficeWatchViewer docType='ppt' file_path='/w/slides.pptx' workspace='/w' refreshToken='1' />);
    await flushOfficeWatchStart();

    expect(mocks.preparePreviewInvoke).not.toHaveBeenCalled();
    expect(mocks.startInvoke).toHaveBeenCalledWith({ file_path: '/w/slides.pptx', workspace: '/w' });
    expect(mocks.webviewProps.current?.showViewerControls).toBeFalsy();
  });

  it('retains the loaded host with a nonblocking indicator while a refresh starts', async () => {
    const onRefreshStateChange = vi.fn();
    const view = render(
      <OfficeWatchViewer
        docType='word'
        file_path='/w/a.docx'
        workspace='/w'
        refreshToken='1'
        onRefreshStateChange={onRefreshStateChange}
      />
    );
    await flushOfficeWatchStart();
    act(() => mocks.webviewProps.current?.onDidFinishLoad?.());
    const refreshStart = deferred<{ url: string }>();
    mocks.startInvoke.mockReturnValueOnce(refreshStart.promise);

    view.rerender(
      <OfficeWatchViewer
        docType='word'
        file_path='/w/a.docx'
        workspace='/w'
        refreshToken='2'
        onRefreshStateChange={onRefreshStateChange}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('office-preview-webview')).toBeVisible();
    expect(screen.getByTestId('webview-host')).toHaveAttribute('data-url', 'http://127.0.0.1:18791/');
    expect(screen.getByTestId('office-preview-refreshing')).toBeVisible();
    expect(screen.queryByTestId('office-preview-loading')).not.toBeInTheDocument();
    expect(onRefreshStateChange).toHaveBeenCalledWith('refreshing');

    refreshStart.resolve({ url: '/api/office-watch-proxy/18888' });
    await flushOfficeWatchStart();
    act(() => mocks.webviewProps.current?.onDidFinishLoad?.());

    expect(onRefreshStateChange).toHaveBeenLastCalledWith('refreshed');
    expect(screen.queryByTestId('office-preview-refreshing')).not.toBeInTheDocument();
  });

  it('uses an Arco alert when the initial guest load fails', async () => {
    render(<OfficeWatchViewer docType='word' file_path='/w/a.docx' workspace='/w' />);
    await flushOfficeWatchStart();

    act(() => mocks.webviewProps.current?.onDidFailLoad?.(-105, 'NAME_NOT_RESOLVED'));

    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByTestId('office-preview-webview')).not.toBeInTheDocument();
  });

  it('keeps the loaded host when a refresh start fails', async () => {
    const onRefreshStateChange = vi.fn();
    const view = render(
      <OfficeWatchViewer
        docType='word'
        file_path='/w/a.docx'
        workspace='/w'
        refreshToken='1'
        onRefreshStateChange={onRefreshStateChange}
      />
    );
    await flushOfficeWatchStart();
    act(() => mocks.webviewProps.current?.onDidFinishLoad?.());
    mocks.startInvoke.mockResolvedValueOnce({ error: 'OFFICECLI_START_FAILED' });

    view.rerender(
      <OfficeWatchViewer
        docType='word'
        file_path='/w/a.docx'
        workspace='/w'
        refreshToken='2'
        onRefreshStateChange={onRefreshStateChange}
      />
    );
    await flushOfficeWatchStart();

    expect(screen.getByTestId('office-preview-webview')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onRefreshStateChange).toHaveBeenLastCalledWith('refreshFailed');
  });

  it('keeps the active canvas when a refresh candidate fails to load', async () => {
    const onRefreshStateChange = vi.fn();
    const view = render(
      <OfficeWatchViewer
        docType='word'
        file_path='/w/a.docx'
        workspace='/w'
        refreshToken='1'
        onRefreshStateChange={onRefreshStateChange}
      />
    );
    await flushOfficeWatchStart();
    act(() => mocks.webviewPropsByUrl.get('http://127.0.0.1:18791/')?.onDidFinishLoad?.());
    mocks.startInvoke.mockResolvedValueOnce({ url: '/api/office-watch-proxy/18888' });

    view.rerender(
      <OfficeWatchViewer
        docType='word'
        file_path='/w/a.docx'
        workspace='/w'
        refreshToken='2'
        onRefreshStateChange={onRefreshStateChange}
      />
    );
    await flushOfficeWatchStart();

    expect(screen.getAllByTestId('webview-host').map((host) => host.getAttribute('data-url'))).toEqual([
      'http://127.0.0.1:18791/',
      'http://127.0.0.1:18888/',
    ]);

    act(() => mocks.webviewPropsByUrl.get('http://127.0.0.1:18888/')?.onDidFailLoad?.(-105, 'NAME_NOT_RESOLVED'));

    expect(screen.getByTestId('webview-host')).toHaveAttribute('data-url', 'http://127.0.0.1:18791/');
    expect(screen.queryByTestId('office-preview-refreshing')).not.toBeInTheDocument();
    expect(onRefreshStateChange).toHaveBeenLastCalledWith('refreshFailed');
  });

  it('configures the offline guest bridge and forwards parsed selections', async () => {
    const onSelectionChange = vi.fn();
    const scriptRequest = { id: 7, script: "window.__forgeOfficeMoveSelection('right')" };
    mocks.parseOfficeGuestMessage.mockReturnValue(wordSelection);

    render(
      <OfficeWatchViewer
        docType='word'
        file_path='/w/a.docx'
        workspace='/w'
        onSelectionChange={onSelectionChange}
        scriptRequest={scriptRequest}
      />
    );
    await flushOfficeWatchStart();

    expect(mocks.webviewProps.current?.partition).toBe(OFFICE_PREVIEW_PARTITION);
    expect(mocks.webviewProps.current?.injectedScript).toBe('install-word-selection-bridge');
    expect(mocks.webviewProps.current?.scriptRequest).toBe(scriptRequest);

    act(() =>
      mocks.webviewProps.current?.onConsoleMessage?.({
        message: '__FORGE_OFFICE_SELECTION__{}',
        sourceId: 'http://127.0.0.1:18791/app.js',
      })
    );

    expect(mocks.parseOfficeGuestMessage).toHaveBeenCalledWith(
      '__FORGE_OFFICE_SELECTION__{}',
      'http://127.0.0.1:18791/app.js'
    );
    expect(onSelectionChange).toHaveBeenCalledWith(wordSelection);
  });

  it('uses the trusted active watch URL when Electron omits the injected script source', async () => {
    const onSelectionChange = vi.fn();
    mocks.parseOfficeGuestMessage.mockReturnValue(wordSelection);

    render(
      <OfficeWatchViewer docType='word' file_path='/w/a.docx' workspace='/w' onSelectionChange={onSelectionChange} />
    );
    await flushOfficeWatchStart();

    act(() =>
      mocks.webviewProps.current?.onConsoleMessage?.({
        message: '__FORGE_OFFICE_SELECTION__{}',
        sourceId: '',
      })
    );

    expect(mocks.parseOfficeGuestMessage).toHaveBeenCalledWith(
      '__FORGE_OFFICE_SELECTION__{}',
      'http://127.0.0.1:18791/'
    );
    expect(onSelectionChange).toHaveBeenCalledWith(wordSelection);
  });
});

describe('OfficeWatchViewer helpers', () => {
  it('restarts only when a refresh token changes after initial mount', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    expect(mod.shouldRestartOfficeWatch(undefined, '0:0')).toBe(false);
    expect(mod.shouldRestartOfficeWatch('0:0', '0:1')).toBe(true);
    expect(mod.shouldRestartOfficeWatch('1:1', '1:1')).toBe(false);
  });

  it('does not report a refresh when the viewer switches to another file', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    expect(mod.shouldReportOfficeWatchRefresh('/workspace/a.docx', '/workspace/b.docx', 'a:0:1', 'b:0:1')).toBe(false);
  });

  it('ignores a start result after its watcher has been cancelled', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    expect(mod.shouldApplyOfficeWatchStartResult(true)).toBe(false);
  });

  it('waits for a queued stop before allowing the next watcher to start', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    const queue = mod.createOfficeWatchStopQueue();
    let releaseStop!: () => void;
    const stopPromise = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    queue.queueStop(() => stopPromise);

    let didStart = false;
    const waitForStop = queue.waitForStop().then(() => {
      didStart = true;
    });
    await Promise.resolve();
    expect(didStart).toBe(false);

    releaseStop();
    await waitForStop;
    expect(didStart).toBe(true);
  });

  it('changes the embedded preview key when a refresh token changes', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    const url = 'http://127.0.0.1:40123/';
    expect(mod.getOfficeWatchViewKey(url, '0:0')).not.toBe(mod.getOfficeWatchViewKey(url, '0:1'));
  });
});

describe('resolveOfficeWatchUrl', () => {
  it('resolves proxy paths to direct loopback urls in Electron', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    expect(mod.resolveOfficeWatchUrl('/api/ppt-proxy/59324', 'ppt')).toBe('http://127.0.0.1:59324/');
  });
});

describe('resolveOfficeErrorActions', () => {
  it('web mode shows the server install guide when officecli is missing', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    expect(mod.resolveOfficeErrorActions('OFFICECLI_NOT_FOUND', false)).toEqual({
      showServerInstallGuide: true,
      showInstallLink: false,
      showRetry: true,
    });
  });

  it('non-recoverable errors offer no actions', async () => {
    const mod = await import('@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer');
    expect(mod.resolveOfficeErrorActions('PATH_OUTSIDE_SANDBOX', false)).toEqual({
      showServerInstallGuide: false,
      showInstallLink: false,
      showRetry: false,
    });
  });
});
