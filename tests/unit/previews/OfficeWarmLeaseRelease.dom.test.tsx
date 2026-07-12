/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Task 11 — guard/characterization test: LRU eviction and tab close must fully
// release the office lease + stop the watch for the evicted/closed tab only,
// never for tabs that remain warm. Uses a focused harness that renders the
// warm-office-tab list exactly the way PreviewPanel does (`useWarmOfficeTabs`
// filtering + one `OfficeWatchViewer` per warm tab, `key={tab.id}`) so the
// real LRU hook and the real viewer's unmount cleanup both run — without
// pulling in PreviewPanel's toolbar/menu/editor dependencies, which are
// irrelevant to lease/watch release.

import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startInvoke: vi.fn(),
  stopInvoke: vi.fn(),
  preparePreviewInvoke: vi.fn(),
  releasePreviewInvoke: vi.fn(),
  startPreviewInvoke: vi.fn(),
  statusOn: vi.fn(),
  // A stable reference (not recreated per render) — otherwise `useTranslation()`
  // would hand OfficeWatchViewer a fresh `t` function on every parent re-render,
  // which sits in the watch effect's dependency array and would restart the
  // watch on every rerender instead of only on real tab-identity changes.
  translate: (key: string) => key,
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
        openFile: { invoke: vi.fn() },
        showItemInFolder: { invoke: vi.fn() },
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
  buildOfficeGuestScript: vi.fn(() => undefined),
  parseOfficeGuestMessage: vi.fn(() => null),
}));

