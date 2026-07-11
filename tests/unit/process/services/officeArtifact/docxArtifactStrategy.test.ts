/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DocxSelectionSnapshot,
  OfficeArtifactEdit,
  OfficeArtifactExcelInspection,
  OfficeArtifactWordInspection,
} from '@/common/types/office/artifactEditor';
import { inspectDocxSelection, mutateDocxSelection } from '@/process/services/office-artifact/docxArtifactStrategy';
import type { OfficeCliRunner } from '@/process/services/office-artifact/officeCliRunner';

const FILE_PATH = '/workspace/report.docx';
const PARAGRAPH_PATH = '/body/p[@paraId=00100000]';

const safeParagraph = {
  path: PARAGRAPH_PATH,
  type: 'paragraph',
  text: 'Quarterly revenue grew',
  format: {},
  children: [
    {
      path: `${PARAGRAPH_PATH}/r[1]`,
      type: 'run',
      text: 'Quarterly ',
      format: { bold: true },
      children: [],
    },
    {
      path: `${PARAGRAPH_PATH}/r[2]`,
      type: 'run',
      text: 'revenue',
      format: { bold: true },
      children: [],
    },
    {
      path: `${PARAGRAPH_PATH}/r[3]`,
      type: 'run',
      text: ' grew',
      format: {},
      children: [],
    },
  ],
};

const safeSelection: DocxSelectionSnapshot = {
  kind: 'word',
  path: PARAGRAPH_PATH,
  paragraphText: safeParagraph.text,
  selectedText: 'revenue',
  start: 10,
  end: 17,
};

const safeInspection: OfficeArtifactWordInspection = {
  kind: 'word',
  path: PARAGRAPH_PATH,
  selectedText: 'revenue',
  start: 10,
  end: 17,
  canReplace: true,
  canFormat: true,
  formatting: { bold: true, italic: false, underline: false },
};

function getEnvelope(paragraph: unknown): unknown {
  return { matches: 1, results: [paragraph] };
}

const runner = {
  get: vi.fn<OfficeCliRunner['get']>(),
  replaceText: vi.fn<OfficeCliRunner['replaceText']>(),
  formatRange: vi.fn<OfficeCliRunner['formatRange']>(),
  setCell: vi.fn<OfficeCliRunner['setCell']>(),
  validate: vi.fn<OfficeCliRunner['validate']>(),
  close: vi.fn<OfficeCliRunner['close']>(),
} satisfies OfficeCliRunner;

beforeEach(() => {
  vi.resetAllMocks();
  runner.get.mockResolvedValue(getEnvelope(safeParagraph));
  runner.replaceText.mockResolvedValue({ matched: 1 });
  runner.formatRange.mockResolvedValue({});
});

