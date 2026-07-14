/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import {
  buildOfficeGuestScript,
  parseOfficeGuestMessage,
} from '@/renderer/pages/conversation/Preview/components/ArtifactEditor/officeGuestBridge';

const MESSAGE_PREFIX = '__FORGE_OFFICE_SELECTION__';
const LOOPBACK_SOURCE = 'http://127.0.0.1:18791/app.js';
const PARAGRAPH_PATH = '/body/p[@paraId=00100000]';

type WordPayload = {
  kind: 'word';
  path: string;
  paragraphText: string;
  selectedText: string;
  start: number;
  end: number;
};

type ExcelPayload = {
  kind: 'excel';
  paths: string[];
  cells: Array<{ path: string; displayText: string }>;
  editRequested?: true;
};

function wordPayload(patch: Partial<WordPayload> = {}): WordPayload {
  return {
    kind: 'word',
    path: PARAGRAPH_PATH,
    paragraphText: 'Quarterly revenue grew',
    selectedText: 'revenue',
    start: 10,
    end: 17,
    ...patch,
  };
}

function excelPayload(paths = ['/Forecast/B4'], displayTexts = ['84']): ExcelPayload {
  return {
    kind: 'excel',
    paths,
    cells: paths.map((path, index) => ({ path, displayText: displayTexts[index] ?? '' })),
  };
}

function guestMessage(payload: unknown): string {
  return `${MESSAGE_PREFIX}${JSON.stringify(payload)}`;
}

function loggedMessages(log: ReturnType<typeof vi.spyOn>): string[] {
  return log.mock.calls.map(([message]) => String(message));
}

function installOfficeCliClickSelection(dom: JSDOM): void {
  const { document, Element } = dom.window;
  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const cell = event.target.closest('td[data-path]');
      if (!cell) return;
      document
        .querySelectorAll('td.officecli-sel-range, td.officecli-selected')
        .forEach((selected) => selected.classList.remove('officecli-sel-range', 'officecli-selected'));
      cell.classList.add('officecli-sel-range');
    },
    true
  );
}

describe('parseOfficeGuestMessage', () => {
  it('accepts an exact Word selection from an IPv4 loopback preview', () => {
    const payload = wordPayload();

    expect(parseOfficeGuestMessage(guestMessage(payload), LOOPBACK_SOURCE)).toEqual(payload);
  });

  it('accepts the positional paragraph locator emitted by OfficeCLI preview', () => {
    const payload = wordPayload({ path: '/body/p[1]' });

    expect(parseOfficeGuestMessage(guestMessage(payload), LOOPBACK_SOURCE)).toEqual(payload);
  });

  it.each(['http://localhost:18791/', 'https://[::1]:18791/app.js'])('accepts the loopback source %s', (source) => {
    const payload = excelPayload();

    expect(parseOfficeGuestMessage(guestMessage(payload), source)).toEqual(payload);
  });

  it.each([
    'https://remote.example/app.js',
    'http://localhost.example.com/app.js',
    'ws://127.0.0.1:18791/live',
    'file:///tmp/preview.html',
    'not-a-url',
  ])('rejects the non-preview source %s', (source) => {
    expect(parseOfficeGuestMessage(guestMessage(wordPayload()), source)).toBeNull();
  });

  it('rejects malformed and oversized console messages', () => {
    expect(parseOfficeGuestMessage(`${MESSAGE_PREFIX}not-json`, LOOPBACK_SOURCE)).toBeNull();
    expect(parseOfficeGuestMessage(`${MESSAGE_PREFIX}${'x'.repeat(65_537)}`, LOOPBACK_SOURCE)).toBeNull();
  });

  it('measures the 64 KiB limit as UTF-8 bytes', () => {
    const payload = excelPayload(['/Forecast/B4'], ['界'.repeat(30_000)]);

    expect(parseOfficeGuestMessage(guestMessage(payload), LOOPBACK_SOURCE)).toBeNull();
  });

  it.each([
    ['an extra key', { ...wordPayload(), extra: true }],
    ['an invalid positional path', wordPayload({ path: '/body/p[0]' })],
    ['a negative offset', wordPayload({ start: -1 })],
    ['a fractional offset', wordPayload({ start: 10.5 })],
    ['an empty range', wordPayload({ end: 10, selectedText: '' })],
    ['text outside the range', wordPayload({ selectedText: 'revenue grew' })],
  ])('rejects a Word payload with %s', (_case, payload) => {
    expect(parseOfficeGuestMessage(guestMessage(payload), LOOPBACK_SOURCE)).toBeNull();
  });

  it('accepts the literal Excel edit request emitted by double-click', () => {
    const payload = { ...excelPayload(), editRequested: true } as const;

    expect(parseOfficeGuestMessage(guestMessage(payload), LOOPBACK_SOURCE)).toEqual(payload);
  });

  it.each([
    ['no selected cells', excelPayload([])],
    ['an extra key', { ...excelPayload(), extra: true }],
    ['a false edit request', { ...excelPayload(), editRequested: false }],
    ['a range path', excelPayload(['/Forecast/B4:C5'])],
    ['a lowercase column', excelPayload(['/Forecast/b4'])],
    [
      'a mismatched cell path',
      { ...excelPayload(['/Forecast/B4']), cells: [{ path: '/Forecast/C4', displayText: '84' }] },
    ],
    ['duplicate paths', excelPayload(['/Forecast/B4', '/Forecast/B4'], ['84', '84'])],
    ['an extra cell key', { ...excelPayload(), cells: [{ path: '/Forecast/B4', displayText: '84', input: '=A1*2' }] }],
  ])('rejects an Excel payload with %s', (_case, payload) => {
    expect(parseOfficeGuestMessage(guestMessage(payload), LOOPBACK_SOURCE)).toBeNull();
  });

  it('rejects more than 256 selected Excel cells', () => {
    const paths = Array.from({ length: 257 }, (_value, index) => `/Forecast/A${index + 1}`);

    expect(parseOfficeGuestMessage(guestMessage(excelPayload(paths)), LOOPBACK_SOURCE)).toBeNull();
  });
});

