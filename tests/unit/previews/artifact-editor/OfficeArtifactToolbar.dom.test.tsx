import type { OfficeArtifactInspection } from '@/common/types/office/artifactEditor';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const mocks = vi.hoisted(() => ({ copyText: vi.fn() }));

vi.mock('@/renderer/utils/ui/clipboard', () => ({ copyText: mocks.copyText }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}));

import { OfficeArtifactToolbar } from '@/renderer/pages/conversation/Preview/components/ArtifactEditor/OfficeArtifactToolbar';
import styles from '@/renderer/pages/conversation/Preview/components/ArtifactEditor/OfficeArtifactToolbar.module.css';

const translations: Record<string, string> = {
  'preview.office.editor.editSelection': 'Edit selection',
  'preview.office.editor.formulaBar': 'Formula bar',
  'preview.office.editor.apply': 'Apply',
  'preview.office.editor.cancel': 'Cancel',
  'preview.office.editor.bold': 'Bold',
  'preview.office.editor.italic': 'Italic',
  'preview.office.editor.underline': 'Underline',
  'preview.office.editor.undo': 'Undo',
  'preview.office.editor.openDesktop': 'Open in desktop app',
  'preview.office.editor.openedDesktop': 'Opened in desktop app',
  'preview.office.editor.more': 'More',
  'preview.office.editor.reveal': 'Reveal in folder',
  'preview.office.editor.refresh': 'Refresh preview',
  'preview.office.editor.saving': 'Saving',
  'preview.office.editor.saved': 'Saved to workspace',
  'preview.office.editor.saveFailed': 'Save failed',
  'preview.office.editor.fileChanged': 'File changed elsewhere',
  'preview.office.editor.inspecting': 'Preparing edit controls',
  'preview.office.editor.selectWordToEdit': 'Select text in the document to edit it',
  'preview.office.editor.selectExcelToEdit': 'Select a cell to edit it',
  'preview.office.editor.readyToEdit': 'Ready to edit the selected content',
  'preview.office.editor.conflictRecovery': 'Your edit was not saved and is still here. The workspace file is safe.',
  'preview.office.editor.saveFailureRecovery': 'Your edit is still here and the workspace file was not changed.',
  'preview.office.editor.copyDraft': 'Copy draft',
  'preview.office.editor.refreshLatest': 'Refresh latest',
  'preview.office.editor.retrySave': 'Retry save',
  'common.download': 'Download',
};

const excelInspection: OfficeArtifactInspection = {
  kind: 'excel',
  range: 'Forecast!B4',
  cells: [{ path: '/Forecast/B4', displayText: '6', input: '=SUM(A1:A3)' }],
  canEdit: true,
};

const wordInspection: OfficeArtifactInspection = {
  kind: 'word',
  path: '/body/p[1]',
  selectedText: 'Revenue',
  start: 0,
  end: 7,
  canReplace: true,
  canFormat: true,
  formatting: { bold: false, italic: true, underline: false },
};

const createProps = (overrides: Partial<React.ComponentProps<typeof OfficeArtifactToolbar>> = {}) => ({
  documentKind: 'excel' as const,
  inspection: excelInspection,
  status: 'ready' as const,
  undoDepth: 1,
  apply: vi.fn(),
  undo: vi.fn(),
  openInDesktopApp: vi.fn(),
  download: vi.fn(),
  revealInFolder: vi.fn(),
  refresh: vi.fn(),
  moveSelection: vi.fn(),
  ...overrides,
});

