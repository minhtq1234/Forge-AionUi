/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx-republish';

import { hashOfficeArtifact } from '@/process/services/office-artifact/officeArtifactPath';
import { OfficeArtifactError } from '@/process/services/office-artifact/officeCliJson';
import type { OfficeCliRunner } from '@/process/services/office-artifact/officeCliRunner';

import {
  assertMutationSuccess,
  createOfficeArtifactService,
  createOfficeArtifactIntegrationContext,
  getXlsxCell,
  resolveOfficeCliPath,
  type OfficeArtifactIntegrationContext,
} from './helpers';

const officeCliPath = resolveOfficeCliPath();

function serializeWorkbook(workbook: XLSX.WorkBook): Buffer {
  const serialized: unknown = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  if (!Buffer.isBuffer(serialized)) throw new Error('XLSX fixture did not serialize to a buffer');
  return serialized;
}

async function writeXlsxFixture(filePath: string): Promise<void> {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([[1, 2, 'guard']]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  await writeFile(filePath, serializeWorkbook(workbook));
}

async function writeExternalWorkbookChange(filePath: string): Promise<void> {
  const workbook = XLSX.read(await readFile(filePath), { type: 'buffer', cellFormula: true });
  const worksheet = workbook.Sheets.Sheet1;
  if (!worksheet) throw new Error('Fixture worksheet is missing');
  XLSX.utils.sheet_add_aoa(worksheet, [['external-change']], { origin: 'D1' });
  await writeFile(filePath, serializeWorkbook(workbook));
}

describe.skipIf(officeCliPath === undefined)('OfficeArtifactService real XLSX integration', () => {
  let context: OfficeArtifactIntegrationContext | undefined;

  afterEach(async () => {
    try {
      await context?.cleanup();
    } finally {
      context = undefined;
    }
  });

  it('persists a value and formula, rejects an external conflict, and restores exact versions', async () => {
    if (!officeCliPath) throw new Error('OfficeCLI path was not resolved');
    context = await createOfficeArtifactIntegrationContext(officeCliPath);
    const filePath = join(context.workspace, 'fidelity.xlsx');
    await writeXlsxFixture(filePath);

    const initialA1 = await getXlsxCell(context.runner, filePath, '/Sheet1/A1');
    const originalBinary = await readFile(filePath);
    const originalHash = await hashOfficeArtifact(filePath);
    const valueResult = await context.service.apply({
      workspace: context.workspace,
      filePath,
      expectedVersion: originalHash,
      selection: {
        kind: 'excel',
        paths: [initialA1.path],
        cells: [{ path: initialA1.path, displayText: initialA1.displayText }],
      },
      edit: { kind: 'setCell', input: '42' },
    });
    expect(valueResult, JSON.stringify(valueResult)).toMatchObject({ ok: true });
    const value = assertMutationSuccess(valueResult);
    expect(value.undoDepth).toBe(1);
    expect((await getXlsxCell(context.runner, filePath, '/Sheet1/A1')).input).toBe('42');
    const valueBinary = await readFile(filePath);

    const initialB1 = await getXlsxCell(context.runner, filePath, '/Sheet1/B1');
    const formulaResult = await context.service.apply({
      workspace: context.workspace,
      filePath,
      expectedVersion: value.version,
      selection: {
        kind: 'excel',
        paths: [initialB1.path],
        cells: [{ path: initialB1.path, displayText: initialB1.displayText }],
      },
      edit: { kind: 'setCell', input: '=A1*2' },
    });
    expect(formulaResult.ok).toBe(true);
    const formula = assertMutationSuccess(formulaResult);
    expect(formula.undoDepth).toBe(2);
    expect((await getXlsxCell(context.runner, filePath, '/Sheet1/B1')).input).toBe('=A1*2');
    const formulaBinary = await readFile(filePath);

    const guardCell = await getXlsxCell(context.runner, filePath, '/Sheet1/C1');
    await writeExternalWorkbookChange(filePath);
    const externalBinary = await readFile(filePath);
    expect(await hashOfficeArtifact(filePath)).not.toBe(formula.version);

    await expect(
      context.service.apply({
        workspace: context.workspace,
        filePath,
        expectedVersion: formula.version,
        selection: {
          kind: 'excel',
          paths: [guardCell.path],
          cells: [{ path: guardCell.path, displayText: guardCell.displayText }],
        },
        edit: { kind: 'setCell', input: 'blocked' },
      })
    ).resolves.toEqual({ ok: false, code: 'FILE_CHANGED' });
    expect(await readFile(filePath)).toEqual(externalBinary);

    await writeFile(filePath, formulaBinary);
    expect(await hashOfficeArtifact(filePath)).toBe(formula.version);
    const undoFormulaResult = await context.service.undo({
      workspace: context.workspace,
      filePath,
      expectedVersion: formula.version,
    });
    const undoFormula = assertMutationSuccess(undoFormulaResult);
    expect(undoFormula.version).toBe(value.version);
    expect(undoFormula.undoDepth).toBe(1);
    expect(await readFile(filePath)).toEqual(valueBinary);

    const undoValueResult = await context.service.undo({
      workspace: context.workspace,
      filePath,
      expectedVersion: undoFormula.version,
    });
    const undoValue = assertMutationSuccess(undoValueResult);
    expect(undoValue.version).toBe(originalHash);
    expect(undoValue.undoDepth).toBe(0);
    expect(await hashOfficeArtifact(filePath)).toBe(originalHash);
    expect(await readFile(filePath)).toEqual(originalBinary);
  }, 90_000);

  it('keeps original bytes and removes staging files when post-mutation validation fails', async () => {
    if (!officeCliPath) throw new Error('OfficeCLI path was not resolved');
    context = await createOfficeArtifactIntegrationContext(officeCliPath);
    const filePath = join(context.workspace, 'failed-validation.xlsx');
    await writeXlsxFixture(filePath);
    const originalBinary = await readFile(filePath);
    const originalHash = await hashOfficeArtifact(filePath);
    const initialA1 = await getXlsxCell(context.runner, filePath, '/Sheet1/A1');
    const failingRunner: OfficeCliRunner = {
      ...context.runner,
      validate: async (stagedPath) => {
        await context?.runner.validate(stagedPath);
        throw new OfficeArtifactError('OFFICECLI_FAILED');
      },
    };
    const failingService = createOfficeArtifactService(context.workspace, failingRunner, '.failure-history');

    try {
      await expect(
        failingService.apply({
          workspace: context.workspace,
          filePath,
          expectedVersion: originalHash,
          selection: {
            kind: 'excel',
            paths: [initialA1.path],
            cells: [{ path: initialA1.path, displayText: initialA1.displayText }],
          },
          edit: { kind: 'setCell', input: '99' },
        })
      ).resolves.toEqual({ ok: false, code: 'OFFICECLI_FAILED' });
    } finally {
      await failingService.dispose();
    }

    expect(await readFile(filePath)).toEqual(originalBinary);
    expect((await readdir(context.workspace)).filter((name) => name.includes('.forge-edit'))).toEqual([]);
  }, 60_000);
});
