/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  OfficeArtifactInspectResult,
  OfficeArtifactMutationResult,
  OfficeArtifactSelection,
  OfficeArtifactStateResult,
} from '@/common/types/office/artifactEditor';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getState: vi.fn<(request: unknown) => Promise<OfficeArtifactStateResult>>(),
  inspect: vi.fn<(request: unknown) => Promise<OfficeArtifactInspectResult>>(),
  apply: vi.fn<(request: unknown) => Promise<OfficeArtifactMutationResult>>(),
  undo: vi.fn<(request: unknown) => Promise<OfficeArtifactMutationResult>>(),
  openFile: vi.fn<(filePath: string) => Promise<void>>(),
  copyText: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    officeArtifact: {
      getState: { invoke: mocks.getState },
      inspect: { invoke: mocks.inspect },
      apply: { invoke: mocks.apply },
      undo: { invoke: mocks.undo },
    },
    shell: { openFile: { invoke: mocks.openFile } },
  },
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({ copyText: mocks.copyText }));

// Deliberately omits `preview.office.editor.unsupported`: if any code path still
// requests that key, the mock falls back to rendering the raw key so a stray
// usage is caught instead of silently resolving to real copy.
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
  'common.download': 'Download',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

import { OfficeArtifactToolbar } from '@/renderer/pages/conversation/Preview/components/ArtifactEditor/OfficeArtifactToolbar';
import { useOfficeArtifactEditor } from '@/renderer/pages/conversation/Preview/components/ArtifactEditor/useOfficeArtifactEditor';

const shapeSelection: OfficeArtifactSelection = {
  kind: 'word',
  path: '/body/shape[1]',
  paragraphText: 'Quarterly revenue',
  selectedText: 'Quarterly revenue',
  start: 0,
  end: 17,
};

const bodyTextSelection: OfficeArtifactSelection = {
  kind: 'word',
  path: '/body/p[1]',
  paragraphText: 'Quarterly revenue',
  selectedText: 'Quarterly',
  start: 0,
  end: 9,
};

const supportedInspection: OfficeArtifactInspectResult = {
  ok: true,
  version: 'v1',
  inspection: {
    kind: 'word',
    path: '/body/p[1]',
    selectedText: 'Quarterly',
    start: 0,
    end: 9,
    canReplace: true,
    canFormat: true,
    formatting: { bold: false, italic: false, underline: false },
  },
};

const createOptions = () => ({
  conversationId: 'conversation-1',
  workspace: '/workspace',
  filePath: '/workspace/report.docx',
  externalRevision: 0,
  onArtifactMutated: vi.fn<() => void>(),
});

const renderToolbar = (props: Pick<React.ComponentProps<typeof OfficeArtifactToolbar>, 'status' | 'inspection'>) =>
  render(
    <OfficeArtifactToolbar
      documentKind='word'
      undoDepth={0}
      apply={vi.fn()}
      undo={vi.fn()}
      openInDesktopApp={vi.fn()}
      download={vi.fn()}
      revealInFolder={vi.fn()}
      refresh={vi.fn()}
      moveSelection={vi.fn()}
      {...props}
    />
  );

describe('unsupported office selections', () => {
  beforeEach(() => {
    mocks.getState.mockReset();
    mocks.getState.mockResolvedValue({ ok: true, version: 'v1', undoDepth: 0 });
    mocks.inspect.mockReset();
    mocks.apply.mockReset();
    mocks.undo.mockReset();
    mocks.openFile.mockReset();
    mocks.copyText.mockReset();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each(['UNSUPPORTED_CONTENT', 'AMBIGUOUS_TEXT'] as const)(
    'returns the editor to an idle, non-editing state when %s is reported instead of surfacing a failing edit',
    async (code) => {
      mocks.inspect.mockResolvedValue({ ok: false, code });

      const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));
      await waitFor(() => expect(result.current.version).toBe('v1'));

      act(() => result.current.handleSelectionChange(shapeSelection));

      await waitFor(() => expect(result.current.status).not.toBe('inspecting'));

      // The hook must not surface a distinct "unsupported" status: it settles back
      // into the same idle state as having no selection at all, and drops the
      // (unusable) inspection rather than holding onto a dead-end edit target.
      expect(result.current.status).toBe('ready');
      expect(result.current.inspection).toBeNull();

      renderToolbar({ status: result.current.status, inspection: result.current.inspection });

      expect(screen.queryByText(/needs the desktop app/i)).not.toBeInTheDocument();
      expect(screen.queryByText('preview.office.editor.unsupported')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      // No edit affordance is offered for content that cannot actually be edited.
      expect(screen.queryByRole('button', { name: 'Edit selection' })).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Edit selection' })).not.toBeInTheDocument();
    }
  );

  it('still reaches the editable ready state for a supported selection', async () => {
    mocks.inspect.mockResolvedValue(supportedInspection);

    const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));
    await waitFor(() => expect(result.current.version).toBe('v1'));

    act(() => result.current.handleSelectionChange(bodyTextSelection));

    await waitFor(() => expect(result.current.inspection).not.toBeNull());
    expect(result.current.status).toBe('ready');

    renderToolbar({ status: result.current.status, inspection: result.current.inspection });

    expect(screen.getByText('Ready to edit the selected content')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit selection' })).toBeEnabled();
  });
});
