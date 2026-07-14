/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const PROJECTS_CHANGED_EVENT = 'forge:projects-changed';

export const dispatchProjectsChanged = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED_EVENT));
};
