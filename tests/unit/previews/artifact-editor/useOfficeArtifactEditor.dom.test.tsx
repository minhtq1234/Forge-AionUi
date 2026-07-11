import type {
  OfficeArtifactInspectResult,
  OfficeArtifactMutationResult,
  OfficeArtifactSelection,
  OfficeArtifactStateResult,
} from '@/common/types/office/artifactEditor';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getState: vi.fn<(request: unknown) => Promise<OfficeArtifactStateResult>>(),
  inspect: vi.fn<(request: unknown) => Promise<OfficeArtifactInspectResult>>(),
  apply: vi.fn<(request: unknown) => Promise<OfficeArtifactMutationResult>>(),
  undo: vi.fn<(request: unknown) => Promise<OfficeArtifactMutationResult>>(),
  openFile: vi.fn<(filePath: string) => Promise<void>>(),
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (key === 'preview.office.editor.requestPlaceholder') return 'Describe the requested change.';
      if (key === 'preview.office.editor.askWordContext') {
        return `File: ${values?.fileName}\nSelection: ${values?.text}\nRequest: ${values?.placeholder}`;
      }
      return key;
    },
  }),
}));

import { useOfficeArtifactEditor } from '@/renderer/pages/conversation/Preview/components/ArtifactEditor/useOfficeArtifactEditor';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const firstSelection: OfficeArtifactSelection = {
  kind: 'word',
  path: '/body/p[1]',
  paragraphText: 'Quarterly revenue',
  selectedText: 'Quarterly',
  start: 0,
  end: 9,
};

const secondSelection: OfficeArtifactSelection = {
  ...firstSelection,
  selectedText: 'revenue',
  start: 10,
  end: 17,
};

