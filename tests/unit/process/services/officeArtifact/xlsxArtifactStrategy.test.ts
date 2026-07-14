/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ExcelSelectionSnapshot,
  OfficeArtifactEdit,
  OfficeArtifactExcelInspection,
} from '@/common/types/office/artifactEditor';
import type { OfficeCliRunner } from '@/process/services/office-artifact/officeCliRunner';
import { inspectXlsxSelection, mutateXlsxSelection } from '@/process/services/office-artifact/xlsxArtifactStrategy';

const FILE_PATH = '/workspace/forecast.xlsx';

type CellFormat = Record<string, unknown>;

function cell(path: string, text: string, format: CellFormat = {}): Record<string, unknown> {
  return {
    path,
    type: 'cell',
    text,
    preview: path.slice(path.lastIndexOf('/') + 1),
    childCount: 0,
    format,
    children: [],
  };
}

function cellEnvelope(value: Record<string, unknown>): unknown {
  return { matches: 1, results: [value] };
}

function sheetEnvelope(format: CellFormat = {}): unknown {
  return {
    matches: 1,
    results: [{ path: '/Forecast', type: 'sheet', format, children: [] }],
  };
}

function rangeEnvelope(paths: string[]): unknown {
  const children = paths.map((path, index) => cell(path, String(index + 1)));
  return {
    matches: 1,
    results: [
      {
        path: `/Forecast/${paths[0].split('/').at(-1)}:${paths.at(-1)?.split('/').at(-1)}`,
        type: 'range',
        preview: 'range',
        childCount: children.length,
        format: {},
        children,
      },
    ],
  };
}

function selection(
  paths: string[],
  displayTexts = paths.map((_path, index) => String(index + 1))
): ExcelSelectionSnapshot {
  return {
    kind: 'excel',
    paths,
    cells: paths.map((path, index) => ({ path, displayText: displayTexts[index] })),
  };
}

const oneCellSelection: ExcelSelectionSnapshot = selection(['/Forecast/B4'], ['84']);
const twoCellSelection: ExcelSelectionSnapshot = selection(['/Forecast/B4', '/Forecast/C4']);

const runner = {
  get: vi.fn<OfficeCliRunner['get']>(),
  replaceText: vi.fn<OfficeCliRunner['replaceText']>(),
  formatRange: vi.fn<OfficeCliRunner['formatRange']>(),
  setCell: vi.fn<OfficeCliRunner['setCell']>(),
  validate: vi.fn<OfficeCliRunner['validate']>(),
  close: vi.fn<OfficeCliRunner['close']>(),
} satisfies OfficeCliRunner;

function mockInspectionResult(result: unknown, sheetFormat: CellFormat = {}): void {
  runner.get.mockImplementation(async (_file, path) => (path === '/Forecast' ? sheetEnvelope(sheetFormat) : result));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockInspectionResult(cellEnvelope(cell('/Forecast/B4', '84', { formula: 'A1*2' })));
  runner.setCell.mockResolvedValue({});
});

