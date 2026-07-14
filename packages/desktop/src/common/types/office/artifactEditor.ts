/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const OFFICE_PREVIEW_PARTITION = 'persist:forge-office-preview';
export const OFFICE_ARTIFACT_MAX_SELECTION_MESSAGE_BYTES = 64 * 1024;
export const OFFICE_ARTIFACT_MAX_SELECTED_CELLS = 256;

export type OfficeArtifactErrorCode =
  | 'STALE_SELECTION'
  | 'FILE_CHANGED'
  | 'AMBIGUOUS_TEXT'
  | 'UNSUPPORTED_CONTENT'
  | 'OUTSIDE_WORKSPACE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'OFFICECLI_NOT_FOUND'
  | 'OFFICECLI_FAILED'
  | 'SNAPSHOT_FAILED'
  | 'RESTORE_FAILED'
  | 'PREVIEW_FAILED';

export type DocxSelectionSnapshot = {
  kind: 'word';
  path: string;
  paragraphText: string;
  selectedText: string;
  start: number;
  end: number;
};

export type ExcelSelectionSnapshot = {
  kind: 'excel';
  paths: string[];
  cells: Array<{ path: string; displayText: string }>;
};

export type OfficeArtifactSelection = DocxSelectionSnapshot | ExcelSelectionSnapshot;
export type OfficeArtifactEdit =
  | { kind: 'replaceText'; value: string }
  | { kind: 'formatText'; property: 'bold' | 'italic' | 'underline'; enabled: boolean }
  | { kind: 'setCell'; input: string };

export type OfficeArtifactRequestBase = {
  /** Required at the renderer IPC boundary; main-only service callers already hold a trusted workspace. */
  conversationId?: string;
  workspace: string;
  filePath: string;
};
export type OfficeArtifactGetStateRequest = OfficeArtifactRequestBase;
export type OfficeArtifactPreparePreviewRequest = OfficeArtifactRequestBase;
export type OfficeArtifactStartPreviewRequest = { leaseId: string; url?: string };
export type OfficeArtifactReleasePreviewRequest = { leaseId: string };
export type OfficeArtifactInspectRequest = OfficeArtifactRequestBase & {
  expectedVersion: string;
  selection: OfficeArtifactSelection;
};
export type OfficeArtifactApplyRequest = OfficeArtifactInspectRequest & { edit: OfficeArtifactEdit };
export type OfficeArtifactUndoRequest = OfficeArtifactRequestBase & { expectedVersion: string };

export type OfficeArtifactWordInspection = {
  kind: 'word';
  path: string;
  selectedText: string;
  start: number;
  end: number;
  canReplace: boolean;
  canFormat: boolean;
  formatting: { bold: boolean; italic: boolean; underline: boolean };
};
export type OfficeArtifactExcelInspection = {
  kind: 'excel';
  range: string;
  cells: Array<{ path: string; displayText: string; input: string }>;
  canEdit: boolean;
};
export type OfficeArtifactInspection = OfficeArtifactWordInspection | OfficeArtifactExcelInspection;

export type OfficeArtifactFailure = { ok: false; code: OfficeArtifactErrorCode };
export type OfficeArtifactStateResult = { ok: true; version: string; undoDepth: number } | OfficeArtifactFailure;
export type OfficeArtifactInspectResult =
  | { ok: true; version: string; inspection: OfficeArtifactInspection }
  | OfficeArtifactFailure;
export type OfficeArtifactMutationResult =
  | { ok: true; version: string; snapshotId: string; undoDepth: number }
  | OfficeArtifactFailure;
export type OfficeArtifactPreparePreviewResult =
  | { ok: true; leaseId: string; filePath: string; workspace: string }
  | OfficeArtifactFailure;
export type OfficeArtifactStartPreviewResult = { ok: true; url: string } | OfficeArtifactFailure;
export type OfficeArtifactReleasePreviewResult = { ok: true } | OfficeArtifactFailure;
