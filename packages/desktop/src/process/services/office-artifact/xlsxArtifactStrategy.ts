/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OFFICE_ARTIFACT_MAX_SELECTED_CELLS,
  type ExcelSelectionSnapshot,
  type OfficeArtifactEdit,
  type OfficeArtifactExcelInspection,
  type OfficeArtifactInspection,
} from '@/common/types/office/artifactEditor';

import { OfficeArtifactError } from './officeCliJson';
import type { OfficeCliRunner } from './officeCliRunner';

const CELL_PATH = /^\/([^/]+)\/([A-Z]{1,3})([1-9]\d*)$/;

type ParsedCellPath = {
  path: string;
  sheet: string;
  column: number;
  row: number;
  reference: string;
};

type SelectionGeometry = {
  sheet: string;
  rangePath: string;
  displayRange: string;
  paths: ParsedCellPath[];
  displayTextByPath: Map<string, string>;
};

type CanonicalCell = {
  path: string;
  displayText: string;
  input: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnsupported(): never {
  throw new OfficeArtifactError('UNSUPPORTED_CONTENT');
}

function columnNumber(value: string): number {
  let result = 0;
  for (const character of value) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
}

function columnName(value: number): string {
  let remaining = value;
  let result = '';
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(65 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function parseCellPath(path: string): ParsedCellPath {
  if (path.includes(':')) return rejectUnsupported();
  const match = CELL_PATH.exec(path);
  if (!match) return rejectUnsupported();

  const row = Number(match[3]);
  if (!Number.isSafeInteger(row)) return rejectUnsupported();

  return {
    path,
    sheet: match[1],
    column: columnNumber(match[2]),
    row,
    reference: `${match[2]}${match[3]}`,
  };
}

function parseSelection(selection: ExcelSelectionSnapshot): SelectionGeometry {
  if (
    !Array.isArray(selection.paths) ||
    selection.paths.length === 0 ||
    selection.paths.length > OFFICE_ARTIFACT_MAX_SELECTED_CELLS ||
    !Array.isArray(selection.cells) ||
    selection.cells.length !== selection.paths.length
  ) {
    return rejectUnsupported();
  }

  const paths = selection.paths.map((path) => (typeof path === 'string' ? parseCellPath(path) : rejectUnsupported()));
  const uniquePaths = new Set(paths.map(({ path }) => path));
  if (uniquePaths.size !== paths.length) return rejectUnsupported();

  const sheet = paths[0].sheet;
  if (!paths.every((path) => path.sheet === sheet)) return rejectUnsupported();

  const displayTextByPath = new Map<string, string>();
  for (const selectedCell of selection.cells) {
    if (
      !isRecord(selectedCell) ||
      typeof selectedCell.path !== 'string' ||
      typeof selectedCell.displayText !== 'string' ||
      !uniquePaths.has(selectedCell.path) ||
      displayTextByPath.has(selectedCell.path)
    ) {
      return rejectUnsupported();
    }
    displayTextByPath.set(selectedCell.path, selectedCell.displayText);
  }
  if (displayTextByPath.size !== paths.length) return rejectUnsupported();

  const columns = paths.map(({ column }) => column);
  const rows = paths.map(({ row }) => row);
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const area = (maxColumn - minColumn + 1) * (maxRow - minRow + 1);
  if (area !== paths.length) return rejectUnsupported();

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      if (!uniquePaths.has(`/${sheet}/${columnName(column)}${row}`)) return rejectUnsupported();
    }
  }

  const start = `${columnName(minColumn)}${minRow}`;
  const end = `${columnName(maxColumn)}${maxRow}`;
  const reference = start === end ? start : `${start}:${end}`;

  return {
    sheet,
    rangePath: `/${sheet}/${reference}`,
    displayRange: `${sheet}!${reference}`,
    paths: paths.toSorted((left, right) => left.row - right.row || left.column - right.column),
    displayTextByPath,
  };
}

function hasUnsupportedMetadata(node: Record<string, unknown>, format: Record<string, unknown>): boolean {
  return (
    node.protected === true ||
    node.unsupported === true ||
    format.protected === true ||
    format.unsupported === true ||
    format.richtext === true ||
    format.mergeAnchor === false ||
    (format.merge !== undefined && format.mergeAnchor !== true) ||
    format.protect === true ||
    format['protection.locked'] === true ||
    format['protection.hidden'] === true
  );
}

function assertSheetEditable(result: unknown, sheet: string): void {
  if (!isRecord(result) || result.matches !== 1 || !Array.isArray(result.results) || result.results.length !== 1) {
    return rejectUnsupported();
  }

  const node = result.results[0];
  if (
    !isRecord(node) ||
    node.type !== 'sheet' ||
    node.path !== `/${sheet}` ||
    !isRecord(node.format) ||
    hasUnsupportedMetadata(node, node.format)
  ) {
    return rejectUnsupported();
  }
}

function parseCanonicalCell(value: unknown): CanonicalCell {
  if (
    !isRecord(value) ||
    value.type !== 'cell' ||
    typeof value.path !== 'string' ||
    typeof value.text !== 'string' ||
    !isRecord(value.format) ||
    !Array.isArray(value.children) ||
    value.children.length > 0
  ) {
    return rejectUnsupported();
  }

  parseCellPath(value.path);
  if (hasUnsupportedMetadata(value, value.format)) return rejectUnsupported();

  const formula = value.format.formula;
  if (formula !== undefined && typeof formula !== 'string') return rejectUnsupported();

  return {
    path: value.path,
    displayText: value.text,
    input: formula === undefined ? value.text : `=${formula}`,
  };
}

function parseCanonicalCells(result: unknown, geometry: SelectionGeometry): CanonicalCell[] {
  if (
    !isRecord(result) ||
    result.protected === true ||
    result.unsupported === true ||
    result.matches !== 1 ||
    !Array.isArray(result.results) ||
    result.results.length !== 1
  ) {
    return rejectUnsupported();
  }

  const root = result.results[0];
  let values: unknown[];
  if (geometry.paths.length === 1) {
    values = [root];
  } else {
    if (
      !isRecord(root) ||
      root.type !== 'range' ||
      root.path !== geometry.rangePath ||
      !isRecord(root.format) ||
      !Array.isArray(root.children) ||
      hasUnsupportedMetadata(root, root.format)
    ) {
      return rejectUnsupported();
    }
    values = root.children;
  }

  if (values.length !== geometry.paths.length) return rejectUnsupported();
  const cells = values.map(parseCanonicalCell);
  const cellsByPath = new Map(cells.map((cell) => [cell.path, cell]));
  if (cellsByPath.size !== cells.length) return rejectUnsupported();

  return geometry.paths.map(({ path }) => cellsByPath.get(path) ?? rejectUnsupported());
}

function validateEditableInspection(inspection: OfficeArtifactInspection): OfficeArtifactExcelInspection {
  if (
    inspection.kind !== 'excel' ||
    inspection.canEdit !== true ||
    inspection.cells.length !== 1 ||
    typeof inspection.range !== 'string'
  ) {
    return rejectUnsupported();
  }

  const cell = inspection.cells[0];
  if (typeof cell.path !== 'string' || typeof cell.displayText !== 'string' || typeof cell.input !== 'string') {
    return rejectUnsupported();
  }
  const parsed = parseCellPath(cell.path);
  if (inspection.range !== `${parsed.sheet}!${parsed.reference}`) return rejectUnsupported();
  return inspection;
}

/** Inspect a canonical guest XLSX selection without exposing unsafe direct editing. */
export async function inspectXlsxSelection(
  runner: OfficeCliRunner,
  filePath: string,
  selection: ExcelSelectionSnapshot
): Promise<OfficeArtifactExcelInspection> {
  const geometry = parseSelection(selection);
  assertSheetEditable(await runner.get(filePath, `/${geometry.sheet}`), geometry.sheet);
  const cells = parseCanonicalCells(await runner.get(filePath, geometry.rangePath), geometry);

  for (const cell of cells) {
    if (geometry.displayTextByPath.get(cell.path) !== cell.displayText) {
      throw new OfficeArtifactError('STALE_SELECTION');
    }
  }

  return {
    kind: 'excel',
    range: geometry.displayRange,
    cells,
    canEdit: cells.length === 1,
  };
}

/** Apply one cell value or formula after revalidating its canonical contents. */
export async function mutateXlsxSelection(
  runner: OfficeCliRunner,
  filePath: string,
  inspection: OfficeArtifactInspection,
  edit: OfficeArtifactEdit
): Promise<void> {
  const excelInspection = validateEditableInspection(inspection);
  if (edit.kind !== 'setCell' || typeof edit.input !== 'string') return rejectUnsupported();

  const inspectedCell = excelInspection.cells[0];
  const freshInspection = await inspectXlsxSelection(runner, filePath, {
    kind: 'excel',
    paths: [inspectedCell.path],
    cells: [{ path: inspectedCell.path, displayText: inspectedCell.displayText }],
  });
  const freshCell = freshInspection.cells[0];
  if (
    freshInspection.range !== excelInspection.range ||
    freshCell.path !== inspectedCell.path ||
    freshCell.displayText !== inspectedCell.displayText ||
    freshCell.input !== inspectedCell.input
  ) {
    throw new OfficeArtifactError('STALE_SELECTION');
  }

  await runner.setCell(filePath, inspectedCell.path, edit.input);
}
