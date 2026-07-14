/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { PreviewProvider, usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';

vi.mock('@/common', () => ({
  ipcBridge: {
    fileStream: {
      contentUpdate: { on: vi.fn(() => vi.fn()) },
    },
    preview: {
      open: { on: vi.fn(() => vi.fn()) },
    },
    fs: {
      writeFile: { invoke: vi.fn() },
      getFileMetadata: { invoke: vi.fn().mockResolvedValue(null) },
      readFile: { invoke: vi.fn() },
      getImageBase64: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}));

/** Tiny consumer that exercises openPreview via buttons so behavior can be asserted through the DOM. */
const PreviewConsumer: React.FC = () => {
  const { tabs, openPreview, updateContent } = usePreviewContext();

  return (
    <div>
      <button
        type='button'
        onClick={() =>
          openPreview('content-a', 'code', { file_path: '/workspace/a.ts', file_name: 'a.ts' }, { preview: true })
        }
      >
        open-a-preview
      </button>
      <button
        type='button'
        onClick={() =>
          openPreview('content-b', 'code', { file_path: '/workspace/b.ts', file_name: 'b.ts' }, { preview: true })
        }
      >
        open-b-preview
      </button>
      <button
        type='button'
        onClick={() => openPreview('content-c', 'code', { file_path: '/workspace/c.ts', file_name: 'c.ts' })}
      >
        open-c-pinned
      </button>
      <button type='button' onClick={() => updateContent('dirty content')}>
        make-active-dirty
      </button>
      <div data-testid='tab-count'>{tabs.length}</div>
      <ul>
        {tabs.map((tab) => (
          <li
            key={tab.id}
            data-testid='tab'
            data-file-path={tab.metadata?.file_path}
            data-preview={String(!!tab.preview)}
          >
            {tab.metadata?.file_path}
          </li>
        ))}
      </ul>
    </div>
  );
};

describe('PreviewContext provisional preview-tab slot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('reuses the provisional slot when opening successive preview tabs', () => {
    render(
      <PreviewProvider>
        <PreviewConsumer />
      </PreviewProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('open-a-preview'));
    });
    act(() => {
      fireEvent.click(screen.getByText('open-b-preview'));
    });

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    const tabEls = screen.getAllByTestId('tab');
    expect(tabEls).toHaveLength(1);
    expect(tabEls[0]).toHaveAttribute('data-file-path', '/workspace/b.ts');
    expect(tabEls[0]).toHaveAttribute('data-preview', 'true');
  });

  it('does not let a pinned open reuse/replace the provisional slot', () => {
    render(
      <PreviewProvider>
        <PreviewConsumer />
      </PreviewProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('open-a-preview'));
    });
    act(() => {
      fireEvent.click(screen.getByText('open-c-pinned'));
    });

    expect(screen.getByTestId('tab-count')).toHaveTextContent('2');
    const tabEls = screen.getAllByTestId('tab');
    const paths = tabEls.map((el) => el.getAttribute('data-file-path'));
    expect(paths).toEqual(expect.arrayContaining(['/workspace/a.ts', '/workspace/c.ts']));

    const aTab = tabEls.find((el) => el.getAttribute('data-file-path') === '/workspace/a.ts');
    const cTab = tabEls.find((el) => el.getAttribute('data-file-path') === '/workspace/c.ts');
    expect(aTab).toHaveAttribute('data-preview', 'true');
    expect(cTab).toHaveAttribute('data-preview', 'false');
  });

  it('never clobbers a dirty provisional tab: it is promoted to pinned and a new provisional slot opens', () => {
    render(
      <PreviewProvider>
        <PreviewConsumer />
      </PreviewProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('open-a-preview'));
    });
    act(() => {
      fireEvent.click(screen.getByText('make-active-dirty'));
    });
    act(() => {
      fireEvent.click(screen.getByText('open-b-preview'));
    });

    expect(screen.getByTestId('tab-count')).toHaveTextContent('2');
    const tabEls = screen.getAllByTestId('tab');
    const aTab = tabEls.find((el) => el.getAttribute('data-file-path') === '/workspace/a.ts');
    const bTab = tabEls.find((el) => el.getAttribute('data-file-path') === '/workspace/b.ts');
    expect(aTab).toBeTruthy();
    expect(bTab).toBeTruthy();
    // The dirty tab (a) was promoted to pinned rather than being clobbered.
    expect(aTab).toHaveAttribute('data-preview', 'false');
    // The new open (b) becomes the fresh provisional slot.
    expect(bTab).toHaveAttribute('data-preview', 'true');
  });
});
