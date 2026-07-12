/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCodeEditorConfig } from './codeEditorConfig';

export type EditorThemeMode = 'light' | 'dark';

/**
 * Build the font/appearance extension from the central code editor config.
 * @returns A CodeMirror Extension with font family, size, line height, and gutter styling
 */
export const codeEditorFontTheme = (): Extension => {
  const cfg = getCodeEditorConfig();
  return EditorView.theme({
    '&': { fontSize: cfg.fontSize },
    '.cm-content': { fontFamily: cfg.fontFamily, lineHeight: cfg.lineHeight },
    '.cm-gutters': { fontFamily: cfg.fontFamily },
  });
};

/**
 * Surface colors follow the active theme's semantic "document" tokens
 * (var(--bg-document)/var(--bg-document-muted)) so every source editor reads as a
 * white page inside the warm cream chrome, in both light and dark mode. The
 * light/dark base theme still drives syntax-highlight colors via the `theme` prop
 * (keyed on appearance).
 * Wrap in `Prec.highest(...)` at the call site so it beats the built-in theme background.
 */
export const codeEditorSurfaceTheme = (): Extension =>
  EditorView.theme({
    '&': { backgroundColor: 'var(--bg-document)' },
    '.cm-gutters': { backgroundColor: 'var(--bg-document)', borderRight: '1px solid var(--border-light)' },
    '.cm-activeLine': { backgroundColor: 'var(--bg-document-muted)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--bg-document-muted)' },
  });

/**
 * Map app theme mode to the base CodeMirror theme identifier.
 * This is the seam for future custom color schemes; currently maps light/dark to built-in themes.
 * @param mode - The app's light or dark theme mode
 * @returns The CodeMirror theme identifier
 */
export const getCodeEditorBaseTheme = (mode: EditorThemeMode): 'light' | 'dark' => mode;