const firstInspection: OfficeArtifactInspectResult = {
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

const secondInspection: OfficeArtifactInspectResult = {
  ...firstInspection,
  inspection: { ...firstInspection.inspection, selectedText: 'revenue', start: 10, end: 17 },
};

const createOptions = () => ({
  conversationId: 'conversation-1',
  workspace: '/workspace',
  filePath: '/workspace/report.docx',
  fileName: 'report.docx',
  externalRevision: 0,
  addToSendBox: vi.fn<(text: string) => void>(),
  onArtifactMutated: vi.fn<() => void>(),
});

describe('useOfficeArtifactEditor', () => {
  beforeEach(() => {
    mocks.getState.mockReset();
    mocks.getState.mockResolvedValue({ ok: true, version: 'v1', undoDepth: 0 });
    mocks.inspect.mockReset();
    mocks.apply.mockReset();
    mocks.undo.mockReset();
    mocks.openFile.mockReset();
    mocks.openFile.mockResolvedValue(undefined);
  });

  it('does not invoke Office IPC while the editor is disabled', async () => {
    const options = { ...createOptions(), enabled: false };

    const { result } = renderHook(() => useOfficeArtifactEditor(options));
    await act(async () => Promise.resolve());

    expect(result.current.status).toBe('ready');
    expect(mocks.getState).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });

  it('uses the conversation identity when loading artifact state', async () => {
    renderHook(() => useOfficeArtifactEditor(createOptions()));

    await waitFor(() =>
      expect(mocks.getState).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        workspace: '/workspace',
        filePath: '/workspace/report.docx',
      })
    );
  });

  it('inspects a selection that arrives before artifact state finishes loading', async () => {
    const pendingState = deferred<OfficeArtifactStateResult>();
    mocks.getState.mockReturnValue(pendingState.promise);
    mocks.inspect.mockResolvedValue(firstInspection);
    const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));

    act(() => result.current.handleSelectionChange(firstSelection));
    expect(mocks.inspect).not.toHaveBeenCalled();

    pendingState.resolve({ ok: true, version: 'v1', undoDepth: 0 });

    await waitFor(() => expect(result.current.inspection).toEqual(firstInspection.inspection));
    expect(mocks.inspect).toHaveBeenCalledWith(expect.objectContaining({ selection: firstSelection }));
  });

  it('reports saving and then saved only after apply succeeds', async () => {
    const pending = deferred<OfficeArtifactMutationResult>();
    mocks.inspect.mockResolvedValue(firstInspection);
    mocks.apply.mockReturnValue(pending.promise);
    const options = createOptions();
    const { result } = renderHook(() => useOfficeArtifactEditor(options));
    await waitFor(() => expect(result.current.version).toBe('v1'));
    act(() => result.current.handleSelectionChange(firstSelection));
    await waitFor(() => expect(result.current.inspection).not.toBeNull());

    act(() => void result.current.apply({ kind: 'replaceText', value: 'New text' }));
    expect(result.current.status).toBe('saving');

    pending.resolve({ ok: true, version: 'v2', snapshotId: 's1', undoDepth: 1 });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation-1' }));
    expect(result.current.version).toBe('v2');
    expect(options.onArtifactMutated).toHaveBeenCalledOnce();
  });

  it('retains the active selection while a guest selection event arrives during a pending apply', async () => {
    const pending = deferred<OfficeArtifactMutationResult>();
    mocks.inspect.mockResolvedValue(firstInspection);
    mocks.apply.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));
    await waitFor(() => expect(result.current.version).toBe('v1'));
    act(() => result.current.handleSelectionChange(firstSelection));
    await waitFor(() => expect(result.current.inspection).not.toBeNull());

    let applyPromise: Promise<boolean>;
    act(() => {
      applyPromise = result.current.apply({ kind: 'replaceText', value: 'New text' });
      result.current.handleSelectionChange(secondSelection);
    });

    expect(result.current.status).toBe('saving');
    expect(result.current.inspection?.kind === 'word' && result.current.inspection.selectedText).toBe('Quarterly');
    expect(mocks.inspect).toHaveBeenCalledOnce();

    pending.resolve({ ok: true, version: 'v2', snapshotId: 's1', undoDepth: 1 });
    await act(async () => expect(await applyPromise).toBe(true));
    expect(result.current.status).toBe('saved');
  });

  it('discards an inspection response that arrives after a newer selection', async () => {
    const oldResponse = deferred<OfficeArtifactInspectResult>();
    const newResponse = deferred<OfficeArtifactInspectResult>();
    mocks.inspect.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));
    await waitFor(() => expect(result.current.version).toBe('v1'));

    act(() => {
      result.current.handleSelectionChange(firstSelection);
      result.current.handleSelectionChange(secondSelection);
    });
    newResponse.resolve(secondInspection);
    await waitFor(() => expect(result.current.inspection?.kind).toBe('word'));
    expect(result.current.inspection?.kind === 'word' && result.current.inspection.selectedText).toBe('revenue');

    oldResponse.resolve(firstInspection);
    await act(async () => Promise.resolve());
    expect(result.current.inspection?.kind === 'word' && result.current.inspection.selectedText).toBe('revenue');
  });

  it('does not apply an old editor action while a newer selection is still being inspected', async () => {
    const pendingInspection = deferred<OfficeArtifactInspectResult>();
    mocks.inspect.mockResolvedValueOnce(firstInspection).mockReturnValueOnce(pendingInspection.promise);
    const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));
    await waitFor(() => expect(result.current.version).toBe('v1'));
    act(() => result.current.handleSelectionChange(firstSelection));
    await waitFor(() => expect(result.current.inspection).not.toBeNull());

    act(() => result.current.handleSelectionChange(secondSelection));
    const applied = await result.current.apply({ kind: 'replaceText', value: 'Wrong target' });

    expect(applied).toBe(false);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('clears a stale selection before adopting an externally refreshed version', async () => {
    mocks.inspect.mockResolvedValue(firstInspection);
    const options = createOptions();
    const view = renderHook((props: typeof options) => useOfficeArtifactEditor(props), { initialProps: options });
    await waitFor(() => expect(view.result.current.version).toBe('v1'));
    act(() => view.result.current.handleSelectionChange(firstSelection));
    await waitFor(() => expect(view.result.current.inspection).not.toBeNull());
    mocks.getState.mockResolvedValueOnce({ ok: true, version: 'external-v2', undoDepth: 0 });

    view.rerender({ ...options, externalRevision: 1 });

    expect(view.result.current.inspection).toBeNull();
    await waitFor(() => expect(view.result.current.version).toBe('external-v2'));
  });

  it('defers an external revision reload until an in-flight apply commits', async () => {
    const pending = deferred<OfficeArtifactMutationResult>();
    mocks.getState
      .mockResolvedValueOnce({ ok: true, version: 'v1', undoDepth: 0 })
      .mockResolvedValueOnce({ ok: true, version: 'v2', undoDepth: 1 });
    mocks.inspect.mockResolvedValue(firstInspection);
    mocks.apply.mockReturnValue(pending.promise);
    const options = createOptions();
    const view = renderHook((props: typeof options) => useOfficeArtifactEditor(props), { initialProps: options });
    await waitFor(() => expect(view.result.current.version).toBe('v1'));
    act(() => view.result.current.handleSelectionChange(firstSelection));
    await waitFor(() => expect(view.result.current.inspection).not.toBeNull());

    let applyPromise: Promise<boolean>;
    act(() => {
      applyPromise = view.result.current.apply({ kind: 'replaceText', value: 'New text' });
    });
    view.rerender({ ...options, externalRevision: 1 });

    expect(view.result.current.status).toBe('saving');
    expect(mocks.getState).toHaveBeenCalledOnce();

    pending.resolve({ ok: true, version: 'v2', snapshotId: 's1', undoDepth: 1 });
    await act(async () => expect(await applyPromise).toBe(true));
    await waitFor(() => expect(mocks.getState).toHaveBeenCalledTimes(2));
    expect(view.result.current.version).toBe('v2');
    expect(view.result.current.undoDepth).toBe(1);
  });

  it('marks a conflict without refreshing the preview or version', async () => {
    mocks.inspect.mockResolvedValue(firstInspection);
    mocks.apply.mockResolvedValue({ ok: false, code: 'FILE_CHANGED' });
    const options = createOptions();
    const { result } = renderHook(() => useOfficeArtifactEditor(options));
    await waitFor(() => expect(result.current.version).toBe('v1'));
    act(() => result.current.handleSelectionChange(firstSelection));
    await waitFor(() => expect(result.current.inspection).not.toBeNull());

    await act(() => result.current.apply({ kind: 'replaceText', value: 'New text' }));

    expect(result.current.status).toBe('fileChanged');
    expect(result.current.version).toBe('v1');
    expect(result.current.inspection).toEqual(firstInspection.inspection);
    act(() => result.current.handleSelectionChange(secondSelection));
    expect(result.current.inspection).toEqual(firstInspection.inspection);
    expect(mocks.inspect).toHaveBeenCalledOnce();
    await expect(result.current.apply({ kind: 'replaceText', value: 'Retry' })).resolves.toBe(false);
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(options.onArtifactMutated).not.toHaveBeenCalled();
  });

  it.each(['UNSUPPORTED_CONTENT', 'AMBIGUOUS_TEXT'] as const)(
    'reports %s mutation failures as unsupported editor state',
    async (code) => {
      mocks.inspect.mockResolvedValue(firstInspection);
      mocks.apply.mockResolvedValue({ ok: false, code });
      const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));
      await waitFor(() => expect(result.current.version).toBe('v1'));
      act(() => result.current.handleSelectionChange(firstSelection));
      await waitFor(() => expect(result.current.inspection).not.toBeNull());

      await act(() => result.current.apply({ kind: 'replaceText', value: 'New text' }));

      expect(result.current.status).toBe('unsupported');
    }
  );

  it.each(['UNSUPPORTED_CONTENT', 'AMBIGUOUS_TEXT'] as const)(
    'prevents a second apply after %s rejects the active selection',
    async (code) => {
      mocks.inspect.mockResolvedValue(firstInspection);
      mocks.apply.mockResolvedValue({ ok: false, code });
      const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));
      await waitFor(() => expect(result.current.version).toBe('v1'));
      act(() => result.current.handleSelectionChange(firstSelection));
      await waitFor(() => expect(result.current.inspection).not.toBeNull());

      await act(() => result.current.apply({ kind: 'replaceText', value: 'New text' }));
      const secondApplyResult = await act(() => result.current.apply({ kind: 'replaceText', value: 'Retry' }));

      expect(result.current.status).toBe('unsupported');
      expect(result.current.inspection).toBeNull();
      expect(secondApplyResult).toBe(false);
      expect(mocks.apply).toHaveBeenCalledOnce();
    }
  );

  it('undoes the current version transactionally and refreshes only after success', async () => {
    const pending = deferred<OfficeArtifactMutationResult>();
    mocks.getState.mockResolvedValue({ ok: true, version: 'v2', undoDepth: 1 });
    mocks.undo.mockReturnValue(pending.promise);
    const options = createOptions();
    const { result } = renderHook(() => useOfficeArtifactEditor(options));
    await waitFor(() => expect(result.current.version).toBe('v2'));

    act(() => void result.current.undo());
    expect(result.current.status).toBe('saving');
    expect(options.onArtifactMutated).not.toHaveBeenCalled();

    pending.resolve({ ok: true, version: 'v1', snapshotId: 's1', undoDepth: 0 });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(mocks.undo).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation-1' }));
    expect(result.current.version).toBe('v1');
    expect(result.current.undoDepth).toBe(0);
    expect(options.onArtifactMutated).toHaveBeenCalledOnce();
  });

  it('reports the desktop app as opened only after the shell bridge succeeds', async () => {
    const pending = deferred<void>();
    mocks.openFile.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));
    await waitFor(() => expect(result.current.version).toBe('v1'));

    act(() => void result.current.openInDesktopApp());
    expect(result.current.status).toBe('openingDesktop');

    pending.resolve();
    await waitFor(() => expect(result.current.status).toBe('openedDesktop'));
  });

  it('creates monotonically keyed allowlisted guest navigation requests', async () => {
    const { result } = renderHook(() => useOfficeArtifactEditor(createOptions()));
    await waitFor(() => expect(result.current.version).toBe('v1'));

    act(() => result.current.moveSelection('left'));
    const firstRequest = result.current.scriptRequest;
    act(() => result.current.moveSelection('down'));

    expect(result.current.scriptRequest?.id).toBe((firstRequest?.id ?? 0) + 1);
    expect(result.current.scriptRequest?.script).toContain("__forgeOfficeMoveSelection('down')");
  });

  it('adds selection context to the composer without invoking a send operation', async () => {
    mocks.inspect.mockResolvedValue(firstInspection);
    const options = createOptions();
    const { result } = renderHook(() => useOfficeArtifactEditor(options));
    await waitFor(() => expect(result.current.version).toBe('v1'));
    act(() => result.current.handleSelectionChange(firstSelection));
    await waitFor(() => expect(result.current.inspection).not.toBeNull());

    act(() => result.current.askForge());

    expect(options.addToSendBox).toHaveBeenCalledWith(expect.stringContaining('report.docx'));
    expect(options.addToSendBox).toHaveBeenCalledTimes(1);
  });
});
