/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DocxSelectionSnapshot,
  ExcelSelectionSnapshot,
  OfficeArtifactApplyRequest,
} from '@/common/types/office/artifactEditor';
import {
  OfficeArtifactService,
  type OfficeArtifactServiceDependencies,
  type OfficeArtifactSnapshotStoreApi,
} from '@/process/services/office-artifact/OfficeArtifactService';
import { OfficeArtifactError } from '@/process/services/office-artifact/officeCliJson';
import type { ResolvedOfficeArtifact } from '@/process/services/office-artifact/officeArtifactPath';
import type { OfficeArtifactPendingSnapshot } from '@/process/services/office-artifact/officeArtifactSnapshots';
import type { OfficeCliRunner } from '@/process/services/office-artifact/officeCliRunner';

const WORKSPACE = '/workspace';
const XLSX_FILE = '/workspace/forecast.xlsx';
const DOCX_FILE = '/workspace/report.docx';
const STAGED_XLSX_FILE = '/workspace/.forecast.forge-edit.xlsx';
const STAGED_DOCX_FILE = '/workspace/.report.forge-edit.docx';
const PREVIEW_XLSX_FILE = '/preview/preview.xlsx';
const PREVIEW_WORKSPACE = '/preview';
const VERSION_A = 'a'.repeat(64);
const VERSION_B = 'b'.repeat(64);
const VERSION_C = 'c'.repeat(64);

const excelSelection: ExcelSelectionSnapshot = {
  kind: 'excel',
  paths: ['/Forecast/B4'],
  cells: [{ path: '/Forecast/B4', displayText: '84' }],
};

const wordSelection: DocxSelectionSnapshot = {
  kind: 'word',
  path: '/body/p[@paraId=00100000]',
  paragraphText: 'Quarterly revenue grew',
  selectedText: 'revenue',
  start: 10,
  end: 17,
};

const applyRequest: OfficeArtifactApplyRequest = {
  workspace: WORKSPACE,
  filePath: XLSX_FILE,
  expectedVersion: VERSION_A,
  selection: excelSelection,
  edit: { kind: 'setCell', input: '=A1*3' },
};

const pending: OfficeArtifactPendingSnapshot = {
  id: 'snapshot-1',
  filePath: XLSX_FILE,
  snapshotPath: '/history/snapshot-1.bin',
  preVersion: VERSION_A,
};

function cellEnvelope(formula = 'A1*2'): unknown {
  return {
    matches: 1,
    results: [
      {
        path: '/Forecast/B4',
        type: 'cell',
        text: '84',
        preview: 'B4',
        childCount: 0,
        format: { formula },
        children: [],
      },
    ],
  };
}

function sheetEnvelope(format: Record<string, unknown> = {}): unknown {
  return {
    matches: 1,
    results: [{ path: '/Forecast', type: 'sheet', format, children: [] }],
  };
}

function paragraphEnvelope(): unknown {
  return {
    matches: 1,
    results: [
      {
        path: wordSelection.path,
        type: 'paragraph',
        text: wordSelection.paragraphText,
        format: {},
        children: [
          { type: 'run', text: 'Quarterly ', format: {}, children: [] },
          { type: 'run', text: 'revenue', format: {}, children: [] },
          { type: 'run', text: ' grew', format: {}, children: [] },
        ],
      },
    ],
  };
}

const runner = {
  get: vi.fn<OfficeCliRunner['get']>(),
  replaceText: vi.fn<OfficeCliRunner['replaceText']>(),
  formatRange: vi.fn<OfficeCliRunner['formatRange']>(),
  setCell: vi.fn<OfficeCliRunner['setCell']>(),
  validate: vi.fn<OfficeCliRunner['validate']>(),
  close: vi.fn<OfficeCliRunner['close']>(),
  watch: vi.fn<OfficeCliRunner['watch']>(),
} satisfies OfficeCliRunner;

const stopPreview = vi.fn<() => Promise<void>>();
const releasePreviewOrigin = vi.fn<() => void>();
const retainPreviewOrigin = vi.fn<(url: string) => { url: string; release: () => void }>();

const snapshots = {
  prepare: vi.fn<OfficeArtifactSnapshotStoreApi['prepare']>(),
  commit: vi.fn<OfficeArtifactSnapshotStoreApi['commit']>(),
  rollbackPending: vi.fn<OfficeArtifactSnapshotStoreApi['rollbackPending']>(),
  discardPending: vi.fn<OfficeArtifactSnapshotStoreApi['discardPending']>(),
  undo: vi.fn<OfficeArtifactSnapshotStoreApi['undo']>(),
  getUndoDepth: vi.fn<OfficeArtifactSnapshotStoreApi['getUndoDepth']>(),
  dispose: vi.fn<() => Promise<void>>(),
};

