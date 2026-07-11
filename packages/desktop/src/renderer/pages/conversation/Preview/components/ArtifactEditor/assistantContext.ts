/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OfficeArtifactInspection } from '@/common/types/office/artifactEditor';

export type OfficeAssistantTranslate = (key: string, values?: Record<string, string>) => string;

function fileNameOnly(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function formatExcelCells(inspection: Extract<OfficeArtifactInspection, { kind: 'excel' }>): string {
  return inspection.cells
    .map((cell) => {
      const stablePath = cell.path.replace(/^\/+/, '');
      return `${stablePath}: ${cell.displayText}`;
    })
    .join('\n');
}

/** Build translated Office selection context suitable for adding to the composer. */
export function buildOfficeAssistantContext(
  translate: OfficeAssistantTranslate,
  fileName: string,
  inspection: OfficeArtifactInspection
): string {
  const placeholder = translate('preview.office.editor.requestPlaceholder');
  const safeFileName = fileNameOnly(fileName);

  if (inspection.kind === 'word') {
    return translate('preview.office.editor.askWordContext', {
      fileName: safeFileName,
      path: inspection.path,
      text: inspection.selectedText,
      placeholder,
    });
  }

  return translate('preview.office.editor.askExcelContext', {
    fileName: safeFileName,
    range: inspection.range,
    cells: formatExcelCells(inspection),
    placeholder,
  });
}