describe('inspectXlsxSelection', () => {
  it('inspects one canonical cell and exposes a formula with leading equals', async () => {
    await expect(inspectXlsxSelection(runner, FILE_PATH, oneCellSelection)).resolves.toEqual({
      kind: 'excel',
      range: 'Forecast!B4',
      cells: [{ path: '/Forecast/B4', displayText: '84', input: '=A1*2' }],
      canEdit: true,
    });
    expect(runner.get).toHaveBeenCalledWith(FILE_PATH, '/Forecast/B4');
  });

  it('inspects a contiguous range but keeps direct editing disabled', async () => {
    mockInspectionResult(rangeEnvelope(['/Forecast/B4', '/Forecast/C4']));

    await expect(inspectXlsxSelection(runner, FILE_PATH, twoCellSelection)).resolves.toMatchObject({
      kind: 'excel',
      range: 'Forecast!B4:C4',
      canEdit: false,
    });
    expect(runner.get).toHaveBeenCalledWith(FILE_PATH, '/Forecast/B4:C4');
  });

  it.each([
    ['an embedded range', selection(['/Forecast/B4:C5'])],
    ['mixed sheets', selection(['/Forecast/B4', '/Actual/C4'])],
    ['a non-rectangular set', selection(['/Forecast/B4', '/Forecast/C5'])],
    ['duplicate cells', selection(['/Forecast/B4', '/Forecast/B4'])],
  ])('rejects %s before invoking OfficeCLI', async (_name, invalidSelection) => {
    await expect(inspectXlsxSelection(runner, FILE_PATH, invalidSelection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
    expect(runner.get).not.toHaveBeenCalled();
  });

  it('rejects more than 256 cells', async () => {
    const paths = Array.from({ length: 257 }, (_value, index) => `/Forecast/A${index + 1}`);

    await expect(inspectXlsxSelection(runner, FILE_PATH, selection(paths))).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
    expect(runner.get).not.toHaveBeenCalled();
  });

  it.each([
    ['rich text', { richtext: true }],
    ['a merged non-anchor', { mergeAnchor: false }],
    ['a merged non-anchor without an explicit flag', { merge: 'B4:C4' }],
    ['a protected cell', { 'protection.locked': true }],
    ['an unsupported cell', { unsupported: true }],
  ])('preserves %s', async (_name, format) => {
    mockInspectionResult(cellEnvelope(cell('/Forecast/B4', '84', format)));

    await expect(inspectXlsxSelection(runner, FILE_PATH, oneCellSelection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
  });

  it('rejects cells on a protected worksheet', async () => {
    mockInspectionResult(cellEnvelope(cell('/Forecast/B4', '84')), { protect: true });

    await expect(inspectXlsxSelection(runner, FILE_PATH, oneCellSelection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
    expect(runner.get).toHaveBeenCalledTimes(1);
    expect(runner.get).toHaveBeenCalledWith(FILE_PATH, '/Forecast');
  });

  it('rejects an unsupported OfficeCLI response', async () => {
    mockInspectionResult({ unsupported: true, matches: 1, results: [cell('/Forecast/B4', '84')] });

    await expect(inspectXlsxSelection(runner, FILE_PATH, oneCellSelection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
  });

  it('rejects a stale display value from the guest selection', async () => {
    mockInspectionResult(cellEnvelope(cell('/Forecast/B4', '85')));

    await expect(inspectXlsxSelection(runner, FILE_PATH, oneCellSelection)).rejects.toMatchObject({
      code: 'STALE_SELECTION',
    });
  });

  it('rejects OfficeCLI results that do not exactly match the selected paths', async () => {
    mockInspectionResult(rangeEnvelope(['/Forecast/B4', '/Forecast/D4']));

    await expect(inspectXlsxSelection(runner, FILE_PATH, twoCellSelection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
  });
});

describe('mutateXlsxSelection', () => {
  const inspection: OfficeArtifactExcelInspection = {
    kind: 'excel',
    range: 'Forecast!B4',
    cells: [{ path: '/Forecast/B4', displayText: '84', input: '=A1*2' }],
    canEdit: true,
  };

  it('re-inspects the cell before applying the allowlisted mutation', async () => {
    await mutateXlsxSelection(runner, FILE_PATH, inspection, { kind: 'setCell', input: '=A1*3' });

    expect(runner.get).toHaveBeenCalledWith(FILE_PATH, '/Forecast/B4');
    expect(runner.setCell).toHaveBeenCalledWith(FILE_PATH, '/Forecast/B4', '=A1*3');
  });

  it('rejects a formula that changed while preserving the same display text', async () => {
    mockInspectionResult(cellEnvelope(cell('/Forecast/B4', '84', { formula: 'A1*4' })));

    await expect(
      mutateXlsxSelection(runner, FILE_PATH, inspection, { kind: 'setCell', input: '=A1*3' })
    ).rejects.toMatchObject({ code: 'STALE_SELECTION' });
    expect(runner.setCell).not.toHaveBeenCalled();
  });

  it('rejects direct edits for a multi-cell inspection', async () => {
    const rangeInspection: OfficeArtifactExcelInspection = {
      kind: 'excel',
      range: 'Forecast!B4:C4',
      cells: [
        { path: '/Forecast/B4', displayText: '1', input: '1' },
        { path: '/Forecast/C4', displayText: '2', input: '2' },
      ],
      canEdit: false,
    };

    await expect(
      mutateXlsxSelection(runner, FILE_PATH, rangeInspection, { kind: 'setCell', input: '3' })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
    expect(runner.get).not.toHaveBeenCalled();
  });

  it('rejects a non-cell edit', async () => {
    const edit = { kind: 'replaceText', value: 'nope' } satisfies OfficeArtifactEdit;

    await expect(mutateXlsxSelection(runner, FILE_PATH, inspection, edit)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
    expect(runner.setCell).not.toHaveBeenCalled();
  });
});
