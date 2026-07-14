/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hashOfficeArtifact, resolveOfficeArtifactPath } from '@/process/services/office-artifact/officeArtifactPath';

const temporaryPaths: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aionui-office-artifact-'));
  temporaryPaths.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('resolveOfficeArtifactPath', () => {
  it('resolves a supported file to its canonical workspace path', async () => {
    const workspace = await createTemporaryDirectory();
    const filePath = join(workspace, 'report.DOCX');
    await writeFile(filePath, 'document');

    await expect(resolveOfficeArtifactPath(workspace, filePath)).resolves.toMatchObject({
      workspace: await realpath(workspace),
      filePath: await realpath(filePath),
      kind: 'word',
    });
  });

  it('rejects a symlink that escapes the workspace', async () => {
    const workspace = await createTemporaryDirectory();
    const outsideDirectory = await createTemporaryDirectory();
    const outsideFile = join(outsideDirectory, 'outside.docx');
    await writeFile(outsideFile, 'outside');
    await symlink(outsideFile, join(workspace, 'escape.docx'));

    await expect(resolveOfficeArtifactPath(workspace, join(workspace, 'escape.docx'))).rejects.toMatchObject({
      code: 'OUTSIDE_WORKSPACE',
    });
  });

  it('rejects unsupported file types and directories', async () => {
    const workspace = await createTemporaryDirectory();
    const textFile = join(workspace, 'notes.txt');
    const workbookDirectory = join(workspace, 'folder.xlsx');
    await writeFile(textFile, 'notes');
    await mkdir(workbookDirectory);

    await expect(resolveOfficeArtifactPath(workspace, textFile)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE',
    });
    await expect(resolveOfficeArtifactPath(workspace, workbookDirectory)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
  });

  it('returns a typed error when the artifact cannot be resolved', async () => {
    const workspace = await createTemporaryDirectory();

    await expect(resolveOfficeArtifactPath(workspace, join(workspace, 'missing.docx'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
  });
});

describe('hashOfficeArtifact', () => {
  it('returns a SHA-256 digest for the artifact bytes', async () => {
    const workspace = await createTemporaryDirectory();
    const filePath = join(workspace, 'report.docx');
    await writeFile(filePath, 'abc');

    await expect(hashOfficeArtifact(filePath)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
