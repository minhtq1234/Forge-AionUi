/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { OfficeArtifactError } from './officeCliJson';

export type ResolvedOfficeArtifact = {
  workspace: string;
  filePath: string;
  kind: 'word' | 'excel';
};

export async function resolveOfficeArtifactPath(workspace: string, filePath: string): Promise<ResolvedOfficeArtifact> {
  let canonicalWorkspace: string;
  let canonicalFile: string;

  try {
    [canonicalWorkspace, canonicalFile] = await Promise.all([realpath(workspace), realpath(filePath)]);
  } catch {
    throw new OfficeArtifactError('UNSUPPORTED_CONTENT');
  }

  const relativePath = relative(canonicalWorkspace, canonicalFile);
  if (relativePath === '' || relativePath.startsWith(`..${sep}`) || relativePath === '..' || isAbsolute(relativePath)) {
    throw new OfficeArtifactError('OUTSIDE_WORKSPACE');
  }

  const extension = extname(canonicalFile).toLowerCase();
  if (extension !== '.docx' && extension !== '.xlsx') throw new OfficeArtifactError('UNSUPPORTED_FILE_TYPE');

  try {
    if (!(await stat(canonicalFile)).isFile()) throw new OfficeArtifactError('UNSUPPORTED_CONTENT');
  } catch (error) {
    if (error instanceof OfficeArtifactError) throw error;
    throw new OfficeArtifactError('UNSUPPORTED_CONTENT');
  }

  return {
    workspace: canonicalWorkspace,
    filePath: canonicalFile,
    kind: extension === '.docx' ? 'word' : 'excel',
  };
}

export async function hashOfficeArtifact(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}
