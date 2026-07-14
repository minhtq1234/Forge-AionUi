/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OFFICE_ARTIFACT_MAX_SELECTED_CELLS,
  OFFICE_ARTIFACT_MAX_SELECTION_MESSAGE_BYTES,
  type DocxSelectionSnapshot,
  type ExcelSelectionSnapshot,
} from '@/common/types/office/artifactEditor';

const MESSAGE_PREFIX = '__FORGE_OFFICE_SELECTION__';
const WORD_PATH = /^\/body\/p(?:\[@paraId=[A-Fa-f0-9]+\]|\[[1-9]\d*\])$/;
const CELL_PATH = /^\/([^/]+)\/([A-Z]{1,3})([1-9]\d*)$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const WORD_PAYLOAD_KEYS = ['kind', 'path', 'paragraphText', 'selectedText', 'start', 'end'] as const;
const EXCEL_PAYLOAD_KEYS = ['kind', 'paths', 'cells'] as const;
const EXCEL_EDIT_PAYLOAD_KEYS = [...EXCEL_PAYLOAD_KEYS, 'editRequested'] as const;
const EXCEL_CELL_KEYS = ['path', 'displayText'] as const;

export type OfficeGuestDocType = 'word' | 'excel';
export type OfficeGuestSelectionMessage = DocxSelectionSnapshot | (ExcelSelectionSnapshot & { editRequested?: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isStableCellPath(path: string): boolean {
  const match = CELL_PATH.exec(path);
  return match !== null && Number.isSafeInteger(Number(match[3]));
}

function isLoopbackOfficeSource(sourceId: string): boolean {
  try {
    const source = new URL(sourceId);
    return (
      (source.protocol === 'http:' || source.protocol === 'https:') &&
      source.username === '' &&
      source.password === '' &&
      LOOPBACK_HOSTS.has(source.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function parseWordPayload(value: Record<string, unknown>): DocxSelectionSnapshot | null {
  if (
    !hasExactKeys(value, WORD_PAYLOAD_KEYS) ||
    value.kind !== 'word' ||
    typeof value.path !== 'string' ||
    !WORD_PATH.test(value.path) ||
    typeof value.paragraphText !== 'string' ||
    typeof value.selectedText !== 'string' ||
    value.selectedText.length === 0 ||
    typeof value.start !== 'number' ||
    !Number.isInteger(value.start) ||
    typeof value.end !== 'number' ||
    !Number.isInteger(value.end) ||
    value.start < 0 ||
    value.start >= value.end ||
    value.end > value.paragraphText.length ||
    value.paragraphText.slice(value.start, value.end) !== value.selectedText
  ) {
    return null;
  }

  return {
    kind: 'word',
    path: value.path,
    paragraphText: value.paragraphText,
    selectedText: value.selectedText,
    start: value.start,
    end: value.end,
  };
}

function parseExcelPayload(value: Record<string, unknown>): OfficeGuestSelectionMessage | null {
  const hasEditRequest = Object.prototype.hasOwnProperty.call(value, 'editRequested');
  if (
    !hasExactKeys(value, hasEditRequest ? EXCEL_EDIT_PAYLOAD_KEYS : EXCEL_PAYLOAD_KEYS) ||
    value.kind !== 'excel' ||
    (hasEditRequest && value.editRequested !== true) ||
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    value.paths.length > OFFICE_ARTIFACT_MAX_SELECTED_CELLS ||
    !Array.isArray(value.cells) ||
    value.cells.length !== value.paths.length
  ) {
    return null;
  }

  const paths: string[] = [];
  const cells: Array<{ path: string; displayText: string }> = [];
  const uniquePaths = new Set<string>();

  for (let index = 0; index < value.paths.length; index += 1) {
    const path = value.paths[index];
    const cell = value.cells[index];
    if (
      typeof path !== 'string' ||
      !isStableCellPath(path) ||
      uniquePaths.has(path) ||
      !isRecord(cell) ||
      !hasExactKeys(cell, EXCEL_CELL_KEYS) ||
      cell.path !== path ||
      typeof cell.displayText !== 'string'
    ) {
      return null;
    }

    uniquePaths.add(path);
    paths.push(path);
    cells.push({ path, displayText: cell.displayText });
  }

  const selection: ExcelSelectionSnapshot & { editRequested?: true } = {
    kind: 'excel',
    paths,
    cells,
  };
  if (hasEditRequest) selection.editRequested = true;
  return selection;
}

/** Parse one source-validated Office preview console message into a strict selection snapshot. */
export function parseOfficeGuestMessage(message: string, sourceId: string): OfficeGuestSelectionMessage | null {
  if (
    typeof message !== 'string' ||
    typeof sourceId !== 'string' ||
    !isLoopbackOfficeSource(sourceId) ||
    !message.startsWith(MESSAGE_PREFIX) ||
    message.length > OFFICE_ARTIFACT_MAX_SELECTION_MESSAGE_BYTES ||
    new TextEncoder().encode(message).byteLength > OFFICE_ARTIFACT_MAX_SELECTION_MESSAGE_BYTES
  ) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(message.slice(MESSAGE_PREFIX.length)) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(payload)) return null;
  if (payload.kind === 'word') return parseWordPayload(payload);
  if (payload.kind === 'excel') return parseExcelPayload(payload);
  return null;
}

const WORD_GUEST_SCRIPT = String.raw`
(function () {
  if (window.__forgeOfficeWordGuestBridgeInstalled) return;
  window.__forgeOfficeWordGuestBridgeInstalled = true;

  const messagePrefix = '__FORGE_OFFICE_SELECTION__';
  const stableParagraphPath = /^\/body\/p(?:\[@paraId=[A-Fa-f0-9]+\]|\[[1-9]\d*\])$/;
  let lastSerializedSnapshot = '';

  function emitSnapshot(snapshot) {
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSerializedSnapshot) return;
    lastSerializedSnapshot = serialized;
    console.log(messagePrefix + serialized);
  }

  function elementForNode(node) {
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function stableParagraphForNode(node) {
    let element = elementForNode(node);
    while (element) {
      const path = element.getAttribute('data-path');
      if (path && stableParagraphPath.test(path)) return element;
      element = element.parentElement;
    }
    return null;
  }

  function readWordSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;

    const range = selection.getRangeAt(0);
    const startParagraph = stableParagraphForNode(range.startContainer);
    const endParagraph = stableParagraphForNode(range.endContainer);
    if (!startParagraph || startParagraph !== endParagraph) return null;
    if (!startParagraph.contains(range.startContainer) || !startParagraph.contains(range.endContainer)) return null;

    const path = startParagraph.getAttribute('data-path');
    if (!path || !stableParagraphPath.test(path)) return null;

    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(startParagraph);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(startParagraph);
    beforeEnd.setEnd(range.endContainer, range.endOffset);

    const paragraphText = startParagraph.textContent || '';
    const selectedText = range.toString();
    const start = beforeStart.toString().length;
    const end = beforeEnd.toString().length;
    if (!selectedText || start < 0 || start >= end || paragraphText.slice(start, end) !== selectedText) return null;

    return { kind: 'word', path, paragraphText, selectedText, start, end };
  }

  function publishWordSelection() {
    try {
      const snapshot = readWordSelection();
      if (snapshot) emitSnapshot(snapshot);
    } catch {
      return;
    }
  }

  document.addEventListener('selectionchange', publishWordSelection);
})();
`;

const EXCEL_GUEST_SCRIPT = String.raw`
(function () {
  if (window.__forgeOfficeExcelGuestBridgeInstalled) return;
  window.__forgeOfficeExcelGuestBridgeInstalled = true;

  const messagePrefix = '__FORGE_OFFICE_SELECTION__';
  const selectedCellSelector = 'td.officecli-sel-range, td.officecli-selected';
  const stableCellPath = /^\/([^/]+)\/([A-Z]{1,3})([1-9]\d*)$/;
  const maxSelectedCells = 256;
  let lastSerializedSnapshot = '';
  let publishQueued = false;

  function parseCellPath(path) {
    const match = stableCellPath.exec(path);
    if (!match) return null;
    const row = Number(match[3]);
    if (!Number.isSafeInteger(row)) return null;
    return { sheet: match[1], column: match[2], row };
  }

  function readExcelSelection(editRequested) {
    const selectedCells = Array.from(document.querySelectorAll(selectedCellSelector));
    if (selectedCells.length === 0 || selectedCells.length > maxSelectedCells) return null;

    const paths = [];
    const cells = [];
    const uniquePaths = new Set();
    for (const cell of selectedCells) {
      const path = cell.getAttribute('data-path');
      if (!path || !parseCellPath(path) || uniquePaths.has(path)) return null;
      uniquePaths.add(path);
      const textElement = cell.querySelector('.cell-text') || cell;
      paths.push(path);
      cells.push({ path, displayText: textElement.textContent || '' });
    }

    const snapshot = { kind: 'excel', paths, cells };
    if (editRequested) snapshot.editRequested = true;
    return snapshot;
  }

  function emitExcelSelection(editRequested) {
    const snapshot = readExcelSelection(editRequested);
    if (!snapshot) return;
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSerializedSnapshot) return;
    lastSerializedSnapshot = serialized;
    console.log(messagePrefix + serialized);
  }

  function scheduleExcelSelection() {
    if (publishQueued) return;
    publishQueued = true;
    queueMicrotask(function () {
      publishQueued = false;
      emitExcelSelection(false);
    });
  }

  function columnNumber(column) {
    let value = 0;
    for (const character of column) value = value * 26 + character.charCodeAt(0) - 64;
    return value;
  }

  function columnName(value) {
    let remaining = value;
    let result = '';
    while (remaining > 0) {
      remaining -= 1;
      result = String.fromCharCode(65 + (remaining % 26)) + result;
      remaining = Math.floor(remaining / 26);
    }
    return result;
  }

  function findCellByPath(path) {
    return Array.from(document.querySelectorAll('td[data-path]')).find(function (cell) {
      return cell.getAttribute('data-path') === path;
    });
  }

  window.__forgeOfficeMoveSelection = function (direction) {
    const deltas = {
      up: [0, -1],
      down: [0, 1],
      left: [-1, 0],
      right: [1, 0],
    };
    if (!Object.prototype.hasOwnProperty.call(deltas, direction)) return false;

    const activeCell = document.querySelector(selectedCellSelector);
    if (!activeCell) return false;
    const activePath = activeCell.getAttribute('data-path');
    const parsed = activePath ? parseCellPath(activePath) : null;
    if (!parsed) return false;

    const delta = deltas[direction];
    const nextColumn = columnNumber(parsed.column) + delta[0];
    const nextRow = parsed.row + delta[1];
    if (nextColumn < 1 || nextRow < 1) return false;

    const targetPath = '/' + parsed.sheet + '/' + columnName(nextColumn) + String(nextRow);
    const targetCell = findCellByPath(targetPath);
    if (!targetCell) return false;

    targetCell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    emitExcelSelection(false);
    return true;
  };

  document.addEventListener('click', scheduleExcelSelection, true);
  window.addEventListener(
    'dblclick',
    function (event) {
      if (!(event.target instanceof Element)) return;
      const cell = event.target.closest(selectedCellSelector);
      if (!cell) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      emitExcelSelection(true);
    },
    true
  );

  const observer = new MutationObserver(scheduleExcelSelection);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
  });
  scheduleExcelSelection();
})();
`;

/** Build the self-contained OfficeCLI guest script for one editable preview type. */
export function buildOfficeGuestScript(docType: OfficeGuestDocType): string {
  return docType === 'word' ? WORD_GUEST_SCRIPT : EXCEL_GUEST_SCRIPT;
}
