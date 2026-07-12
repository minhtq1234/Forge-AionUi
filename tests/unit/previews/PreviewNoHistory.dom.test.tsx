/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test for the removal of the dead snapshot/history toolbar UI
 * (previously gated behind `SHOW_SNAPSHOT_HISTORY = false` in
 * PreviewToolbar.tsx). PreviewToolbar no longer accepts or renders any
 * history/snapshot affordance — this test guards against it silently coming
 * back (e.g. via a copy-pasted prop or a re-added gate).
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/styles/colors', () => ({
  iconColors: { secondary: 'currentColor' },
}));

import PreviewToolbar from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewToolbar';

type ToolbarProps = React.ComponentProps<typeof PreviewToolbar>;

const noop = () => undefined;

const createProps = (overrides: Partial<ToolbarProps> = {}): ToolbarProps => ({
  content_type: 'markdown',
  isMarkdown: true,
  isHTML: false,
  // Source/split-screen view is exactly the condition under which the old
  // (now-removed) `SHOW_SNAPSHOT_HISTORY` gate would have rendered the
  // snapshot + history buttons for markdown/html tabs.
  viewMode: 'source',
  isSplitScreenEnabled: false,
  showOpenInSystemButton: false,
  onViewModeChange: noop,
  onSplitScreenToggle: noop,
  onOpenInSystem: noop,
  onDownload: noop,
  ...overrides,
});

describe('PreviewToolbar has no snapshot/history UI', () => {
  it('renders no history or snapshot trigger for a markdown tab in source view', () => {
    render(<PreviewToolbar {...createProps()} />);

    expect(screen.queryByText(/history/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/snapshot/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/history/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/snapshot/i)).not.toBeInTheDocument();
  });

  it('renders no history or snapshot trigger for an html tab in split-screen mode', () => {
    render(
      <PreviewToolbar
        {...createProps({ content_type: 'html', isMarkdown: false, isHTML: true, isSplitScreenEnabled: true })}
      />
    );

    expect(screen.queryByText(/history/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/snapshot/i)).not.toBeInTheDocument();
  });

  it('accepts a normal editable-tab prop set with no history-related fields', () => {
    // Type-level guard: this object literal only satisfies ToolbarProps
    // because historyTarget/snapshotSaving/onSaveSnapshot/onRefreshHistory/
    // renderHistoryDropdown are no longer part of the props contract.
    const props = createProps();
    expect('historyTarget' in props).toBe(false);
    expect('snapshotSaving' in props).toBe(false);
    expect('onSaveSnapshot' in props).toBe(false);
    expect('onRefreshHistory' in props).toBe(false);
    expect('renderHistoryDropdown' in props).toBe(false);
  });
});
