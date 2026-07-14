/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getBaseUrl, isBackendHttpError } from '@/common/adapter/httpBridge';
import { OFFICE_PREVIEW_PARTITION, type OfficeArtifactSelection } from '@/common/types/office/artifactEditor';
import WebviewHost, {
  type WebviewHostConsoleMessage,
  type WebviewHostScriptRequest,
} from '@/renderer/components/media/WebviewHost';
import {
  buildOfficeGuestScript,
  parseOfficeGuestMessage,
} from '@/renderer/pages/conversation/Preview/components/ArtifactEditor/officeGuestBridge';
import type { OfficePreviewRefreshState } from '@/renderer/pages/conversation/Preview/types';
import { openExternalUrl } from '@/renderer/utils/platform';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Alert, Button, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type DocType = 'ppt' | 'word' | 'excel';
type OfficeWatchErrorCode =
  | 'OFFICECLI_NOT_FOUND'
  | 'OFFICECLI_INSTALL_FAILED'
  | 'OFFICECLI_PORT_TIMEOUT'
  | 'OFFICECLI_START_FAILED'
  | 'PATH_OUTSIDE_SANDBOX';

const BRIDGE = {
  ppt: ipcBridge.pptPreview,
  word: ipcBridge.wordPreview,
  excel: ipcBridge.excelPreview,
} as const;

// Web-server proxy base paths (Electron uses the direct localhost URL instead)
const PROXY_PATH: Record<DocType, string> = {
  ppt: '/api/ppt-proxy',
  word: '/api/office-watch-proxy',
  excel: '/api/office-watch-proxy',
};

const IFRAME_TITLE: Record<DocType, string> = {
  ppt: 'PPT Preview',
  word: 'Word Preview',
  excel: 'Excel Preview',
};

const I18N_KEYS = {
  ppt: {
    loading: 'preview.ppt.loading',
    installing: 'preview.ppt.installing',
    startFailed: 'preview.ppt.startFailed',
    installHint: 'preview.ppt.installHint',
  },
  word: {
    loading: 'preview.word.watch.loading',
    installing: 'preview.word.watch.installing',
    startFailed: 'preview.word.watch.startFailed',
    installHint: 'preview.word.watch.installHint',
  },
  excel: {
    loading: 'preview.excel.watch.loading',
    installing: 'preview.excel.watch.installing',
    startFailed: 'preview.excel.watch.startFailed',
    installHint: 'preview.excel.watch.installHint',
  },
} as const;

const OFFICE_ERROR_I18N_KEYS: Record<OfficeWatchErrorCode, string> = {
  OFFICECLI_NOT_FOUND: 'preview.office.errors.officecliNotFound',
  OFFICECLI_INSTALL_FAILED: 'preview.office.errors.installFailed',
  OFFICECLI_PORT_TIMEOUT: 'preview.office.errors.portTimeout',
  OFFICECLI_START_FAILED: 'preview.office.errors.startFailed',
  PATH_OUTSIDE_SANDBOX: 'preview.office.errors.outsideSandbox',
};

export const OFFICECLI_INSTALL_URL = 'https://github.com/iOfficeAI/OfficeCLI/releases';

type OfficeWatchViewerProps = {
  docType: DocType;
  conversationId?: string;
  file_path?: string;
  content?: string;
  workspace?: string;
  refreshToken?: string;
  onRefreshStateChange?: (state: OfficePreviewRefreshState) => void;
  onSelectionChange?: (selection: OfficeArtifactSelection) => void;
  scriptRequest?: WebviewHostScriptRequest;
};

type OfficeWatchErrorState = {
  code?: OfficeWatchErrorCode;
  message: string;
};

type OfficeWatchView = {
  key: string;
  url: string;
};

export const shouldRestartOfficeWatch = (previousToken: string | undefined, nextToken: string | undefined): boolean =>
  previousToken !== undefined && nextToken !== undefined && previousToken !== nextToken;

export const shouldReportOfficeWatchRefresh = (
  previousFilePath: string | undefined,
  nextFilePath: string | undefined,
  previousToken: string | undefined,
  nextToken: string | undefined
): boolean => previousFilePath === nextFilePath && shouldRestartOfficeWatch(previousToken, nextToken);

export const shouldApplyOfficeWatchStartResult = (cancelled: boolean): boolean => !cancelled;

