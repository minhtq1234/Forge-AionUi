/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, link, mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';

import type { OfficeArtifactErrorCode } from '@/common/types/office/artifactEditor';

import { hashOfficeArtifact } from './officeArtifactPath';
import { OfficeArtifactError } from './officeCliJson';

export type OfficeArtifactPreviewCopy = { filePath: string; workspace: string };

export type OfficeArtifactWorkingFilesApi = Pick<
  OfficeArtifactWorkingFiles,
  'create' | 'createPreview' | 'install' | 'remove' | 'dispose'
>;

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export async function replaceOfficeArtifactConditionally(
  replacementPath: string,
  filePath: string,
  expectedVersion: string,
  replacementVersion: string,
  failureCode: Extract<OfficeArtifactErrorCode, 'OFFICECLI_FAILED' | 'RESTORE_FAILED'>
): Promise<void> {
  const recoveryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.forge-recovery`);
  let displaced = false;

  try {
    if ((await hashOfficeArtifact(replacementPath)) !== replacementVersion) {
      throw new OfficeArtifactError(failureCode);
    }

    try {
      await rename(filePath, recoveryPath);
      displaced = true;
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) throw new OfficeArtifactError('FILE_CHANGED');
      throw error;
    }

    if ((await hashOfficeArtifact(recoveryPath)) !== expectedVersion) {
      throw new OfficeArtifactError('FILE_CHANGED');
    }

    try {
      await link(replacementPath, filePath);
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) throw new OfficeArtifactError('FILE_CHANGED');
      throw error;
    }

    if ((await hashOfficeArtifact(filePath)) !== replacementVersion) {
      throw new OfficeArtifactError('FILE_CHANGED');
    }

    await rm(recoveryPath);
    displaced = false;
  } catch (error) {
    if (displaced) {
      try {
        await link(recoveryPath, filePath);
        await rm(recoveryPath);
        displaced = false;
      } catch (recoveryError) {
        if (!hasErrorCode(recoveryError, 'EEXIST')) throw new OfficeArtifactError(failureCode);
        await rm(recoveryPath, { force: true });
        displaced = false;
      }
    }

    if (error instanceof OfficeArtifactError) throw error;
    throw new OfficeArtifactError(failureCode);
  }
}

export class OfficeArtifactWorkingFiles {
  constructor(
    private readonly previewRoot = join(tmpdir(), 'aionui-office-artifact-previews', `${process.pid}-${randomUUID()}`)
  ) {}

  async create(filePath: string): Promise<string> {
    const extension = extname(filePath);
    const fileName = basename(filePath, extension);
    const stagedPath = join(dirname(filePath), `.${fileName}.${randomUUID()}.forge-edit${extension}`);

    try {
      await copyFile(filePath, stagedPath, constants.COPYFILE_EXCL);
      return stagedPath;
    } catch {
      await rm(stagedPath, { force: true }).catch((): undefined => undefined);
      throw new OfficeArtifactError('SNAPSHOT_FAILED');
    }
  }

  async install(stagedPath: string, filePath: string, expectedVersion: string, stagedVersion: string): Promise<void> {
    await replaceOfficeArtifactConditionally(stagedPath, filePath, expectedVersion, stagedVersion, 'OFFICECLI_FAILED');
  }

  async remove(stagedPath: string): Promise<void> {
    await rm(stagedPath, { force: true }).catch((): undefined => undefined);
    const parentDirectory = dirname(stagedPath);
    if (dirname(parentDirectory) === this.previewRoot) {
      await rm(parentDirectory, { force: true, recursive: true }).catch((): undefined => undefined);
    }
  }

  async createPreview(filePath: string): Promise<OfficeArtifactPreviewCopy> {
    const leaseDirectory = join(this.previewRoot, randomUUID());
    const previewPath = join(leaseDirectory, basename(filePath));

    try {
      await mkdir(this.previewRoot, { recursive: true, mode: 0o700 });
      await chmod(this.previewRoot, 0o700);
      await mkdir(leaseDirectory, { mode: 0o700 });
      await chmod(leaseDirectory, 0o700);
      await copyFile(filePath, previewPath, constants.COPYFILE_EXCL);
      await chmod(previewPath, 0o600);
      return { filePath: previewPath, workspace: leaseDirectory };
    } catch {
      await rm(leaseDirectory, { force: true, recursive: true }).catch((): undefined => undefined);
      throw new OfficeArtifactError('PREVIEW_FAILED');
    }
  }

  async dispose(): Promise<void> {
    await rm(this.previewRoot, { force: true, recursive: true }).catch((): undefined => undefined);
  }
}
