/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Theme } from './types';
import { LIGHT_THEME_ID, DARK_THEME_ID, SYSTEM_THEME_ID, LEGACY_THEME_ID_ALIASES } from './constants';

/**
 * Pure: caller supplies the full theme list (builtins + user). Falls back to Light, then first.
 * `system` resolves to the built-in Dark/Light theme via `prefersDark` (callers pass the
 * `prefers-color-scheme` media query result; this module must stay DOM-free).
 * Legacy built-in ids (`light`/`dark`) are remapped to the current Forge ids first.
 */
export function resolveActiveTheme(activeId: string, themes: Theme[], prefersDark?: boolean): Theme {
  const aliasedId = LEGACY_THEME_ID_ALIASES[activeId] ?? activeId;
  const targetId = aliasedId === SYSTEM_THEME_ID ? (prefersDark ? DARK_THEME_ID : LIGHT_THEME_ID) : aliasedId;
  return themes.find((t) => t.id === targetId) ?? themes.find((t) => t.id === LIGHT_THEME_ID) ?? themes[0];
}