const workingFiles = {
  create: vi.fn<(filePath: string) => Promise<string>>(),
  createPreview: vi.fn<(filePath: string) => Promise<{ filePath: string; workspace: string }>>(),
  install: vi.fn<(stagedPath: string, filePath: string) => Promise<void>>(),
  remove: vi.fn<(stagedPath: string) => Promise<void>>(),
  dispose: vi.fn<() => Promise<void>>(),
};

const resolveArtifact = vi.fn<OfficeArtifactServiceDependencies['resolveArtifact']>();
const hashArtifact = vi.fn<OfficeArtifactServiceDependencies['hashArtifact']>();

function artifact(kind: ResolvedOfficeArtifact['kind'], filePath: string): ResolvedOfficeArtifact {
  return { workspace: WORKSPACE, filePath, kind };
}

function createService(): OfficeArtifactService {
  const dependencies = { runner, snapshots, resolveArtifact, hashArtifact, workingFiles, retainPreviewOrigin };
  return new OfficeArtifactService(dependencies);
}

beforeEach(() => {
  vi.resetAllMocks();
  resolveArtifact.mockResolvedValue(artifact('excel', XLSX_FILE));
  hashArtifact.mockResolvedValue(VERSION_A);
  runner.get.mockImplementation(async (_file, path) => (path === '/Forecast' ? sheetEnvelope() : cellEnvelope()));
  runner.setCell.mockResolvedValue({});
  runner.replaceText.mockResolvedValue({ matched: 1 });
  runner.validate.mockResolvedValue({});
  runner.close.mockResolvedValue({});
  runner.watch.mockResolvedValue({ url: 'http://127.0.0.1:26318/', stop: stopPreview });
  stopPreview.mockResolvedValue();
  releasePreviewOrigin.mockReset();
  retainPreviewOrigin.mockImplementation((url) => ({ url, release: releasePreviewOrigin }));
  snapshots.prepare.mockResolvedValue(pending);
  snapshots.commit.mockResolvedValue(1);
  snapshots.rollbackPending.mockResolvedValue();
  snapshots.discardPending.mockResolvedValue();
  snapshots.undo.mockResolvedValue({ version: VERSION_A, undoDepth: 0 });
  snapshots.getUndoDepth.mockReturnValue(0);
  snapshots.dispose.mockResolvedValue();
  workingFiles.create.mockImplementation(async (filePath) =>
    filePath === DOCX_FILE ? STAGED_DOCX_FILE : STAGED_XLSX_FILE
  );
  workingFiles.createPreview.mockResolvedValue({ filePath: PREVIEW_XLSX_FILE, workspace: PREVIEW_WORKSPACE });
  workingFiles.install.mockResolvedValue();
  workingFiles.remove.mockResolvedValue();
  workingFiles.dispose.mockResolvedValue();
});