describe('inspectDocxSelection', () => {
  it('returns the safe replacement range and its direct formatting', async () => {
    await expect(inspectDocxSelection(runner, FILE_PATH, safeSelection)).resolves.toEqual(safeInspection);
    expect(runner.get).toHaveBeenCalledWith(FILE_PATH, PARAGRAPH_PATH);
  });

  it('normalizes an OfficeCLI preview index path to the canonical paragraph id', async () => {
    const previewSelection = { ...safeSelection, path: '/body/p[1]' };

    await expect(inspectDocxSelection(runner, FILE_PATH, previewSelection)).resolves.toMatchObject({
      path: PARAGRAPH_PATH,
    });
    expect(runner.get).toHaveBeenCalledWith(FILE_PATH, '/body/p[1]');
  });

  it('accepts uniform effective formatting when only diagnostic sources differ', async () => {
    const selection: DocxSelectionSnapshot = {
      ...safeSelection,
      selectedText: 'Quarterly revenue',
      start: 0,
    };
    const paragraph = {
      ...safeParagraph,
      children: [
        {
          ...safeParagraph.children[0],
          format: {
            'effective.bold': true,
            'effective.bold.src': '/styles/Heading1',
            'effective.italic': false,
            'effective.underline': 'none',
          },
        },
        {
          ...safeParagraph.children[1],
          format: {
            'effective.underline': 'none',
            'effective.italic': false,
            'effective.bold.src': '/docDefaults',
            'effective.bold': true,
          },
        },
        safeParagraph.children[2],
      ],
    };
    runner.get.mockResolvedValue(getEnvelope(paragraph));

    const inspection = await inspectDocxSelection(runner, FILE_PATH, selection);

    expect(inspection.formatting).toEqual({ bold: true, italic: false, underline: false });
  });

  it('rejects duplicate selected text', async () => {
    const text = 'revenue and revenue';
    const selection: DocxSelectionSnapshot = {
      ...safeSelection,
      paragraphText: text,
      start: 0,
      end: 7,
    };
    runner.get.mockResolvedValue(
      getEnvelope({
        ...safeParagraph,
        text,
        children: [{ ...safeParagraph.children[1], text, format: { bold: true } }],
      })
    );

    await expect(inspectDocxSelection(runner, FILE_PATH, selection)).rejects.toMatchObject({
      code: 'AMBIGUOUS_TEXT',
    });
  });

  it('rejects a selection spanning differently formatted runs', async () => {
    const selection: DocxSelectionSnapshot = {
      ...safeSelection,
      selectedText: 'Quarterly revenue',
      start: 0,
    };
    const paragraph = {
      ...safeParagraph,
      children: [
        safeParagraph.children[0],
        { ...safeParagraph.children[1], format: { bold: false } },
        safeParagraph.children[2],
      ],
    };
    runner.get.mockResolvedValue(getEnvelope(paragraph));

    await expect(inspectDocxSelection(runner, FILE_PATH, selection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
  });

  it('rejects a paragraph containing a hyperlink child', async () => {
    runner.get.mockResolvedValue(
      getEnvelope({
        ...safeParagraph,
        children: [
          {
            path: `${PARAGRAPH_PATH}/hyperlink[1]`,
            type: 'hyperlink',
            text: safeParagraph.text,
            format: {},
            children: [safeParagraph.children[1]],
          },
        ],
      })
    );

    await expect(inspectDocxSelection(runner, FILE_PATH, safeSelection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
  });

  it('rejects nested content inside a direct run', async () => {
    const paragraph = {
      ...safeParagraph,
      children: safeParagraph.children.map((run, index) =>
        index === 1 ? { ...run, children: [{ type: 'break' }] } : run
      ),
    };
    runner.get.mockResolvedValue(getEnvelope(paragraph));

    await expect(inspectDocxSelection(runner, FILE_PATH, safeSelection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
  });

  it('rejects stale canonical paragraph text', async () => {
    runner.get.mockResolvedValue(getEnvelope({ ...safeParagraph, text: 'Quarterly revenue fell' }));

    await expect(inspectDocxSelection(runner, FILE_PATH, safeSelection)).rejects.toMatchObject({
      code: 'STALE_SELECTION',
    });
  });

  it.each([
    ['empty text', { selectedText: '' }],
    ['negative start', { start: -1 }],
    ['fractional start', { start: 10.5 }],
    ['empty range', { end: 10 }],
    ['end after paragraph', { end: safeParagraph.text.length + 1 }],
    ['text outside range', { selectedText: 'revenue grew' }],
  ])('rejects malformed offsets for %s', async (_name, patch) => {
    const selection: DocxSelectionSnapshot = { ...safeSelection, ...patch };

    await expect(inspectDocxSelection(runner, FILE_PATH, selection)).rejects.toMatchObject({
      code: 'STALE_SELECTION',
    });
  });

  it('rejects a cross-paragraph path', async () => {
    const selection: DocxSelectionSnapshot = {
      ...safeSelection,
      path: `${PARAGRAPH_PATH}/r[2]`,
    };

    await expect(inspectDocxSelection(runner, FILE_PATH, selection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
    expect(runner.get).not.toHaveBeenCalled();
  });

  it.each(['r"foo"', "r'foo'"])('rejects literal %s text that OfficeCLI would interpret as a regex', async (text) => {
    const paragraphText = `Prefix ${text} suffix`;
    const selection: DocxSelectionSnapshot = {
      ...safeSelection,
      paragraphText,
      selectedText: text,
      start: 7,
      end: 7 + text.length,
    };

    await expect(inspectDocxSelection(runner, FILE_PATH, selection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
    expect(runner.get).not.toHaveBeenCalled();
    expect(runner.replaceText).not.toHaveBeenCalled();
  });

  it('rejects malformed OfficeCLI results', async () => {
    runner.get.mockResolvedValue({ matches: 0, results: [] });

    await expect(inspectDocxSelection(runner, FILE_PATH, safeSelection)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
  });
});

describe('mutateDocxSelection', () => {
  it('uses find/replace and never range formatting for replacement', async () => {
    await mutateDocxSelection(runner, FILE_PATH, safeInspection, { kind: 'replaceText', value: 'sales' });

    expect(runner.replaceText).toHaveBeenCalledWith(FILE_PATH, PARAGRAPH_PATH, 'revenue', 'sales');
    expect(runner.formatRange).not.toHaveBeenCalled();
  });

  it('rejects a replacement unless OfficeCLI reports exactly one match', async () => {
    runner.replaceText.mockResolvedValue({ matched: 0 });

    await expect(
      mutateDocxSelection(runner, FILE_PATH, safeInspection, { kind: 'replaceText', value: 'sales' })
    ).rejects.toMatchObject({ code: 'OFFICECLI_FAILED' });
  });

  it.each(['bold', 'italic', 'underline'] as const)('formats only the allowlisted %s property', async (property) => {
    await mutateDocxSelection(runner, FILE_PATH, safeInspection, {
      kind: 'formatText',
      property,
      enabled: true,
    });

    expect(runner.formatRange).toHaveBeenCalledWith(FILE_PATH, PARAGRAPH_PATH, 10, 17, property, true);
    expect(runner.replaceText).not.toHaveBeenCalled();
  });

  it('rejects an Excel edit', async () => {
    await expect(
      mutateDocxSelection(runner, FILE_PATH, safeInspection, { kind: 'setCell', input: '42' })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
    expect(runner.setCell).not.toHaveBeenCalled();
  });

  it('rejects a forged formatting property', async () => {
    const edit = {
      kind: 'formatText',
      property: 'color',
      enabled: true,
    } as unknown as OfficeArtifactEdit;

    await expect(mutateDocxSelection(runner, FILE_PATH, safeInspection, edit)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
    });
    expect(runner.formatRange).not.toHaveBeenCalled();
  });

  it('rejects an inspection that is not for Word', async () => {
    const excelInspection: OfficeArtifactExcelInspection = {
      kind: 'excel',
      range: 'Sheet1!A1',
      cells: [{ path: '/worksheets/sheet[1]/cell[A1]', displayText: '42', input: '42' }],
      canEdit: true,
    };

    await expect(
      mutateDocxSelection(runner, FILE_PATH, excelInspection, { kind: 'replaceText', value: 'sales' })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
    expect(runner.replaceText).not.toHaveBeenCalled();
  });
});