type OfficeWatchStopQueue = {
  waitForStop: () => Promise<void>;
  queueStop: (stop: () => Promise<unknown>) => void;
};

export const createOfficeWatchStopQueue = (): OfficeWatchStopQueue => {
  let pendingStop: Promise<void> = Promise.resolve();

  return {
    waitForStop: () => pendingStop,
    queueStop: (stop) => {
      pendingStop = pendingStop
        .catch((): void => {})
        .then(async (): Promise<void> => {
          await stop();
        })
        .catch((): void => {});
    },
  };
};

export const getOfficeWatchViewKey = (url: string, refreshToken: string | undefined): string =>
  refreshToken ? `${url}:${refreshToken}` : url;

export function resolveOfficeWatchUrl(url: string, docType: DocType): string {
  const proxyMatch = url.match(/^\/api\/(?:office-watch-proxy|ppt-proxy)\/(\d+)(\/.*)?$/);
  if (proxyMatch && isElectronDesktop()) {
    const [, port, suffix] = proxyMatch;
    return `http://127.0.0.1:${port}${suffix || '/'}`;
  }

  if (url.startsWith('/')) {
    if (!isElectronDesktop()) {
      const proxyPortMatch = url.match(/^\/api\/(?:office-watch-proxy|ppt-proxy)\/(\d+)(\/.*)?$/);
      if (proxyPortMatch) {
        const [, port, suffix] = proxyPortMatch;
        // The backend registers /{port} and /{port}/{*path} only; a bare
        // trailing slash matches neither route and 404s (#3212), so emit a
        // suffix only when it carries a real sub-path.
        const subPath = suffix && suffix !== '/' ? suffix : '';
        return `${PROXY_PATH[docType]}/${port}${subPath}`;
      }
    }
    return `${getBaseUrl()}${url}`;
  }

  if (!isElectronDesktop()) {
    const parsed = new URL(url);
    return `${PROXY_PATH[docType]}/${parsed.port}`;
  }

  return url;
}

function normalizeOfficeWatchErrorCode(error?: string | null): OfficeWatchErrorCode | undefined {
  switch (error) {
    case 'OFFICECLI_NOT_FOUND':
    case 'OFFICECLI_INSTALL_FAILED':
    case 'OFFICECLI_PORT_TIMEOUT':
    case 'OFFICECLI_START_FAILED':
    case 'PATH_OUTSIDE_SANDBOX':
      return error;
    case 'OFFICECLI_FAILED':
    case 'PREVIEW_FAILED':
      return 'OFFICECLI_START_FAILED';
    default:
      return undefined;
  }
}

// officecli runs next to the backend, so on web deployments it must be
// installed on the server — same command the backend's auto-installer uses.
export const OFFICECLI_SERVER_INSTALL_COMMAND = 'curl -fsSL https://d.officecli.ai/install.sh | bash';

export function resolveOfficeErrorActions(
  code: OfficeWatchErrorCode | undefined,
  isElectron: boolean
): { showServerInstallGuide: boolean; showInstallLink: boolean; showRetry: boolean } {
  const officecliMissing = code === 'OFFICECLI_NOT_FOUND' || code === 'OFFICECLI_INSTALL_FAILED';
  return {
    // A desktop install link would point web users at the wrong machine —
    // give them the server-side command instead.
    showServerInstallGuide: !isElectron && officecliMissing,
    showInstallLink: isElectron && code === 'OFFICECLI_NOT_FOUND',
    showRetry: officecliMissing || code === 'OFFICECLI_PORT_TIMEOUT',
  };
}

/**
 * Shared Office watch viewer.
 *
 * Launches an `officecli watch` child process via IPC, waits for the local
 * HTTP server to be ready, then renders it in a webview (Electron) or iframe
 * (web server mode). Cleans up the process on unmount.
 *
 * Used by PptViewer, OfficeDocViewer, and ExcelViewer — each passes its
 * docType to select the correct IPC bridge, proxy path, and i18n keys.
 */
