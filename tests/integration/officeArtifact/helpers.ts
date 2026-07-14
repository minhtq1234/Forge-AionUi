/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { accessSync, constants, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

import type { OfficeArtifactMutationResult } from '@/common/types/office/artifactEditor';
import { OfficeArtifactService } from '@/process/services/office-artifact/OfficeArtifactService';
import { hashOfficeArtifact, resolveOfficeArtifactPath } from '@/process/services/office-artifact/officeArtifactPath';
import { OfficeArtifactSnapshotStore } from '@/process/services/office-artifact/officeArtifactSnapshots';
import { OfficeArtifactWorkingFiles } from '@/process/services/office-artifact/officeArtifactWorkingFiles';
import { createOfficeCliRunner, type OfficeCliRunner } from '@/process/services/office-artifact/officeCliRunner';

export type OfficeArtifactIntegrationContext = {
  workspace: string;
  service: OfficeArtifactService;
  runner: OfficeCliRunner;
  cleanup: () => Promise<void>;
};

export type OfficeCliRun = {
  text: string;
  format: Record<string, unknown>;
};

export type OfficeCliParagraph = {
  path: string;
  text: string;
  runs: OfficeCliRun[];
};

export type OfficeCliCell = {
  path: string;
  displayText: string;
  input: string;
};

type MutationSuccess = Extract<OfficeArtifactMutationResult, { ok: true }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUsableBinary(candidate: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve an executable OfficeCLI binary in the same order used by the product. */
export function resolveOfficeCliPath(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const explicit = environment.OFFICECLI_PATH?.trim();
  if (explicit && isAbsolute(explicit) && isUsableBinary(explicit, platform)) return explicit;

  const binaryName = platform === 'win32' ? 'officecli.exe' : 'officecli';
  const localBinary = join(homeDirectory, '.local', 'bin', binaryName);
  if (isUsableBinary(localBinary, platform)) return localBinary;

  const pathValue = environment.PATH ?? environment.Path ?? '';
  for (const pathEntry of pathValue.split(delimiter)) {
    const directory = pathEntry || process.cwd();
    const candidate = join(directory, binaryName);
    if (isUsableBinary(candidate, platform)) return candidate;
  }

  return undefined;
}

export function createOfficeArtifactService(
  workspace: string,
  runner: OfficeCliRunner,
  historyDirectory = '.history'
): OfficeArtifactService {
  return new OfficeArtifactService({
    runner,
    snapshots: new OfficeArtifactSnapshotStore(join(workspace, historyDirectory)),
    resolveArtifact: resolveOfficeArtifactPath,
    hashArtifact: hashOfficeArtifact,
    workingFiles: new OfficeArtifactWorkingFiles(),
  });
}

export async function createOfficeArtifactIntegrationContext(
  officeCliPath: string
): Promise<OfficeArtifactIntegrationContext> {
  const workspace = await mkdtemp(join(tmpdir(), 'forge-office-artifact-'));
  const runner = createOfficeCliRunner({ binaryPath: officeCliPath });
  const service = createOfficeArtifactService(workspace, runner);

  return {
    workspace,
    service,
    runner,
    cleanup: async () => {
      try {
        await service.dispose();
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
  };
}

function singleResult(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value.results) || value.results.length !== 1) {
    throw new Error('OfficeCLI did not return exactly one result');
  }

  const result = value.results[0];
  if (!isRecord(result)) throw new Error('OfficeCLI returned an invalid result');
  return result;
}

export async function getDocxParagraph(
  runner: OfficeCliRunner,
  filePath: string,
  path: string
): Promise<OfficeCliParagraph> {
  try {
    const paragraph = singleResult(await runner.get(filePath, path));
    if (
      paragraph.type !== 'paragraph' ||
      typeof paragraph.path !== 'string' ||
      typeof paragraph.text !== 'string' ||
      !Array.isArray(paragraph.children)
    ) {
      throw new Error('OfficeCLI returned an invalid DOCX paragraph');
    }

    const runs = paragraph.children.map((child): OfficeCliRun => {
      if (!isRecord(child) || child.type !== 'run' || typeof child.text !== 'string' || !isRecord(child.format)) {
        throw new Error('OfficeCLI returned an invalid DOCX run');
      }
      return { text: child.text, format: child.format };
    });

    return { path: paragraph.path, text: paragraph.text, runs };
  } finally {
    await runner.close(filePath);
  }
}

export async function getXlsxCell(runner: OfficeCliRunner, filePath: string, path: string): Promise<OfficeCliCell> {
  try {
    const cell = singleResult(await runner.get(filePath, path));
    if (
      cell.type !== 'cell' ||
      typeof cell.path !== 'string' ||
      typeof cell.text !== 'string' ||
      !isRecord(cell.format)
    ) {
      throw new Error('OfficeCLI returned an invalid XLSX cell');
    }

    const formula = cell.format.formula;
    if (formula !== undefined && typeof formula !== 'string') {
      throw new Error('OfficeCLI returned an invalid XLSX formula');
    }

    return {
      path: cell.path,
      displayText: cell.text,
      input: formula === undefined ? cell.text : `=${formula}`,
    };
  } finally {
    await runner.close(filePath);
  }
}

export function getRunsInRange(paragraph: OfficeCliParagraph, start: number, end: number): OfficeCliRun[] {
  const runs: OfficeCliRun[] = [];
  let offset = 0;

  for (const run of paragraph.runs) {
    const runStart = offset;
    offset += run.text.length;
    if (runStart < end && offset > start) runs.push(run);
  }

  return runs;
}

export function stableRunFidelity(run: OfficeCliRun): OfficeCliRun {
  return {
    text: run.text,
    format: Object.fromEntries(Object.entries(run.format).filter(([key]) => !key.endsWith('.src'))),
  };
}

export function formatEnabled(run: OfficeCliRun, property: 'bold' | 'italic' | 'underline'): boolean {
  const value = Object.prototype.hasOwnProperty.call(run.format, property)
    ? run.format[property]
    : run.format[`effective.${property}`];
  if (property !== 'underline') return value === true;
  return value === true || (typeof value === 'string' && !['', 'none', 'false'].includes(value.toLowerCase()));
}

export function assertMutationSuccess(result: OfficeArtifactMutationResult): MutationSuccess {
  if (!result.ok) throw new Error(`Expected mutation success, received ${result.code}`);
  return result;
}
