import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { OfficeArtifactToolbar } from '@/renderer/pages/conversation/Preview/components/ArtifactEditor';
import PreviewToolbar from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewToolbar';

const renderToolbar = () => {
  const openInDesktopApp = vi.fn();
  const officeToolbar = (
    <OfficeArtifactToolbar
      inspection={null}
      status='ready'
      undoDepth={0}
      apply={vi.fn()}
      undo={vi.fn()}
      askForge={vi.fn()}
      openInDesktopApp={openInDesktopApp}
      download={vi.fn()}
      revealInFolder={vi.fn()}
      refresh={vi.fn()}
      moveSelection={vi.fn()}
    />
  );

  const view = render(
    <PreviewToolbar
      content_type='word'
      isMarkdown={false}
      isHTML={false}
      viewMode='preview'
      isSplitScreenEnabled={false}
      file_name='report.docx'
      showOpenInSystemButton={false}
      historyTarget={null}
      snapshotSaving={false}
      onViewModeChange={vi.fn()}
      onSplitScreenToggle={vi.fn()}
      onSaveSnapshot={vi.fn()}
      onRefreshHistory={vi.fn()}
      renderHistoryDropdown={() => null}
      onOpenInSystem={vi.fn()}
      onDownload={vi.fn()}
      officeToolbar={officeToolbar}
    />
  );

  return { ...view, openInDesktopApp };
};

describe('Office artifact preview integration', () => {
  it('replaces the generic preview toolbar with exactly one artifact toolbar row', () => {
    const { container } = renderToolbar();

    expect(screen.getAllByTestId('office-artifact-toolbar')).toHaveLength(1);
    expect(container.firstElementChild).toBe(screen.getByTestId('office-artifact-toolbar'));
    expect(container.querySelector('.overflow-x-auto')).not.toBeInTheDocument();
  });

  it('uses the artifact editor desktop action instead of the retired external-edit controls', () => {
    const { openInDesktopApp } = renderToolbar();

    screen.getByRole('button', { name: 'preview.office.editor.openDesktop' }).click();

    expect(openInDesktopApp).toHaveBeenCalledOnce();
    expect(screen.queryByText('preview.office.externalEdit.editInDefaultApp')).not.toBeInTheDocument();
  });
});
