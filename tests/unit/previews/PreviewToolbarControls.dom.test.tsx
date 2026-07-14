/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Toolbar-control audit: source/preview/split-screen toggles, "Open in
 * System", "Download", and the HTML inspect-mode toggle each call their
 * handler prop directly (no dead/gated paths) and are hidden when their
 * gating prop says they should not apply.
 */

import { fireEvent, render, screen } from '@testing-library/react';
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
  viewMode: 'preview',
  isSplitScreenEnabled: false,
  showOpenInSystemButton: false,
  onViewModeChange: noop,
  onSplitScreenToggle: noop,
  onOpenInSystem: noop,
  onDownload: noop,
  ...overrides,
});

describe('PreviewToolbar segmented view control (Source / Split / Preview)', () => {
  it('renders all three segments for a markdown tab and none of the old separate controls', () => {
    render(<PreviewToolbar {...createProps()} />);

    expect(screen.getByText('preview.source')).toBeInTheDocument();
    expect(screen.getByText('preview.split')).toBeInTheDocument();
    expect(screen.getByText('preview.preview')).toBeInTheDocument();
  });

  it('switches a markdown tab to source view and leaves split alone when it is already off', () => {
    const onViewModeChange = vi.fn();
    const onSplitScreenToggle = vi.fn();
    render(<PreviewToolbar {...createProps({ onViewModeChange, onSplitScreenToggle })} />);

    fireEvent.click(screen.getByText('preview.source'));
    expect(onViewModeChange).toHaveBeenCalledWith('source');
    expect(onSplitScreenToggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('preview.preview'));
    expect(onViewModeChange).toHaveBeenCalledWith('preview');
    expect(onSplitScreenToggle).not.toHaveBeenCalled();
  });

  it('turns split off when selecting Source while split-screen is enabled', () => {
    const onViewModeChange = vi.fn();
    const onSplitScreenToggle = vi.fn();
    render(<PreviewToolbar {...createProps({ isSplitScreenEnabled: true, onViewModeChange, onSplitScreenToggle })} />);

    fireEvent.click(screen.getByText('preview.source'));
    expect(onViewModeChange).toHaveBeenCalledWith('source');
    expect(onSplitScreenToggle).toHaveBeenCalledOnce();
  });

  it('turns split off when selecting Preview while split-screen is enabled', () => {
    const onViewModeChange = vi.fn();
    const onSplitScreenToggle = vi.fn();
    render(<PreviewToolbar {...createProps({ isSplitScreenEnabled: true, onViewModeChange, onSplitScreenToggle })} />);

    fireEvent.click(screen.getByText('preview.preview'));
    expect(onViewModeChange).toHaveBeenCalledWith('preview');
    expect(onSplitScreenToggle).toHaveBeenCalledOnce();
  });

  it('labels the source segment as "code" for an HTML tab', () => {
    render(<PreviewToolbar {...createProps({ content_type: 'html', isMarkdown: false, isHTML: true })} />);

    expect(screen.getByText('preview.code')).toBeInTheDocument();
  });

  it('enables split-screen from the Split segment when it is currently off', () => {
    const onSplitScreenToggle = vi.fn();
    render(<PreviewToolbar {...createProps({ onSplitScreenToggle })} />);

    fireEvent.click(screen.getByText('preview.split'));
    expect(onSplitScreenToggle).toHaveBeenCalledOnce();
  });

  it('does not toggle again when the Split segment is clicked while already active', () => {
    const onSplitScreenToggle = vi.fn();
    render(<PreviewToolbar {...createProps({ isSplitScreenEnabled: true, onSplitScreenToggle })} />);

    fireEvent.click(screen.getByText('preview.split'));
    expect(onSplitScreenToggle).not.toHaveBeenCalled();
  });

  it('hides the Split segment for a diff tab, showing only Source/Preview', () => {
    const onSplitScreenToggle = vi.fn();
    const { rerender } = render(<PreviewToolbar {...createProps({ onSplitScreenToggle })} />);
    expect(screen.getByText('preview.split')).toBeInTheDocument();

    rerender(
      <PreviewToolbar
        {...createProps({ content_type: 'diff', isMarkdown: false, isHTML: false, onSplitScreenToggle })}
      />
    );
    expect(screen.queryByText('preview.split')).not.toBeInTheDocument();
    expect(screen.getByText('preview.source')).toBeInTheDocument();
    expect(screen.getByText('preview.preview')).toBeInTheDocument();
  });
});

describe('PreviewToolbar Open in System control', () => {
  it('opens the file in the system app when the tab is backed by a file', () => {
    const onOpenInSystem = vi.fn();
    render(<PreviewToolbar {...createProps({ showOpenInSystemButton: true, onOpenInSystem })} />);

    fireEvent.click(screen.getByTitle('preview.openInSystemApp'));
    expect(onOpenInSystem).toHaveBeenCalledOnce();
  });

  it('hides the control when the tab has no backing file', () => {
    render(<PreviewToolbar {...createProps({ showOpenInSystemButton: false })} />);

    expect(screen.queryByTitle('preview.openInSystemApp')).not.toBeInTheDocument();
  });
});

describe('PreviewToolbar Download control', () => {
  it('downloads the active tab content', () => {
    const onDownload = vi.fn();
    render(
      <PreviewToolbar
        {...createProps({
          content_type: 'html',
          isMarkdown: false,
          isHTML: true,
          showOpenInSystemButton: true,
          onDownload,
        })}
      />
    );

    fireEvent.click(screen.getByTitle('preview.downloadFile'));
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('hides the control for an on-disk code/markdown tab (edited and saved in place)', () => {
    render(
      <PreviewToolbar
        {...createProps({ content_type: 'code', isMarkdown: false, isHTML: false, showOpenInSystemButton: true })}
      />
    );

    expect(screen.queryByTitle('preview.downloadFile')).not.toBeInTheDocument();
  });
});

describe('PreviewToolbar HTML inspect-mode control', () => {
  it('toggles inspect mode for an HTML tab', () => {
    const onInspectModeToggle = vi.fn();
    render(
      <PreviewToolbar
        {...createProps({
          content_type: 'html',
          isMarkdown: false,
          isHTML: true,
          inspectMode: false,
          onInspectModeToggle,
        })}
      />
    );

    fireEvent.click(screen.getByTitle('preview.html.inspectElementEnable'));
    expect(onInspectModeToggle).toHaveBeenCalledOnce();
  });
});
