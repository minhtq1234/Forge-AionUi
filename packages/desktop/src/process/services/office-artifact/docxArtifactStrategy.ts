/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DocxSelectionSnapshot,
  OfficeArtifactEdit,
  OfficeArtifactInspection,
  OfficeArtifactWordInspection,
} from '@/common/types/office/artifactEditor';

import { OfficeArtifactError } from './officeCliJson';
import type { OfficeCliRunner } from './officeCliRunner';

const STABLE_PARAGRAPH_PATH = /^\/body\/p\[@paraId=[A-Fa-f0-9]+\]$/;
const PREVIEW_PARAGRAPH_PATH = /^\/body\/p\[[1-9]\d*\]$/;
const OFFICECLI_REGEX_LITERAL = /^r(?:"[\s\S]*"|'[\s\S]*')$/;
const FORMAT_PROPERTIES = ['bold', 'italic', 'underline'] as const;

type OfficeCliFormat = Record<string, unknown>;

type OfficeCliRun = {
  text: string;
  format: OfficeCliFormat;
};

type OfficeCliParagraph = {
  path: string;
  text: string;
  children: OfficeCliRun[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnsupported(): never {
  throw new OfficeArtifactError('UNSUPPORTED_CONTENT');
}

function validateSelection(selection: DocxSelectionSnapshot): void {
  if (!STABLE_PARAGRAPH_PATH.test(selection.path) && !PREVIEW_PARAGRAPH_PATH.test(selection.path)) rejectUnsupported();
  if (OFFICECLI_REGEX_LITERAL.test(selection.selectedText)) rejectUnsupported();

  const hasValidOffsets =
    Number.isInteger(selection.start) &&
    Number.isInteger(selection.end) &&
    selection.start >= 0 &&
    selection.start < selection.end &&
    selection.end <= selection.paragraphText.length;
  if (
    selection.selectedText.length === 0 ||
    !hasValidOffsets ||
    selection.selectedText !== selection.paragraphText.slice(selection.start, selection.end)
  ) {
    throw new OfficeArtifactError('STALE_SELECTION');
  }

  let occurrenceCount = 0;
  let searchFrom = 0;
  while (searchFrom <= selection.paragraphText.length - selection.selectedText.length) {
    const match = selection.paragraphText.indexOf(selection.selectedText, searchFrom);
    if (match === -1) break;
    occurrenceCount += 1;
    if (occurrenceCount > 1) throw new OfficeArtifactError('AMBIGUOUS_TEXT');
    searchFrom = match + 1;
  }

  if (occurrenceCount !== 1) throw new OfficeArtifactError('STALE_SELECTION');
}

function parseRun(value: unknown): OfficeCliRun {
  if (
    !isRecord(value) ||
    value.type !== 'run' ||
    typeof value.text !== 'string' ||
    !isRecord(value.format) ||
    !Array.isArray(value.children) ||
    value.children.length > 0
  ) {
    return rejectUnsupported();
  }

  return { text: value.text, format: value.format };
}

function parseParagraph(result: unknown, expectedText: string): OfficeCliParagraph {
  if (!isRecord(result) || !Array.isArray(result.results) || result.results.length !== 1) {
    return rejectUnsupported();
  }

  const paragraph = result.results[0];
  if (
    !isRecord(paragraph) ||
    paragraph.type !== 'paragraph' ||
    typeof paragraph.path !== 'string' ||
    !STABLE_PARAGRAPH_PATH.test(paragraph.path) ||
    typeof paragraph.text !== 'string' ||
    !Array.isArray(paragraph.children)
  ) {
    return rejectUnsupported();
  }
  if (paragraph.text !== expectedText) throw new OfficeArtifactError('STALE_SELECTION');

  return {
    path: paragraph.path,
    text: paragraph.text,
    children: paragraph.children.map(parseRun),
  };
}

function stableFormat(format: OfficeCliFormat): string {
  return JSON.stringify(
    Object.entries(format)
      .filter(([key]) => !key.endsWith('.src'))
      .toSorted(([left], [right]) => left.localeCompare(right))
  );
}

function formatValue(format: OfficeCliFormat, property: (typeof FORMAT_PROPERTIES)[number]): unknown {
  if (Object.prototype.hasOwnProperty.call(format, property)) return format[property];
  return format[`effective.${property}`];
}

function formatBoolean(format: OfficeCliFormat, property: 'bold' | 'italic'): boolean {
  return formatValue(format, property) === true;
}

function underlineBoolean(format: OfficeCliFormat): boolean {
  const value = formatValue(format, 'underline');
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    return normalized !== '' && normalized !== 'none' && normalized !== 'false';
  }
  return value === true;
}

function findTouchedRuns(paragraph: OfficeCliParagraph, selection: DocxSelectionSnapshot): OfficeCliRun[] {
  const touchedRuns: OfficeCliRun[] = [];
  let cursor = 0;

  for (const run of paragraph.children) {
    const runStart = cursor;
    cursor += run.text.length;
    if (runStart < selection.end && cursor > selection.start) touchedRuns.push(run);
  }

  if (cursor !== paragraph.text.length || touchedRuns.length === 0) return rejectUnsupported();
  return touchedRuns;
}

function isFormatProperty(value: unknown): value is (typeof FORMAT_PROPERTIES)[number] {
  return typeof value === 'string' && FORMAT_PROPERTIES.some((property) => property === value);
}

function validateWordInspection(inspection: OfficeArtifactInspection): OfficeArtifactWordInspection {
  if (
    inspection.kind !== 'word' ||
    !STABLE_PARAGRAPH_PATH.test(inspection.path) ||
    inspection.selectedText.length === 0 ||
    !Number.isInteger(inspection.start) ||
    !Number.isInteger(inspection.end) ||
    inspection.start < 0 ||
    inspection.start >= inspection.end
  ) {
    return rejectUnsupported();
  }
  return inspection;
}

/** Inspect a renderer selection and return only capabilities safe for direct DOCX mutation. */
export async function inspectDocxSelection(
  runner: OfficeCliRunner,
  filePath: string,
  selection: DocxSelectionSnapshot
): Promise<OfficeArtifactWordInspection> {
  validateSelection(selection);
  const paragraph = parseParagraph(await runner.get(filePath, selection.path), selection.paragraphText);
  const touchedRuns = findTouchedRuns(paragraph, selection);
  const referenceFormat = stableFormat(touchedRuns[0].format);
  if (!touchedRuns.every((run) => stableFormat(run.format) === referenceFormat)) rejectUnsupported();

  const format = touchedRuns[0].format;
  return {
    kind: 'word',
    path: paragraph.path,
    selectedText: selection.selectedText,
    start: selection.start,
    end: selection.end,
    canReplace: true,
    canFormat: true,
    formatting: {
      bold: formatBoolean(format, 'bold'),
      italic: formatBoolean(format, 'italic'),
      underline: underlineBoolean(format),
    },
  };
}

/** Apply one allowlisted mutation to a previously inspected DOCX selection. */
export async function mutateDocxSelection(
  runner: OfficeCliRunner,
  filePath: string,
  inspection: OfficeArtifactInspection,
  edit: OfficeArtifactEdit
): Promise<void> {
  const wordInspection = validateWordInspection(inspection);

  if (edit.kind === 'replaceText') {
    if (!wordInspection.canReplace || typeof edit.value !== 'string') rejectUnsupported();
    const result = await runner.replaceText(filePath, wordInspection.path, wordInspection.selectedText, edit.value);
    if (!isRecord(result) || result.matched !== 1) throw new OfficeArtifactError('OFFICECLI_FAILED');
    return;
  }

  if (edit.kind === 'formatText') {
    if (!wordInspection.canFormat || !isFormatProperty(edit.property) || typeof edit.enabled !== 'boolean') {
      rejectUnsupported();
    }
    await runner.formatRange(
      filePath,
      wordInspection.path,
      wordInspection.start,
      wordInspection.end,
      edit.property,
      edit.enabled
    );
    return;
  }

  rejectUnsupported();
}