describe('OfficeArtifactService preview leases', () => {
  it('creates a version-matched preview copy outside the workspace artifact path', async () => {
    hashArtifact.mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A);

    const result = await createService().preparePreview({ workspace: WORKSPACE, filePath: XLSX_FILE });

    expect(result).toMatchObject({
      ok: true,
      filePath: PREVIEW_XLSX_FILE,
      workspace: PREVIEW_WORKSPACE,
    });
    expect(workingFiles.createPreview).toHaveBeenCalledWith(XLSX_FILE);
  });

  it('releases only a preview lease created by the service', async () => {
    hashArtifact.mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A);
    const service = createService();
    const prepared = await service.preparePreview({ workspace: WORKSPACE, filePath: XLSX_FILE });
    if (prepared.ok === false) throw new Error('preview preparation failed');

    await expect(service.releasePreview({ leaseId: prepared.leaseId })).resolves.toEqual({ ok: true });
    expect(workingFiles.remove).toHaveBeenCalledWith(PREVIEW_XLSX_FILE);
    await expect(service.releasePreview({ leaseId: prepared.leaseId })).resolves.toEqual({
      ok: false,
      code: 'PREVIEW_FAILED',
    });
  });

  it('starts and stops a private preview session through its opaque lease', async () => {
    hashArtifact.mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A);
    const service = createService();
    const prepared = await service.preparePreview({ workspace: WORKSPACE, filePath: XLSX_FILE });
    if (prepared.ok === false) throw new Error('preview preparation failed');

    await expect(service.startPreview({ leaseId: prepared.leaseId })).resolves.toEqual({
      ok: true,
      url: 'http://127.0.0.1:26318/',
    });
    expect(runner.watch).toHaveBeenCalledWith(PREVIEW_XLSX_FILE);
    expect(retainPreviewOrigin).toHaveBeenCalledWith('http://127.0.0.1:26318/');

    await expect(service.releasePreview({ leaseId: prepared.leaseId })).resolves.toEqual({ ok: true });
    expect(stopPreview.mock.invocationCallOrder[0]).toBeLessThan(workingFiles.remove.mock.invocationCallOrder[0]);
    expect(releasePreviewOrigin).toHaveBeenCalledOnce();
  });

  it('retains a backend Word preview origin against the same private-copy lease', async () => {
    hashArtifact.mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A);
    const service = createService();
    const prepared = await service.preparePreview({ workspace: WORKSPACE, filePath: XLSX_FILE });
    if (prepared.ok === false) throw new Error('preview preparation failed');

    await expect(
      service.startPreview({ leaseId: prepared.leaseId, url: '/api/office-watch-proxy/18791' })
    ).resolves.toEqual({ ok: true, url: '/api/office-watch-proxy/18791' });
    expect(runner.watch).not.toHaveBeenCalled();
    expect(retainPreviewOrigin).toHaveBeenCalledWith('/api/office-watch-proxy/18791');
  });

  it('retains a private preview copy when its watch process cannot be stopped', async () => {
    hashArtifact.mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A);
    stopPreview.mockRejectedValueOnce(new Error('still running'));
    const service = createService();
    const prepared = await service.preparePreview({ workspace: WORKSPACE, filePath: XLSX_FILE });
    if (prepared.ok === false) throw new Error('preview preparation failed');
    await service.startPreview({ leaseId: prepared.leaseId });

    await expect(service.releasePreview({ leaseId: prepared.leaseId })).resolves.toEqual({
      ok: false,
      code: 'OFFICECLI_FAILED',
    });
    expect(workingFiles.remove).not.toHaveBeenCalled();
  });

  it('waits for in-flight preview preparation during disposal and removes a late copy', async () => {
    let finishPreviewCopy: (() => void) | undefined;
    workingFiles.createPreview.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPreviewCopy = () => resolve({ filePath: PREVIEW_XLSX_FILE, workspace: PREVIEW_WORKSPACE });
        })
    );
    hashArtifact.mockResolvedValue(VERSION_A);
    const service = createService();

    const preparation = service.preparePreview({ workspace: WORKSPACE, filePath: XLSX_FILE });
    await vi.waitFor(() => expect(workingFiles.createPreview).toHaveBeenCalledOnce());
    const disposal = service.dispose();
    await Promise.resolve();

    expect(workingFiles.dispose).not.toHaveBeenCalled();
    finishPreviewCopy?.();

    await expect(preparation).resolves.toEqual({ ok: false, code: 'PREVIEW_FAILED' });
    await disposal;
    expect(workingFiles.remove).toHaveBeenCalledWith(PREVIEW_XLSX_FILE);
    expect(workingFiles.dispose).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight preview start during disposal and stops the late child', async () => {
    hashArtifact.mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A);
    let finishWatchStart: (() => void) | undefined;
    runner.watch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishWatchStart = () => resolve({ url: 'http://127.0.0.1:26318/', stop: stopPreview });
        })
    );
    const service = createService();
    const prepared = await service.preparePreview({ workspace: WORKSPACE, filePath: XLSX_FILE });
    if (prepared.ok === false) throw new Error('preview preparation failed');

    const starting = service.startPreview({ leaseId: prepared.leaseId });
    await vi.waitFor(() => expect(runner.watch).toHaveBeenCalledOnce());
    const disposal = service.dispose();
    let disposalFinished = false;
    void disposal.then(() => {
      disposalFinished = true;
    });
    await Promise.resolve();

    expect(workingFiles.dispose).not.toHaveBeenCalled();
    expect(disposalFinished).toBe(false);
    finishWatchStart?.();

    await expect(starting).resolves.toEqual({ ok: false, code: 'PREVIEW_FAILED' });
    await disposal;
    expect(stopPreview).toHaveBeenCalledOnce();
    expect(workingFiles.dispose).toHaveBeenCalledOnce();
  });
});