describe('OfficeArtifactToolbar', () => {
  beforeEach(() => {
    mocks.copyText.mockReset();
    mocks.copyText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each(['word', 'excel'] as const)(
    'renders no idle status strip or view-only hint before anything is selected in a %s file',
    (documentKind) => {
      render(<OfficeArtifactToolbar {...createProps({ documentKind, inspection: null, undoDepth: 0 })} />);

      expect(screen.queryByText('Preview only — open in the desktop app to edit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('office-toolbar-status-strip')).not.toBeInTheDocument();
      expect(screen.queryByText('Select text in the document to edit it')).not.toBeInTheDocument();
      expect(screen.queryByText('Select a cell to edit it')).not.toBeInTheDocument();
      expect(screen.getByTestId('office-toolbar-actions')).toContainElement(
        screen.getByTestId('office-toolbar-open-desktop')
      );
    }
  );

  it('renders Open in desktop app as a quiet, secondary split-button action', () => {
    render(<OfficeArtifactToolbar {...createProps({ inspection: null, undoDepth: 0 })} />);

    const openInDesktopButton = screen.getByTestId('office-toolbar-open-desktop');
    expect(openInDesktopButton).toHaveAccessibleName('Open in desktop app');
    expect(openInDesktopButton).not.toHaveClass('arco-btn-primary');
    expect(openInDesktopButton).toHaveClass('arco-btn-secondary');
  });

  it('uses semantic status-strip treatments without mixing status into the action row', () => {
    const props = createProps({ inspection: null, status: 'saving' });
    const view = render(<OfficeArtifactToolbar {...props} />);

    expect(screen.getByTestId('office-toolbar-status-strip')).toHaveClass(styles.statusProgress);
    expect(screen.getByTestId('office-toolbar-actions')).not.toHaveTextContent('Saving');

    view.rerender(<OfficeArtifactToolbar {...props} status='saved' />);
    expect(screen.getByTestId('office-toolbar-status-strip')).toHaveClass(styles.statusSuccess);

    view.rerender(<OfficeArtifactToolbar {...props} status='saveFailed' />);
    expect(screen.getByTestId('office-toolbar-status-strip')).toHaveClass(styles.statusError);
    expect(screen.getByRole('alert')).toHaveTextContent('Your edit is still here');
  });

  it('keeps a successful ready status visible after selecting editable content', () => {
    render(<OfficeArtifactToolbar {...createProps()} />);

    expect(screen.getByText('Ready to edit the selected content')).toBeVisible();
    expect(screen.getByTestId('office-toolbar-status-strip')).toHaveClass(styles.statusSuccess);
  });

  it('announces selection inspection while preparing edit controls', () => {
    render(<OfficeArtifactToolbar {...createProps({ inspection: null, status: 'inspecting' })} />);

    expect(screen.getByText('Preparing edit controls')).toHaveAttribute('aria-live', 'polite');
  });

  it('commits an Excel formula with Enter and cancels with Escape', async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<OfficeArtifactToolbar {...props} />);
    const input = screen.getByRole('textbox', { name: 'Formula bar' });

    await user.clear(input);
    await user.type(input, '=A1*2{Enter}');
    expect(props.apply).toHaveBeenCalledWith({ kind: 'setCell', input: '=A1*2' });
    await user.type(input, 'discard{Escape}');
    expect(input).toHaveValue('=SUM(A1:A3)');
  });

  it('moves the spreadsheet selection with Tab, Shift+Tab, and arrow keys', () => {
    const props = createProps();
    render(<OfficeArtifactToolbar {...props} />);
    const input = screen.getByRole('textbox', { name: 'Formula bar' });

    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(props.moveSelection).toHaveBeenNthCalledWith(1, 'right');
    expect(props.moveSelection).toHaveBeenNthCalledWith(2, 'left');
    expect(props.moveSelection).toHaveBeenNthCalledWith(3, 'down');
  });

  it('applies supported Word formatting directly from accessible controls', async () => {
    const user = userEvent.setup();
    const props = createProps({ inspection: wordInspection });
    render(<OfficeArtifactToolbar {...props} />);

    await user.click(screen.getByRole('button', { name: 'Bold' }));
    await user.click(screen.getByRole('button', { name: 'Italic' }));

    expect(props.apply).toHaveBeenNthCalledWith(1, { kind: 'formatText', property: 'bold', enabled: true });
    expect(props.apply).toHaveBeenNthCalledWith(2, { kind: 'formatText', property: 'italic', enabled: false });
  });

  it('replaces a Word selection and resets a cancelled draft', async () => {
    const user = userEvent.setup();
    const props = createProps({ inspection: wordInspection });
    render(<OfficeArtifactToolbar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Edit selection' }));
    let input = await screen.findByRole('textbox', { name: 'Edit selection' });

    fireEvent.change(input, { target: { value: 'Gross profit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit selection' }));
    input = await screen.findByRole('textbox', { name: 'Edit selection' });
    expect(input).toHaveValue('Revenue');

    fireEvent.change(input, { target: { value: 'Net revenue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(props.apply).toHaveBeenCalledWith({ kind: 'replaceText', value: 'Net revenue' });
  });

  it('preserves and exposes a Word draft when the workspace file changes', async () => {
    const user = userEvent.setup();
    const props = createProps({ inspection: wordInspection });
    const view = render(<OfficeArtifactToolbar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Edit selection' }));
    const input = await screen.findByRole('textbox', { name: 'Edit selection' });
    fireEvent.change(input, { target: { value: 'Draft kept locally' } });

    view.rerender(<OfficeArtifactToolbar {...props} status='fileChanged' />);

    expect(screen.getByRole('textbox', { name: 'Edit selection' })).toHaveValue('Draft kept locally');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByText('Your edit was not saved and is still here. The workspace file is safe.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Copy draft' }));
    expect(mocks.copyText).toHaveBeenCalledWith('Draft kept locally');
    await user.click(screen.getByRole('button', { name: 'Refresh latest' }));
    expect(props.refresh).toHaveBeenCalledOnce();
  });

  it('opens the file in the desktop app from the split-button main action', async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<OfficeArtifactToolbar {...props} />);

    await user.click(screen.getByTestId('office-toolbar-open-desktop'));
    expect(props.openInDesktopApp).toHaveBeenCalledOnce();
  });

  it('exposes Undo, Download, Reveal in folder, and Refresh from the split-button dropdown', async () => {
    const user = userEvent.setup();
    const props = createProps({ undoDepth: 1 });
    render(<OfficeArtifactToolbar {...props} />);

    await user.click(screen.getByRole('button', { name: 'More' }));

    expect(await screen.findByRole('menuitem', { name: 'Undo' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Reveal in folder' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Refresh preview' })).toBeVisible();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Undo' }));
    expect(props.undo).toHaveBeenCalledOnce();
  });

  it('disables the dropdown Undo item once there is nothing to undo', async () => {
    const user = userEvent.setup();
    render(<OfficeArtifactToolbar {...createProps({ undoDepth: 0 })} />);

    await user.click(screen.getByRole('button', { name: 'More' }));

    const undoItem = await screen.findByRole('menuitem', { name: 'Undo' });
    expect(undoItem).toHaveClass('arco-dropdown-menu-disabled');
    expect(undoItem).toHaveAttribute('tabindex', '-1');
  });

  it('downloads and reveals the file from the split-button dropdown', async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<OfficeArtifactToolbar {...props} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByText('Download'));
    expect(props.download).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByText('Reveal in folder'));
    expect(props.revealInFolder).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByText('Refresh preview'));
    expect(props.refresh).toHaveBeenCalledOnce();
  });

  it('shows a loading state on the split-button main action while opening the desktop app', () => {
    render(<OfficeArtifactToolbar {...createProps({ status: 'openingDesktop' })} />);

    expect(screen.getByTestId('office-toolbar-open-desktop')).toHaveClass('arco-btn-loading');
  });

  it('announces successful saves only when the status is saved', () => {
    const props = createProps({ status: 'saving' });
    const view = render(<OfficeArtifactToolbar {...props} />);
    expect(screen.getByText('Saving')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByText('Saved to workspace')).not.toBeInTheDocument();

    view.rerender(<OfficeArtifactToolbar {...props} status='saved' />);

    expect(screen.getByText('Saved to workspace')).toHaveAttribute('aria-live', 'polite');
  });

  it('uses primary Apply buttons for Excel and Word editing', async () => {
    const user = userEvent.setup();
    render(<OfficeArtifactToolbar {...createProps()} />);
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveClass('arco-btn-primary');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveAttribute('aria-label', 'Apply');

    render(<OfficeArtifactToolbar {...createProps({ inspection: wordInspection })} />);
    const editSelection = screen.getByRole('button', { name: 'Edit selection' });
    expect(editSelection).toHaveAttribute('aria-label', 'Edit selection');
    await user.click(editSelection);

    expect(
      (await screen.findAllByRole('button', { name: 'Apply' })).every((button) =>
        button.classList.contains('arco-btn-primary')
      )
    ).toBe(true);
  });

  it('disables destructive editing for a multi-cell selection without a dead-end status', () => {
    const inspection: OfficeArtifactInspection = {
      kind: 'excel',
      range: 'Forecast!B4:C4',
      cells: [
        { path: '/Forecast/B4', displayText: '6', input: '6' },
        { path: '/Forecast/C4', displayText: '12', input: '12' },
      ],
      canEdit: false,
    };
    render(<OfficeArtifactToolbar {...createProps({ inspection })} />);

    expect(screen.queryByRole('textbox', { name: 'Formula bar' })).not.toBeInTheDocument();
    // A multi-cell selection isn't directly editable, but this is a normal,
    // working state -- not a dead end -- so it must not claim a failure or
    // point the user at the desktop app.
    const statusText = screen.getByText('Select a cell to edit it');
    expect(statusText).not.toHaveAttribute('role', 'alert');
    expect(statusText.closest('[data-testid="office-toolbar-status-strip"]')).toHaveClass(styles.statusNeutral);
  });

  it('renders no Ask Forge control, including in the dropdown menu', async () => {
    const user = userEvent.setup();
    render(<OfficeArtifactToolbar {...createProps()} />);

    expect(screen.queryByText('Ask Forge')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask Forge' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More' }));

    expect(screen.queryByText('Ask Forge')).not.toBeInTheDocument();
  });
});