const OfficeWatchViewer: React.FC<OfficeWatchViewerProps> = ({
  docType,
  conversationId,
  file_path,
  workspace,
  refreshToken,
  onRefreshStateChange,
  onSelectionChange,
  scriptRequest,
}) => {
  const { t } = useTranslation();
  const keys = I18N_KEYS[docType];

  const [watchView, setWatchView] = useState<OfficeWatchView | null>(null);
  const [refreshView, setRefreshView] = useState<OfficeWatchView | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<'starting' | 'installing'>('starting');
  const [error, setError] = useState<OfficeWatchErrorState | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const watchUrlRef = useRef<string | null>(null);
  const refreshViewRef = useRef<OfficeWatchView | null>(null);
  const contentReadyRef = useRef(false);
  const filePathRef = useRef(file_path);
  const workspaceRef = useRef(workspace);
  const docTypeRef = useRef(docType);
  const refreshTokenRef = useRef<string | undefined>(refreshToken);
  const stopQueueRef = useRef<OfficeWatchStopQueue>(createOfficeWatchStopQueue());

  const guestScript = useMemo(() => (docType === 'ppt' ? undefined : buildOfficeGuestScript(docType)), [docType]);

  const updateWatchView = useCallback((view: OfficeWatchView | null): void => {
    watchUrlRef.current = view?.url ?? null;
    setWatchView(view);
  }, []);

  const updateRefreshView = useCallback((view: OfficeWatchView | null): void => {
    refreshViewRef.current = view;
    setRefreshView(view);
  }, []);

  const handlePreviewLoaded = useCallback(() => {
    contentReadyRef.current = true;
    setInitialLoading(false);
    setError(null);
  }, []);

  const handlePreviewLoadFailed = useCallback(() => {
    if (contentReadyRef.current) return;
    setInitialLoading(false);
    setError({ message: t(keys.startFailed) });
  }, [keys.startFailed, t]);

  const handleRefreshLoaded = useCallback(
    (view: OfficeWatchView): void => {
      if (refreshViewRef.current?.key !== view.key) return;
      contentReadyRef.current = true;
      updateWatchView(view);
      updateRefreshView(null);
      setRefreshing(false);
      setError(null);
      onRefreshStateChange?.('refreshed');
    },
    [onRefreshStateChange, updateRefreshView, updateWatchView]
  );

  const handleRefreshLoadFailed = useCallback(
    (view: OfficeWatchView): void => {
      if (refreshViewRef.current?.key !== view.key) return;
      updateRefreshView(null);
      setRefreshing(false);
      onRefreshStateChange?.('refreshFailed');
    },
    [onRefreshStateChange, updateRefreshView]
  );

  const handleConsoleMessage = useCallback(
    (event: WebviewHostConsoleMessage): void => {
      if (!onSelectionChange) return;
      const selection = parseOfficeGuestMessage(event.message, event.sourceId || watchUrlRef.current || '');
      if (selection) onSelectionChange(selection);
    },
    [onSelectionChange]
  );

  useEffect(() => {
    const bridge = BRIDGE[docType];
    const contextChanged =
      filePathRef.current !== file_path || workspaceRef.current !== workspace || docTypeRef.current !== docType;
    const refreshRequested = shouldReportOfficeWatchRefresh(
      filePathRef.current,
      file_path,
      refreshTokenRef.current,
      refreshToken
    );
    const isRefresh = !contextChanged && refreshRequested && contentReadyRef.current && watchUrlRef.current !== null;
    filePathRef.current = file_path;
    workspaceRef.current = workspace;
    docTypeRef.current = docType;
    refreshTokenRef.current = refreshToken;
    const notifyRefreshState = (state: OfficePreviewRefreshState): void => {
      if (isRefresh) onRefreshStateChange?.(state);
    };

    if (!isRefresh && (contextChanged || !contentReadyRef.current)) {
      contentReadyRef.current = false;
      setRefreshing(false);
      setInitialLoading(true);
      updateRefreshView(null);
      updateWatchView(null);
    }

    if (!file_path) {
      setInitialLoading(false);
      setError({ message: t('preview.errors.missingFilePath') });
      return;
    }

    let cancelled = false;

    const unsubStatus = bridge.status.on((evt) => {
      if (cancelled) return;
      if (evt.state === 'installing') setStatus('installing');
      else if (evt.state === 'starting') setStatus('starting');
    });

    let watchStarted = false;
    let previewLeaseId: string | undefined;
    let watchedFilePath = file_path;
    let watchedWorkspace = workspace;

    const start = async () => {
      await stopQueueRef.current.waitForStop();
      if (cancelled) return;
      setStatus('starting');
      if (isRefresh) {
        updateRefreshView(null);
        setRefreshing(true);
        notifyRefreshState('refreshing');
      } else {
        setInitialLoading(true);
        setError(null);
      }
      try {
        if (docType !== 'ppt' && isElectronDesktop()) {
          const preview = await ipcBridge.officeArtifact.preparePreview.invoke({
            conversationId,
            workspace: workspace ?? '',
            filePath: file_path,
          });
          if (preview.ok === false) throw new Error(t(keys.startFailed));
          previewLeaseId = preview.leaseId;
          watchedFilePath = preview.filePath;
          watchedWorkspace = preview.workspace;
          if (cancelled) return;
        }

        const usesMainProcessWatch = docType === 'excel' && isElectronDesktop() && previewLeaseId;
        let result = usesMainProcessWatch
          ? await ipcBridge.officeArtifact.startPreview.invoke({ leaseId: previewLeaseId })
          : await bridge.start.invoke({ file_path: watchedFilePath, workspace: watchedWorkspace });
        if (!usesMainProcessWatch && !('ok' in result) && !result.error) {
          watchStarted = true;
          if (docType === 'word' && isElectronDesktop() && previewLeaseId && result.url) {
            result = await ipcBridge.officeArtifact.startPreview.invoke({
              leaseId: previewLeaseId,
              url: resolveOfficeWatchUrl(result.url, docType),
            });
          }
        }
        let resultError: string | undefined;
        let url: string | undefined;
        if ('ok' in result) {
          if (result.ok === false) resultError = result.code;
          else url = result.url;
        } else {
          resultError = result.error;
          url = result.url;
        }
        const errorCode = normalizeOfficeWatchErrorCode(resultError);
        watchStarted = watchStarted || (!errorCode && !usesMainProcessWatch);
        if (!shouldApplyOfficeWatchStartResult(cancelled)) return;
        if (errorCode) {
          const nextError = {
            code: errorCode,
            message: t(OFFICE_ERROR_I18N_KEYS[errorCode]),
          };
          if (isRefresh) {
            setRefreshing(false);
            notifyRefreshState('refreshFailed');
          } else {
            setError(nextError);
            setInitialLoading(false);
          }
          return;
        }

        if (!url) {
          throw new Error(t(keys.startFailed));
        }
        // Small delay to ensure the watch HTTP server is fully ready for the webview
        await new Promise((r) => setTimeout(r, 300));
        if (!cancelled) {
          const resolvedUrl = resolveOfficeWatchUrl(url, docType);
          const view = { key: getOfficeWatchViewKey(resolvedUrl, refreshToken), url: resolvedUrl };
          if (isRefresh) updateRefreshView(view);
          else updateWatchView(view);
        }
      } catch (err) {
        if (shouldApplyOfficeWatchStartResult(cancelled)) {
          const backendCode = isBackendHttpError(err) ? normalizeOfficeWatchErrorCode(err.code) : undefined;
          if (backendCode) {
            const nextError = {
              code: backendCode,
              message: t(OFFICE_ERROR_I18N_KEYS[backendCode]),
            };
            if (isRefresh) {
              setRefreshing(false);
              notifyRefreshState('refreshFailed');
            } else {
              setError(nextError);
              setInitialLoading(false);
            }
            return;
          }
          const msg = err instanceof Error ? err.message : t(keys.startFailed);
          if (isRefresh) {
            setRefreshing(false);
            notifyRefreshState('refreshFailed');
          } else {
            setError({ message: msg });
            setInitialLoading(false);
          }
        }
      }
    };

    const startPromise = start();

    return () => {
      cancelled = true;
      unsubStatus();
      stopQueueRef.current.queueStop(async () => {
        await startPromise;
        if (watchStarted) {
          await bridge.stop.invoke({ file_path: watchedFilePath });
        }
        if (previewLeaseId) {
          await ipcBridge.officeArtifact.releasePreview
            .invoke({ leaseId: previewLeaseId })
            .catch((): undefined => undefined);
        }
      });
    };
  }, [
    docType,
    conversationId,
    file_path,
    onRefreshStateChange,
    refreshToken,
    retryKey,
    t,
    updateRefreshView,
    updateWatchView,
    workspace,
  ]);

  if (error) {
    const { showServerInstallGuide, showInstallLink, showRetry } = resolveOfficeErrorActions(
      error.code,
      isElectronDesktop()
    );
    const desktopFallbackPath = docType !== 'ppt' && isElectronDesktop() ? file_path : undefined;

    return (
      <div className='h-full w-full flex items-center justify-center bg-bg-1'>
        <Alert
          type='error'
          className='max-w-400px'
          content={
            <div>
              <div className='text-14px text-t-primary mb-8px'>{error.message}</div>
              {docType !== 'ppt' && (
                <div className='text-12px text-t-secondary mb-12px'>{t('preview.office.errors.originalSafe')}</div>
              )}
              {!error.code && <div className='text-12px text-t-secondary mb-12px'>{t(keys.installHint)}</div>}
              {showServerInstallGuide && (
                <div className='text-left mb-12px'>
                  <div className='text-12px text-t-secondary mb-8px'>{t('preview.office.serverInstall.hint')}</div>
                  <code className='block select-all rounded-8px bg-2 px-10px py-8px text-12px text-t-primary'>
                    {OFFICECLI_SERVER_INSTALL_COMMAND}
                  </code>
                  <div className='text-12px text-t-secondary mt-8px'>{t('preview.office.serverInstall.icuNote')}</div>
                </div>
              )}
              <div className='flex justify-center gap-8px'>
                {showInstallLink && (
                  <Button type='text' size='small' onClick={() => void openExternalUrl(OFFICECLI_INSTALL_URL)}>
                    {t('preview.office.installLinkText')}
                  </Button>
                )}
                {showRetry && (
                  <Button size='small' type='primary' onClick={() => setRetryKey((value) => value + 1)}>
                    {t('common.retry', { defaultValue: 'Retry' })}
                  </Button>
                )}
                {desktopFallbackPath && (
                  <Button
                    size='small'
                    onClick={() =>
                      void ipcBridge.shell.openFile.invoke(desktopFallbackPath).catch((): undefined => undefined)
                    }
                  >
                    {t('preview.office.editor.openDesktop')}
                  </Button>
                )}
                {desktopFallbackPath && (
                  <Button
                    size='small'
                    type='text'
                    onClick={() =>
                      void ipcBridge.shell.showItemInFolder
                        .invoke(desktopFallbackPath)
                        .catch((): undefined => undefined)
                    }
                  >
                    {t('preview.office.editor.reveal')}
                  </Button>
                )}
              </div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className='relative h-full w-full overflow-hidden bg-bg-1'>
      {[
        ...(watchView ? [{ active: true, view: watchView }] : []),
        ...(refreshView ? [{ active: false, view: refreshView }] : []),
      ].map(({ active, view }) => (
        <div
          key={view.key}
          data-testid='office-preview-webview'
          className={active ? 'h-full w-full' : 'pointer-events-none invisible absolute inset-0'}
        >
          {isElectronDesktop() ? (
            <WebviewHost
              url={view.url}
              className='bg-bg-1'
              showViewerControls={docType === 'word' || docType === 'excel'}
              partition={docType === 'ppt' ? undefined : OFFICE_PREVIEW_PARTITION}
              injectedScript={guestScript}
              scriptRequest={active ? scriptRequest : undefined}
              onConsoleMessage={active ? handleConsoleMessage : undefined}
              onDidFinishLoad={active ? handlePreviewLoaded : () => handleRefreshLoaded(view)}
              onDidFailLoad={active ? handlePreviewLoadFailed : () => handleRefreshLoadFailed(view)}
            />
          ) : (
            <iframe
              src={view.url}
              className='w-full h-full border-0 bg-bg-1'
              title={IFRAME_TITLE[docType]}
              onLoad={active ? handlePreviewLoaded : () => handleRefreshLoaded(view)}
              onError={active ? handlePreviewLoadFailed : () => handleRefreshLoadFailed(view)}
            />
          )}
        </div>
      ))}

      {initialLoading && (
        <div
          data-testid='office-preview-loading'
          className='absolute inset-0 z-10 flex items-center justify-center bg-bg-1'
        >
          <div className='flex flex-col items-center gap-12px'>
            <Spin size={32} />
            <span className='text-13px text-t-secondary'>
              {status === 'installing' ? t(keys.installing) : t(keys.loading)}
            </span>
          </div>
        </div>
      )}

      {refreshing && (
        <div
          data-testid='office-preview-refreshing'
          className='pointer-events-none absolute right-12px top-12px z-10 flex items-center gap-6px rounded-6px bg-bg-2 px-8px py-6px text-12px text-t-secondary shadow-sm'
        >
          <Spin size={14} />
          <span>{t(keys.loading)}</span>
        </div>
      )}
    </div>
  );
};

export default OfficeWatchViewer;
