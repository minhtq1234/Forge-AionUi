/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const LIGHT_THEME_ID = 'forge-light';
export const DARK_THEME_ID = 'forge-dark';
/** Sentinel id stored in `theme.activeId`: resolve to Light/Dark from the OS appearance. */
export const SYSTEM_THEME_ID = 'system';

/**
 * Legacy built-in theme ids (pre-Forge rebrand) → current ids. Keeps persisted
 * `theme.activeId` values from older installs resolving to the right appearance.
 */
export const LEGACY_THEME_ID_ALIASES: Readonly<Record<string, string>> = {
  light: LIGHT_THEME_ID,
  dark: DARK_THEME_ID,
};