vi.mock('@/renderer/components/media/WebviewHost', () => ({
  default: ({ url }: { url: string }) => <div data-testid='webview-host' data-url={url} />,
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

import { useWarmOfficeTabs } from '@/renderer/pages/conversation/Preview/hooks/useWarmOfficeTabs';
import OfficeWatchViewer from '@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer';

type HarnessTab = { id: string; file_path: string; workspace: string };

// Mirrors PreviewPanel's own render pattern (PreviewPanel.tsx:873-888): filter
// the open office tabs down to the warm set, mount one viewer per warm tab
// (keyed by tab id), hide inactive ones behind display:none, render nothing
// for cold tabs.
const OfficeWarmHarness: React.FC<{ tabs: HarnessTab[]; activeTabId: string }> = ({ tabs, activeTabId }) => {
  const warmIds = useWarmOfficeTabs(
    activeTabId,
    tabs.map((tab) => tab.id)
  );

  return (
    <div>
      {tabs
        .filter((tab) => warmIds.has(tab.id))
        .map((tab) => (
          <div
            key={tab.id}
            data-testid={`warm-${tab.id}`}
            style={{ display: tab.id === activeTabId ? undefined : 'none' }}
          >
            <OfficeWatchViewer
              docType='word'
              conversationId='conversation-1'
              file_path={tab.file_path}
              workspace={tab.workspace}
              refreshToken='1'
            />
          </div>
        ))}
    </div>
  );
};

const tabA: HarnessTab = { id: 'word-a', file_path: '/workspace/a.docx', workspace: '/workspace' };
const tabB: HarnessTab = { id: 'word-b', file_path: '/workspace/b.docx', workspace: '/workspace' };
const tabC: HarnessTab = { id: 'word-c', file_path: '/workspace/c.docx', workspace: '/workspace' };
const tabD: HarnessTab = { id: 'word-d', file_path: '/workspace/d.docx', workspace: '/workspace' };
const allTabs = [tabA, tabB, tabC, tabD];

const leaseIdFor = (filePath: string): string => `lease:${filePath}`;
const preparedFilePathFor = (filePath: string): string => `/leased${filePath}`;
// Note: the mocked watch URL is a fixed dummy value — none of these
// assertions inspect the webview URL, only the release/stop calls keyed by
// file_path and lease id, so a single shared URL is sufficient here.
const DUMMY_WATCH_URL = 'http://127.0.0.1:19999/';

async function flushOfficeWatchStart(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();
  });
}

describe('office lease/watch release on warm-tab eviction and close', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    mocks.preparePreviewInvoke.mockReset();
    mocks.preparePreviewInvoke.mockImplementation(async ({ filePath }: { filePath: string }) => ({
      ok: true,
      leaseId: leaseIdFor(filePath),
      filePath: preparedFilePathFor(filePath),
      workspace: '/leased',
    }));

    mocks.startInvoke.mockReset();
    mocks.startInvoke.mockResolvedValue({ url: DUMMY_WATCH_URL });

    mocks.startPreviewInvoke.mockReset();
    mocks.startPreviewInvoke.mockImplementation(async (request: { leaseId: string; url?: string }) => ({
      ok: true,
      url: request.url ?? DUMMY_WATCH_URL,
    }));

    mocks.stopInvoke.mockReset();
    mocks.stopInvoke.mockResolvedValue(undefined);

    mocks.releasePreviewInvoke.mockReset();
    mocks.releasePreviewInvoke.mockResolvedValue({ ok: true });

    mocks.statusOn.mockReset();
    mocks.statusOn.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('releases only the LRU-evicted tab, keeps the release for still-warm tabs unfired, then releases a closed tab exactly once', async () => {
    // Activate a -> b -> c: cap is 3, so all three stay warm and mounted; none
    // evicted yet. word-d has never been activated, so it never mounts.
    const view = render(<OfficeWarmHarness tabs={allTabs} activeTabId='word-a' />);
    await flushOfficeWatchStart();

    view.rerender(<OfficeWarmHarness tabs={allTabs} activeTabId='word-b' />);
    await flushOfficeWatchStart();
    view.rerender(<OfficeWarmHarness tabs={allTabs} activeTabId='word-c' />);
    await flushOfficeWatchStart();

    expect(screen.getByTestId('warm-word-a')).toBeInTheDocument();
    expect(screen.getByTestId('warm-word-b')).toBeInTheDocument();
    expect(screen.getByTestId('warm-word-c')).toBeInTheDocument();
    expect(screen.queryByTestId('warm-word-d')).not.toBeInTheDocument();

    // Every warm tab actually started its own watch + lease.
    expect(mocks.preparePreviewInvoke).toHaveBeenCalledWith(expect.objectContaining({ filePath: tabA.file_path }));
    expect(mocks.preparePreviewInvoke).toHaveBeenCalledWith(expect.objectContaining({ filePath: tabB.file_path }));
    expect(mocks.preparePreviewInvoke).toHaveBeenCalledWith(expect.objectContaining({ filePath: tabC.file_path }));
    expect(mocks.releasePreviewInvoke).not.toHaveBeenCalled();
    expect(mocks.stopInvoke).not.toHaveBeenCalled();

    // Activating the 4th (cold) tab mounts it and evicts the
    // least-recently-active warm tab: word-a (LRU of {c, b, a}).
    view.rerender(<OfficeWarmHarness tabs={allTabs} activeTabId='word-d' />);
    await flushOfficeWatchStart();

    expect(screen.getByTestId('warm-word-d')).toBeInTheDocument();
    expect(screen.queryByTestId('warm-word-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('warm-word-b')).toBeInTheDocument();
    expect(screen.getByTestId('warm-word-c')).toBeInTheDocument();

    // (1) The evicted tab's watch + lease are released exactly once, keyed to
    // its own (leased/prepared) file_path and lease id.
    expect(mocks.stopInvoke).toHaveBeenCalledTimes(1);
    expect(mocks.stopInvoke).toHaveBeenCalledWith({ file_path: preparedFilePathFor(tabA.file_path) });
    expect(mocks.releasePreviewInvoke).toHaveBeenCalledTimes(1);
    expect(mocks.releasePreviewInvoke).toHaveBeenCalledWith({ leaseId: leaseIdFor(tabA.file_path) });

    // (3) No release/stop fired for tabs that remain warm (b, c, d).
    expect(mocks.stopInvoke).not.toHaveBeenCalledWith({ file_path: preparedFilePathFor(tabB.file_path) });
    expect(mocks.stopInvoke).not.toHaveBeenCalledWith({ file_path: preparedFilePathFor(tabC.file_path) });
    expect(mocks.stopInvoke).not.toHaveBeenCalledWith({ file_path: preparedFilePathFor(tabD.file_path) });
    expect(mocks.releasePreviewInvoke).not.toHaveBeenCalledWith({ leaseId: leaseIdFor(tabB.file_path) });
    expect(mocks.releasePreviewInvoke).not.toHaveBeenCalledWith({ leaseId: leaseIdFor(tabC.file_path) });
    expect(mocks.releasePreviewInvoke).not.toHaveBeenCalledWith({ leaseId: leaseIdFor(tabD.file_path) });

    // (2) Now close tab b (drop it from the open-tabs list entirely, as
    // PreviewPanel's `officeTabs` would once PreviewContext removes it).
    // Warm set was {d, c, b}; b falls out of the id list and must release.
    const remainingTabs = [tabA, tabC, tabD];
    view.rerender(<OfficeWarmHarness tabs={remainingTabs} activeTabId='word-d' />);
    await flushOfficeWatchStart();

    expect(screen.queryByTestId('warm-word-b')).not.toBeInTheDocument();
    expect(screen.getByTestId('warm-word-c')).toBeInTheDocument();
    expect(screen.getByTestId('warm-word-d')).toBeInTheDocument();

    expect(mocks.stopInvoke).toHaveBeenCalledTimes(2);
    expect(mocks.stopInvoke).toHaveBeenCalledWith({ file_path: preparedFilePathFor(tabB.file_path) });
    expect(mocks.releasePreviewInvoke).toHaveBeenCalledTimes(2);
    expect(mocks.releasePreviewInvoke).toHaveBeenCalledWith({ leaseId: leaseIdFor(tabB.file_path) });

    // The earlier eviction (a) is not released a second time, and the tabs
    // still warm (c, d) remain unreleased.
    expect(mocks.releasePreviewInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ leaseId: leaseIdFor(tabA.file_path) })
    );
    expect(mocks.releasePreviewInvoke).not.toHaveBeenCalledWith({ leaseId: leaseIdFor(tabC.file_path) });
    expect(mocks.releasePreviewInvoke).not.toHaveBeenCalledWith({ leaseId: leaseIdFor(tabD.file_path) });
  });
});
