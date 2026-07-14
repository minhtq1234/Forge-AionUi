/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
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

describe('PreviewToolbar save control', () => {
  it('renders an enabled Save control with an unsaved-changes indicator for a dirty text tab', () => {
    const onSave = vi.fn();
    render(<PreviewToolbar {...createProps({ isDirty: true, onSave })} />);

    expect(screen.getByText('preview.office.editor.unsavedChanges')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: 'common.save' });
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows a quiet saved/idle marker and renders no Save button for a clean text tab', () => {
    const onSave = vi.fn();
    render(<PreviewToolbar {...createProps({ isDirty: false, onSave })} />);

    expect(screen.queryByText('preview.office.editor.unsavedChanges')).not.toBeInTheDocument();
    expect(screen.getByText('preview.office.editor.saved')).toBeInTheDocument();

    // No disabled Save button sitting next to the idle marker — the button only
    // exists while there is something actionable to save.
    expect(screen.queryByRole('button', { name: 'common.save' })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders the Save control for a code tab', () => {
    render(
      <PreviewToolbar
        {...createProps({ content_type: 'code', isMarkdown: false, isHTML: false, isDirty: true, onSave: vi.fn() })}
      />
    );

    expect(screen.getByRole('button', { name: 'common.save' })).toBeInTheDocument();
  });

  it('does not render the Save control for non text-editable content types (e.g. diff)', () => {
    render(
      <PreviewToolbar
        {...createProps({ content_type: 'diff', isMarkdown: false, isHTML: false, isDirty: true, onSave: vi.fn() })}
      />
    );

    expect(screen.queryByRole('button', { name: 'common.save' })).not.toBeInTheDocument();
  });
});