describe('OfficeArtifactService state and inspection', () => {
  it('returns the current version and session undo depth', async () => {
    snapshots.getUndoDepth.mockReturnValue(2);

    await expect(createService().getState({ workspace: WORKSPACE, filePath: XLSX_FILE })).resolves.toEqual({
      ok: true,
      version: VERSION_A,
      undoDepth: 2,
    });
    expect(snapshots.getUndoDepth).toHaveBeenCalledWith(XLSX_FILE, VERSION_A);
  });

  it('rejects an inspection when the file version changed', async () => {
    const result = await createService().inspect({
      workspace: WORKSPACE,
      filePath: XLSX_FILE,
      expectedVersion: VERSION_B,
      selection: excelSelection,
    });

    expect(result).toEqual({ ok: false, code: 'FILE_CHANGED' });
    expect(runner.get).not.toHaveBeenCalled();
  });

  it('dispatches XLSX inspection by the resolved file kind', async () => {
    await expect(
      createService().inspect({
        workspace: WORKSPACE,
        filePath: XLSX_FILE,
        expectedVersion: VERSION_A,
        selection: excelSelection,
      })
    ).resolves.toMatchObject({ ok: true, version: VERSION_A, inspection: { kind: 'excel', canEdit: true } });
  });

  it('dispatches DOCX inspection by the resolved file kind', async () => {
    resolveArtifact.mockResolvedValue(artifact('word', DOCX_FILE));
    runner.get.mockResolvedValue(paragraphEnvelope());

    await expect(
      createService().inspect({
        workspace: WORKSPACE,
        filePath: DOCX_FILE,
        expectedVersion: VERSION_A,
        selection: wordSelection,
      })
    ).resolves.toMatchObject({ ok: true, version: VERSION_A, inspection: { kind: 'word', canReplace: true } });
  });

  it('maps unknown dependency errors to OFFICECLI_FAILED', async () => {
    resolveArtifact.mockRejectedValue(new Error('unexpected'));

    await expect(createService().getState({ workspace: WORKSPACE, filePath: XLSX_FILE })).resolves.toEqual({
      ok: false,
      code: 'OFFICECLI_FAILED',
    });
  });
});

