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

/** Tiny consumer that exercises pin-related context behavior through the DOM. */
const PreviewConsumer: React.FC = () => {
  const { tabs, openPreview, updateContent, pinTab } = usePreviewContext();

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
        onClick={() => openPreview('content-a', 'code', { file_path: '/workspace/a.ts', file_name: 'a.ts' })}
      >
        open-a-pinned
      </button>
      <button type='button' onClick={() => updateContent('edited')}>
        edit-active
      </button>
      <button
        type='button'
        onClick={() => {
          const first = tabs[0];
          if (first) pinTab(first.id);
        }}
      >
        pin-first-tab
      </button>
      <div data-testid='tab-count'>{tabs.length}</div>
      <ul>
        {tabs.map((tab) => (
          <li
            key={tab.id}
            data-testid='tab'
            data-file-path={tab.metadata?.file_path}
            data-preview={String(!!tab.preview)}
            data-dirty={String(!!tab.isDirty)}
          >
            {tab.metadata?.file_path}
          </li>
        ))}
      </ul>
    </div>
  );
};

describe('PreviewContext tab pinning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('pinTab sets the target tab preview flag to false', () => {
    render(
      <PreviewProvider>
        <PreviewConsumer />
      </PreviewProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('open-a-preview'));
    });

    expect(screen.getByTestId('tab')).toHaveAttribute('data-preview', 'true');

    act(() => {
      fireEvent.click(screen.getByText('pin-first-tab'));
    });

    expect(screen.getByTestId('tab')).toHaveAttribute('data-preview', 'false');
  });

  it('auto-pins a provisional tab when its content is edited', () => {
    render(
      <PreviewProvider>
        <PreviewConsumer />
      </PreviewProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('open-a-preview'));
    });

    expect(screen.getByTestId('tab')).toHaveAttribute('data-preview', 'true');

    act(() => {
      fireEvent.click(screen.getByText('edit-active'));
    });

    const tab = screen.getByTestId('tab');
    expect(tab).toHaveAttribute('data-preview', 'false');
    expect(tab).toHaveAttribute('data-dirty', 'true');
  });

  it('pins the existing provisional tab when a pinned-intent open dedupes onto it', () => {
    render(
      <PreviewProvider>
        <PreviewConsumer />
      </PreviewProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('open-a-preview'));
    });

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    expect(screen.getByTestId('tab')).toHaveAttribute('data-preview', 'true');

    act(() => {
      fireEvent.click(screen.getByText('open-a-pinned'));
    });

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    expect(screen.getByTestId('tab')).toHaveAttribute('data-preview', 'false');
  });

  it('does not demote an already-pinned tab when a preview-intent open dedupes onto it', () => {
    render(
      <PreviewProvider>
        <PreviewConsumer />
      </PreviewProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('open-a-pinned'));
    });

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    expect(screen.getByTestId('tab')).toHaveAttribute('data-preview', 'false');

    act(() => {
      fireEvent.click(screen.getByText('open-a-preview'));
    });

    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    expect(screen.getByTestId('tab')).toHaveAttribute('data-preview', 'false');
  });
});
