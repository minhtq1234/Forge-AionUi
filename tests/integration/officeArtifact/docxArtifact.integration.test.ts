/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Document,
  type IParagraphOptions,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
  XmlAttributeComponent,
} from 'docx';
import { afterEach, describe, expect, it } from 'vitest';

import { hashOfficeArtifact } from '@/process/services/office-artifact/officeArtifactPath';

import {
  assertMutationSuccess,
  createOfficeArtifactIntegrationContext,
  formatEnabled,
  getDocxParagraph,
  getRunsInRange,
  resolveOfficeCliPath,
  stableRunFidelity,
  type OfficeArtifactIntegrationContext,
} from './helpers';

const PARAGRAPH_PATH = '/body/p[1]';
const ORIGINAL_TEXT = 'Before draft remains';
const SELECTED_TEXT = 'draft';
const REPLACEMENT_TEXT = 'final';
const SELECTION_START = ORIGINAL_TEXT.indexOf(SELECTED_TEXT);
const SELECTION_END = SELECTION_START + SELECTED_TEXT.length;
const officeCliPath = resolveOfficeCliPath();

class ParagraphIdAttribute extends XmlAttributeComponent<{ paraId: string }> {
  protected readonly xmlKeys = { paraId: 'w14:paraId' };

  constructor(paraId: string) {
    super({ paraId });
  }
}

class StableParagraph extends Paragraph {
  constructor(paraId: string, options: IParagraphOptions) {
    super(options);
    this.root.unshift(new ParagraphIdAttribute(paraId));
  }
}

async function writeDocxFixture(filePath: string): Promise<void> {
  const document = new Document({
    sections: [
      {
        children: [
          new StableParagraph('00100000', {
            children: [
              new TextRun({ text: 'Before ', bold: true }),
              new TextRun({ text: SELECTED_TEXT, italics: true }),
              new TextRun({ text: ' remains', underline: { type: UnderlineType.SINGLE } }),
            ],
          }),
        ],
      },
    ],
  });
  await writeFile(filePath, await Packer.toBuffer(document));
}

describe.skipIf(officeCliPath === undefined)('OfficeArtifactService real DOCX integration', () => {
  let context: OfficeArtifactIntegrationContext | undefined;

  afterEach(async () => {
    try {
      await context?.cleanup();
    } finally {
      context = undefined;
    }
  });

  it('replaces and formats a safe selection without flattening unaffected runs, then undoes exactly', async () => {
    if (!officeCliPath) throw new Error('OfficeCLI path was not resolved');
    context = await createOfficeArtifactIntegrationContext(officeCliPath);
    const filePath = join(context.workspace, 'fidelity.docx');
    await writeDocxFixture(filePath);

    const before = await getDocxParagraph(context.runner, filePath, PARAGRAPH_PATH);
    expect(before.text).toBe(ORIGINAL_TEXT);
    expect(before.path).toBe('/body/p[@paraId=00100000]');
    const originalBinary = await readFile(filePath);
    const originalHash = await hashOfficeArtifact(filePath);
    const unaffectedBefore = before.runs.filter((run) => run.text !== SELECTED_TEXT).map(stableRunFidelity);

    const replaceResult = await context.service.apply({
      workspace: context.workspace,
      filePath,
      expectedVersion: originalHash,
      selection: {
        kind: 'word',
        path: before.path,
        paragraphText: ORIGINAL_TEXT,
        selectedText: SELECTED_TEXT,
        start: SELECTION_START,
        end: SELECTION_END,
      },
      edit: { kind: 'replaceText', value: REPLACEMENT_TEXT },
    });
    const replaced = assertMutationSuccess(replaceResult);
    expect(replaced.undoDepth).toBe(1);
    const replacedBinary = await readFile(filePath);

    const replacedParagraph = await getDocxParagraph(context.runner, filePath, before.path);
    expect(replacedParagraph.text).toBe('Before final remains');
    expect(
      getRunsInRange(replacedParagraph, SELECTION_START, SELECTION_END).every((run) => formatEnabled(run, 'italic'))
    ).toBe(true);
    const formatResult = await context.service.apply({
      workspace: context.workspace,
      filePath,
      expectedVersion: replaced.version,
      selection: {
        kind: 'word',
        path: replacedParagraph.path,
        paragraphText: replacedParagraph.text,
        selectedText: REPLACEMENT_TEXT,
        start: SELECTION_START,
        end: SELECTION_END,
      },
      edit: { kind: 'formatText', property: 'bold', enabled: true },
    });
    expect(formatResult.ok).toBe(true);
    const formatted = assertMutationSuccess(formatResult);
    expect(formatted.undoDepth).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(await hashOfficeArtifact(filePath)).toBe(formatted.version);

    const after = await getDocxParagraph(context.runner, filePath, replacedParagraph.path);
    const unaffectedAfter = after.runs.filter((run) => run.text !== REPLACEMENT_TEXT).map(stableRunFidelity);
    expect(unaffectedAfter).toEqual(unaffectedBefore);
    const formattedRuns = getRunsInRange(after, SELECTION_START, SELECTION_END);
    expect(formattedRuns.length).toBeGreaterThan(0);
    expect(formattedRuns.every((run) => formatEnabled(run, 'bold'))).toBe(true);

    const undoFormatResult = await context.service.undo({
      workspace: context.workspace,
      filePath,
      expectedVersion: formatted.version,
    });
    const undoFormat = assertMutationSuccess(undoFormatResult);
    expect(undoFormat.version).toBe(replaced.version);
    expect(undoFormat.undoDepth).toBe(1);
    expect(await readFile(filePath)).toEqual(replacedBinary);

    const undoReplaceResult = await context.service.undo({
      workspace: context.workspace,
      filePath,
      expectedVersion: undoFormat.version,
    });
    const undoReplace = assertMutationSuccess(undoReplaceResult);
    expect(undoReplace.version).toBe(originalHash);
    expect(undoReplace.undoDepth).toBe(0);
    expect(await hashOfficeArtifact(filePath)).toBe(originalHash);
    expect(await readFile(filePath)).toEqual(originalBinary);
  }, 60_000);
});