describe('OfficeArtifactService apply', () => {
  it('validates and commits an XLSX mutation transaction', async () => {
    hashArtifact
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B);

    await expect(createService().apply(applyRequest)).resolves.toEqual({
      ok: true,
      version: VERSION_B,
      snapshotId: pending.id,
      undoDepth: 1,
    });
    expect(runner.get).toHaveBeenCalledTimes(4);
    expect(workingFiles.create).toHaveBeenCalledWith(XLSX_FILE);
    expect(runner.setCell).toHaveBeenCalledWith(STAGED_XLSX_FILE, '/Forecast/B4', '=A1*3');
    expect(runner.validate).toHaveBeenCalledWith(STAGED_XLSX_FILE);
    expect(workingFiles.install).toHaveBeenCalledWith(STAGED_XLSX_FILE, XLSX_FILE, VERSION_A, VERSION_B);
    expect(snapshots.commit).toHaveBeenCalledWith(pending, VERSION_B);
  });

  it('closes the staged resident before atomic installation', async () => {
    hashArtifact
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B);

    await expect(createService().apply(applyRequest)).resolves.toMatchObject({ ok: true });

    const stagedCloseIndex = runner.close.mock.calls.findIndex(([filePath]) => filePath === STAGED_XLSX_FILE);
    expect(stagedCloseIndex).toBeGreaterThanOrEqual(0);
    expect(runner.close.mock.invocationCallOrder[stagedCloseIndex]).toBeLessThan(
      workingFiles.install.mock.invocationCallOrder[0]
    );
  });

  it('dispatches a DOCX mutation transaction', async () => {
    resolveArtifact.mockResolvedValue(artifact('word', DOCX_FILE));
    runner.get.mockResolvedValue(paragraphEnvelope());
    hashArtifact
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B);
    snapshots.prepare.mockResolvedValue({ ...pending, filePath: DOCX_FILE });
    const request: OfficeArtifactApplyRequest = {
      workspace: WORKSPACE,
      filePath: DOCX_FILE,
      expectedVersion: VERSION_A,
      selection: wordSelection,
      edit: { kind: 'replaceText', value: 'sales' },
    };

    await expect(createService().apply(request)).resolves.toMatchObject({ ok: true, version: VERSION_B });
    expect(runner.replaceText).toHaveBeenCalledWith(STAGED_DOCX_FILE, wordSelection.path, 'revenue', 'sales');
  });

  it('rejects a stale version before preparing a snapshot', async () => {
    const result = await createService().apply({ ...applyRequest, expectedVersion: VERSION_B });

    expect(result).toEqual({ ok: false, code: 'FILE_CHANGED' });
    expect(snapshots.prepare).not.toHaveBeenCalled();
  });

  it('discards the pending snapshot when staged mutation fails', async () => {
    runner.setCell.mockRejectedValue(new OfficeArtifactError('OFFICECLI_FAILED'));

    const result = await createService().apply(applyRequest);

    expect(result).toEqual({ ok: false, code: 'OFFICECLI_FAILED' });
    expect(snapshots.discardPending).toHaveBeenCalledWith(pending);
    expect(snapshots.rollbackPending).not.toHaveBeenCalled();
    expect(snapshots.commit).not.toHaveBeenCalled();
  });

  it('does not restore a snapshot over an external save when mutation fails', async () => {
    runner.setCell.mockRejectedValue(new OfficeArtifactError('OFFICECLI_FAILED'));

    const result = await createService().apply(applyRequest);

    expect(result).toEqual({ ok: false, code: 'OFFICECLI_FAILED' });
    expect(snapshots.discardPending).toHaveBeenCalledWith(pending);
    expect(snapshots.rollbackPending).not.toHaveBeenCalled();
  });

  it('preserves an external edit detected after snapshot preparation', async () => {
    runner.get
      .mockResolvedValueOnce(sheetEnvelope())
      .mockResolvedValueOnce(cellEnvelope())
      .mockResolvedValueOnce(sheetEnvelope())
      .mockResolvedValueOnce(cellEnvelope('A1*4'));

    const result = await createService().apply(applyRequest);

    expect(result).toEqual({ ok: false, code: 'STALE_SELECTION' });
    expect(snapshots.discardPending).toHaveBeenCalledWith(pending);
    expect(snapshots.rollbackPending).not.toHaveBeenCalled();
    expect(runner.setCell).not.toHaveBeenCalled();
  });

  it('discards the pending snapshot when staged validation fails', async () => {
    runner.validate.mockRejectedValue(new OfficeArtifactError('OFFICECLI_FAILED'));

    await expect(createService().apply(applyRequest)).resolves.toEqual({
      ok: false,
      code: 'OFFICECLI_FAILED',
    });
    expect(snapshots.discardPending).toHaveBeenCalledWith(pending);
    expect(snapshots.rollbackPending).not.toHaveBeenCalled();
  });

  it('rejects and discards a staged mutation that does not change the binary hash', async () => {
    hashArtifact.mockResolvedValueOnce(VERSION_A).mockResolvedValueOnce(VERSION_A);

    await expect(createService().apply(applyRequest)).resolves.toEqual({
      ok: false,
      code: 'OFFICECLI_FAILED',
    });
    expect(snapshots.discardPending).toHaveBeenCalledWith(pending);
    expect(snapshots.rollbackPending).not.toHaveBeenCalled();
    expect(snapshots.commit).not.toHaveBeenCalled();
  });

  it('rolls back an installed artifact when snapshot commit fails', async () => {
    hashArtifact
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_B);
    snapshots.commit.mockRejectedValue(new OfficeArtifactError('SNAPSHOT_FAILED'));
    snapshots.rollbackPending.mockRejectedValue(new OfficeArtifactError('RESTORE_FAILED'));

    await expect(createService().apply(applyRequest)).resolves.toEqual({
      ok: false,
      code: 'RESTORE_FAILED',
    });
    expect(workingFiles.install).toHaveBeenCalledWith(STAGED_XLSX_FILE, XLSX_FILE, VERSION_A, VERSION_B);
    expect(snapshots.rollbackPending).toHaveBeenCalledWith(pending, VERSION_B);
  });

  it('preserves an external save detected before staged installation', async () => {
    hashArtifact
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_C);

    await expect(createService().apply(applyRequest)).resolves.toEqual({ ok: false, code: 'FILE_CHANGED' });

    expect(workingFiles.install).not.toHaveBeenCalled();
    expect(snapshots.discardPending).toHaveBeenCalledWith(pending);
    expect(snapshots.rollbackPending).not.toHaveBeenCalled();
  });

  it('does not commit a snapshot when conditional installation loses a race', async () => {
    hashArtifact
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_A);
    workingFiles.install.mockRejectedValue(new OfficeArtifactError('FILE_CHANGED'));

    await expect(createService().apply(applyRequest)).resolves.toEqual({ ok: false, code: 'FILE_CHANGED' });

    expect(snapshots.commit).not.toHaveBeenCalled();
    expect(snapshots.discardPending).toHaveBeenCalledWith(pending);
    expect(snapshots.rollbackPending).not.toHaveBeenCalled();
  });

  it('preserves an external save detected after staged installation', async () => {
    hashArtifact
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_C)
      .mockResolvedValueOnce(VERSION_C);

    await expect(createService().apply(applyRequest)).resolves.toEqual({ ok: false, code: 'FILE_CHANGED' });

    expect(workingFiles.install).toHaveBeenCalledWith(STAGED_XLSX_FILE, XLSX_FILE, VERSION_A, VERSION_B);
    expect(snapshots.commit).not.toHaveBeenCalled();
    expect(snapshots.discardPending).toHaveBeenCalledWith(pending);
    expect(snapshots.rollbackPending).not.toHaveBeenCalled();
  });

  it('serializes concurrent mutations of the same artifact', async () => {
    let releaseFirstMutation: (() => void) | undefined;
    runner.setCell
      .mockImplementationOnce(
        () =>
          new Promise<unknown>((resolve) => {
            releaseFirstMutation = () => resolve({});
          })
      )
      .mockResolvedValueOnce({});
    hashArtifact
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_C)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_C);
    snapshots.prepare
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, id: 'snapshot-2', preVersion: VERSION_B });
    const service = createService();

    const first = service.apply(applyRequest);
    await vi.waitFor(() => expect(runner.setCell).toHaveBeenCalledTimes(1));
    const second = service.apply({ ...applyRequest, expectedVersion: VERSION_B });
    await Promise.resolve();

    expect(snapshots.prepare).toHaveBeenCalledTimes(1);
    releaseFirstMutation?.();
    await expect(first).resolves.toMatchObject({ ok: true, version: VERSION_B });
    await expect(second).resolves.toMatchObject({ ok: true, version: VERSION_C });
    expect(snapshots.prepare).toHaveBeenCalledTimes(2);
  });

  it('waits for an in-flight mutation before disposing snapshots', async () => {
    let releaseMutation: (() => void) | undefined;
    runner.setCell.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          releaseMutation = () => resolve({});
        })
    );
    hashArtifact
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B)
      .mockResolvedValueOnce(VERSION_A)
      .mockResolvedValueOnce(VERSION_B);
    const service = createService();

    const mutation = service.apply(applyRequest);
    await vi.waitFor(() => expect(runner.setCell).toHaveBeenCalledTimes(1));
    const disposal = (service as unknown as { dispose: () => Promise<void> }).dispose();
    await Promise.resolve();

    expect(snapshots.dispose).not.toHaveBeenCalled();
    releaseMutation?.();
    await expect(mutation).resolves.toMatchObject({ ok: true, version: VERSION_B });
    await disposal;
    expect(snapshots.dispose).toHaveBeenCalledOnce();
  });
});

describe('OfficeArtifactService undo', () => {
  it('rejects undo after an external file change', async () => {
    const result = await createService().undo({
      workspace: WORKSPACE,
      filePath: XLSX_FILE,
      expectedVersion: VERSION_B,
    });

    expect(result).toEqual({ ok: false, code: 'FILE_CHANGED' });
    expect(snapshots.undo).not.toHaveBeenCalled();
  });

  it('delegates repeated undo with the current version each time', async () => {
    hashArtifact.mockResolvedValueOnce(VERSION_C).mockResolvedValueOnce(VERSION_B);
    snapshots.undo
      .mockResolvedValueOnce({ version: VERSION_B, undoDepth: 1 })
      .mockResolvedValueOnce({ version: VERSION_A, undoDepth: 0 });
    const service = createService();

    await expect(
      service.undo({ workspace: WORKSPACE, filePath: XLSX_FILE, expectedVersion: VERSION_C })
    ).resolves.toMatchObject({ ok: true, version: VERSION_B, undoDepth: 1 });
    await expect(
      service.undo({ workspace: WORKSPACE, filePath: XLSX_FILE, expectedVersion: VERSION_B })
    ).resolves.toMatchObject({ ok: true, version: VERSION_A, undoDepth: 0 });
  });
});
