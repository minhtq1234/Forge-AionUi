/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OfficeArtifactService } from './OfficeArtifactService';
import { hashOfficeArtifact, resolveOfficeArtifactPath } from './officeArtifactPath';
import { OfficeArtifactSnapshotStore } from './officeArtifactSnapshots';
import { OfficeArtifactWorkingFiles } from './officeArtifactWorkingFiles';
import { createOfficeCliRunner } from './officeCliRunner';
import { retainOfficePreviewOrigin } from './officePreviewSession';

const historyRoot = join(tmpdir(), 'aionui-office-artifact-history', `${process.pid}-${randomUUID()}`);
const snapshotStore = new OfficeArtifactSnapshotStore(historyRoot);

export const officeArtifactService = new OfficeArtifactService({
  runner: createOfficeCliRunner(),
  snapshots: snapshotStore,
  resolveArtifact: resolveOfficeArtifactPath,
  hashArtifact: hashOfficeArtifact,
  workingFiles: new OfficeArtifactWorkingFiles(),
  retainPreviewOrigin: retainOfficePreviewOrigin,
});

export async function disposeOfficeArtifactService(): Promise<void> {
  await officeArtifactService.dispose();
}

export * from './OfficeArtifactService';
export * from './docxArtifactStrategy';
export * from './officeArtifactPath';
export * from './officeArtifactSnapshots';
export * from './officeArtifactWorkingFiles';
export * from './officeCliJson';
export * from './officeCliRunner';
export * from './xlsxArtifactStrategy';
