/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import WebviewHost from '@/renderer/components/media/WebviewHost';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeJavaScript: vi.fn(),
  setZoomFactor: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'preview.office.viewer.zoomOut': 'Zoom out',
        'preview.office.viewer.zoomIn': 'Zoom in',
        'preview.office.viewer.resetZoom': 'Reset zoom',
        'preview.office.viewer.fitWidth': 'Fit to width',
      })[key] ?? key,
  }),
}));

describe('WebviewHost Office viewer controls', () => {
  beforeEach(() => {
    mocks.executeJavaScript.mockReset();
    mocks.executeJavaScript.mockImplementation((script: string) =>
      Promise.resolve(script.includes('scrollWidth') ? { width: 500 } : true)
    );
    mocks.setZoomFactor.mockReset();
    Object.defineProperties(HTMLElement.prototype, {
      executeJavaScript: { configurable: true, value: mocks.executeJavaScript },
      setZoomFactor: { configurable: true, value: mocks.setZoomFactor },
      reload: { configurable: true, value: vi.fn() },
    });
  });

  afterEach(() => {
    cleanup();
    delete (HTMLElement.prototype as Partial<Electron.WebviewTag>).executeJavaScript;
    delete (HTMLElement.prototype as Partial<Electron.WebviewTag>).setZoomFactor;
    delete (HTMLElement.prototype as Partial<Electron.WebviewTag>).reload;
  });

  const prepareWebview = async () => {
    const webview = document.querySelector('webview');
    if (!webview) throw new Error('webview was not rendered');
    Object.defineProperty(webview.parentElement, 'clientWidth', { configurable: true, value: 400 });
    await act(async () => {
      fireEvent(webview, new Event('dom-ready'));
      fireEvent(webview, new Event('did-finish-load'));
      await Promise.resolve();
    });
  };

  it('keeps viewer controls hidden until the guest finishes loading', async () => {
    render(<WebviewHost url='http://127.0.0.1:26318/' showViewerControls />);

    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fit to width' })).not.toBeInTheDocument();

    await prepareWebview();

    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Fit to width' })).toBeEnabled();
  });

  it('offers clamped zoom, reset, and fit controls for Office previews', async () => {
    render(<WebviewHost url='http://127.0.0.1:26318/' showViewerControls />);
    await prepareWebview();

    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const reset = screen.getByRole('button', { name: 'Reset zoom' });
    const fit = screen.getByRole('button', { name: 'Fit to width' });

    expect(reset).toHaveTextContent('100%');
    fireEvent.click(zoomIn);
    expect(reset).toHaveTextContent('110%');
    fireEvent.click(zoomOut);
    expect(reset).toHaveTextContent('100%');

    for (let index = 0; index < 10; index += 1) fireEvent.click(zoomOut);
    expect(reset).toHaveTextContent('75%');
    for (let index = 0; index < 20; index += 1) fireEvent.click(zoomIn);
    expect(reset).toHaveTextContent('150%');

    fireEvent.click(reset);
    expect(reset).toHaveTextContent('100%');
    fireEvent.click(fit);
    await waitFor(() => expect(reset).toHaveTextContent('80%'));
    expect(mocks.setZoomFactor).toHaveBeenCalledWith(0.8);
  });

  it('keeps the zoom overlay hidden for ordinary embedded webviews', () => {
    render(<WebviewHost url='https://example.com/' />);

    expect(screen.queryByRole('button', { name: 'Zoom out' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fit to width' })).not.toBeInTheDocument();
  });

  it('normalizes fit-to-width measurements taken from a zoomed guest viewport', async () => {
    render(<WebviewHost url='http://127.0.0.1:26318/' showViewerControls />);
    await prepareWebview();
    const reset = screen.getByRole('button', { name: 'Reset zoom' });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(reset).toHaveTextContent('110%');
    mocks.executeJavaScript.mockImplementation((script: string) =>
      Promise.resolve(script.includes('scrollWidth') ? { width: 400 / 1.1 } : true)
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fit to width' }));

    await waitFor(() => expect(reset).toHaveTextContent('100%'));
  });
});
