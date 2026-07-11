/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hashOfficeArtifact } from '@/process/services/office-artifact/officeArtifactPath';
import { OfficeArtifactWorkingFiles } from '@/process/services/office-artifact/officeArtifactWorkingFiles';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('OfficeArtifactWorkingFiles', () => {
  it.each(['report.docx', 'forecast.xlsx'])('preserves the Office extension for staged %s edits', async (fileName) => {
    const workspace = await mkdtemp(join(tmpdir(), 'aionui-office-artifact-working-'));
    temporaryPaths.push(workspace);
    const filePath = join(workspace, fileName);
    await writeFile(filePath, 'original');
    const workingFiles = new OfficeArtifactWorkingFiles();

    const stagedPath = await workingFiles.create(filePath);

    expect(extname(stagedPath)).toBe(extname(filePath));
    await expect(readFile(stagedPath, 'utf8')).resolves.toBe('original');
  });

  it('atomically installs a staged artifact and tolerates final cleanup', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'aionui-office-artifact-working-'));
    temporaryPaths.push(workspace);
    const filePath = join(workspace, 'report.docx');
    await writeFile(filePath, 'original');
    const workingFiles = new OfficeArtifactWorkingFiles();
    const stagedPath = await workingFiles.create(filePath);
    await writeFile(stagedPath, 'edited');
    const originalVersion = await hashOfficeArtifact(filePath);
    const editedVersion = await hashOfficeArtifact(stagedPath);

    await workingFiles.install(stagedPath, filePath, originalVersion, editedVersion);
    await workingFiles.remove(stagedPath);

    await expect(readFile(filePath, 'utf8')).resolves.toBe('edited');
    await expect(stat(stagedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite a target changed after the caller version check', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'aionui-office-artifact-working-'));
    temporaryPaths.push(workspace);
    const filePath = join(workspace, 'report.docx');
    await writeFile(filePath, 'original');
    const workingFiles = new OfficeArtifactWorkingFiles();
    const stagedPath = await workingFiles.create(filePath);
    await writeFile(stagedPath, 'edited');
    const originalVersion = await hashOfficeArtifact(filePath);
    const editedVersion = await hashOfficeArtifact(stagedPath);
    await writeFile(filePath, 'external');

    await expect(workingFiles.install(stagedPath, filePath, originalVersion, editedVersion)).rejects.toMatchObject({
      code: 'FILE_CHANGED',
    });
    await expect(readFile(filePath, 'utf8')).resolves.toBe('external');
  });

  it('creates a private per-lease preview with the original artifact basename', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'aionui-office-artifact-working-'));
    const previewRoot = await mkdtemp(join(tmpdir(), 'aionui-office-artifact-preview-'));
    temporaryPaths.push(workspace, previewRoot);
    const filePath = join(workspace, 'report.docx');
    await writeFile(filePath, 'original');
    const workingFiles = new OfficeArtifactWorkingFiles(previewRoot);

    const preview = await workingFiles.createPreview(filePath);

    expect(preview.workspace).toBe(dirname(preview.filePath));
    expect(dirname(preview.workspace)).toBe(previewRoot);
    expect(basename(preview.filePath)).toBe('report.docx');
    await expect(readFile(preview.filePath, 'utf8')).resolves.toBe('original');
    expect((await stat(previewRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(preview.workspace)).mode & 0o777).toBe(0o700);
    expect((await stat(preview.filePath)).mode & 0o777).toBe(0o600);
  });
});