describe('buildOfficeGuestScript', () => {
  it('publishes paragraph-relative Word offsets and throttles duplicate selections', () => {
    const dom = new JSDOM(
      `<p data-path="${PARAGRAPH_PATH}"><span>Quarterly </span><strong>revenue</strong><span> grew</span></p>`,
      { runScripts: 'outside-only', url: LOOPBACK_SOURCE }
    );
    const log = vi.spyOn(dom.window.console, 'log').mockImplementation(() => undefined);

    try {
      dom.window.eval(buildOfficeGuestScript('word'));
      const selectedNode = dom.window.document.querySelector('strong')?.firstChild;
      if (!selectedNode) throw new Error('Word test selection node is missing');

      const range = dom.window.document.createRange();
      range.setStart(selectedNode, 0);
      range.setEnd(selectedNode, selectedNode.textContent?.length ?? 0);
      const selection = dom.window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      dom.window.document.dispatchEvent(new dom.window.Event('selectionchange'));
      dom.window.document.dispatchEvent(new dom.window.Event('selectionchange'));

      expect(log).toHaveBeenCalledTimes(1);
      expect(parseOfficeGuestMessage(loggedMessages(log)[0], LOOPBACK_SOURCE)).toEqual(wordPayload());
    } finally {
      dom.window.close();
    }
  });

  it('publishes the positional paragraph locator emitted by OfficeCLI preview', () => {
    const dom = new JSDOM('<p data-path="/body/p[1]">Draft text</p>', {
      runScripts: 'outside-only',
      url: LOOPBACK_SOURCE,
    });
    const log = vi.spyOn(dom.window.console, 'log').mockImplementation(() => undefined);

    try {
      dom.window.eval(buildOfficeGuestScript('word'));
      const paragraph = dom.window.document.querySelector('p');
      if (!paragraph) throw new Error('Word test paragraph is missing');
      const range = dom.window.document.createRange();
      range.selectNodeContents(paragraph);
      dom.window.getSelection()?.addRange(range);

      dom.window.document.dispatchEvent(new dom.window.Event('selectionchange'));

      expect(parseOfficeGuestMessage(loggedMessages(log)[0], LOOPBACK_SOURCE)).toEqual({
        kind: 'word',
        path: '/body/p[1]',
        paragraphText: 'Draft text',
        selectedText: 'Draft text',
        start: 0,
        end: 10,
      });
    } finally {
      dom.window.close();
    }
  });

  it('publishes Excel clicks once and converts double-click into an edit request', async () => {
    const dom = new JSDOM(
      '<table><tbody><tr><td data-path="/Forecast/B4"><span class="cell-text">84</span></td></tr></tbody></table>',
      { runScripts: 'outside-only', url: LOOPBACK_SOURCE }
    );
    installOfficeCliClickSelection(dom);
    const inlineEdit = vi.fn();
    dom.window.document.addEventListener('dblclick', inlineEdit, true);
    const log = vi.spyOn(dom.window.console, 'log').mockImplementation(() => undefined);

    try {
      dom.window.eval(buildOfficeGuestScript('excel'));
      const cell = dom.window.document.querySelector('td');
      if (!cell) throw new Error('Excel test cell is missing');

      cell.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
      cell.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      expect(log).toHaveBeenCalledTimes(1);

      const doubleClick = new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true });
      cell.dispatchEvent(doubleClick);

      expect(doubleClick.defaultPrevented).toBe(true);
      expect(inlineEdit).not.toHaveBeenCalled();
      expect(parseOfficeGuestMessage(loggedMessages(log).at(-1) ?? '', LOOPBACK_SOURCE)).toEqual({
        ...excelPayload(),
        editRequested: true,
      });
    } finally {
      dom.window.close();
    }
  });

  it('moves the active Excel cell by dispatching a click and publishing the adjacent selection', async () => {
    const dom = new JSDOM(
      '<table><tbody><tr><td data-path="/Forecast/B4">84</td><td data-path="/Forecast/C4">85</td></tr></tbody></table>',
      { runScripts: 'outside-only', url: LOOPBACK_SOURCE }
    );
    installOfficeCliClickSelection(dom);
    const log = vi.spyOn(dom.window.console, 'log').mockImplementation(() => undefined);

    try {
      dom.window.eval(buildOfficeGuestScript('excel'));
      const firstCell = dom.window.document.querySelector('td[data-path="/Forecast/B4"]');
      if (!firstCell) throw new Error('Excel test start cell is missing');
      firstCell.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));

      const moveSelection = (dom.window as unknown as { __forgeOfficeMoveSelection?: (direction: string) => boolean })
        .__forgeOfficeMoveSelection;
      expect(moveSelection).toBeTypeOf('function');
      expect(moveSelection?.('right')).toBe(true);
      await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2));

      expect(parseOfficeGuestMessage(loggedMessages(log).at(-1) ?? '', LOOPBACK_SOURCE)).toEqual(
        excelPayload(['/Forecast/C4'], ['85'])
      );
    } finally {
      dom.window.close();
    }
  });
});
