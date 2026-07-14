/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { useResizableSplit } from '@/renderer/hooks/ui/useResizableSplit';

export interface LayoutContextValue {
  isMobile: boolean;
  siderCollapsed: boolean;
  setSiderCollapsed: (value: boolean) => void;
}

export const LayoutContext = React.createContext<LayoutContextValue | null>(null);

export function useLayoutContext(): LayoutContextValue | null {
  return React.useContext(LayoutContext);
}

export const SIDER_DEFAULT_WIDTH = 260;
export const SIDER_MIN_WIDTH = 200;
export const SIDER_MAX_WIDTH = 420;
export const SIDER_WIDTH_STORAGE_KEY = 'app-sider-width-px';
export const SIDER_COLLAPSED_STORAGE_KEY = 'app-sider-collapsed';

/**
 * Draggable-width state for the app Sider, persisted across sessions.
 * Collapse is a separate, explicit concern (see readPersistedSiderCollapsed /
 * persistSiderCollapsed) and is intentionally not derived from this hook.
 */
export const useSiderWidth = () => {
  const { splitRatio, setSplitRatio, createDragHandle } = useResizableSplit({
    unit: 'px',
    defaultWidth: SIDER_DEFAULT_WIDTH,
    minWidth: SIDER_MIN_WIDTH,
    maxWidth: SIDER_MAX_WIDTH,
    storageKey: SIDER_WIDTH_STORAGE_KEY,
  });
  return { width: splitRatio, setWidth: setSplitRatio, createDragHandle };
};

/** Read the persisted Sider collapsed flag (defaults to false when unset or unavailable). */
export const readPersistedSiderCollapsed = (): boolean => {
  try {
    return localStorage.getItem(SIDER_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

/** Persist the Sider collapsed flag; silently ignores storage failures (e.g. private mode). */
export const persistSiderCollapsed = (value: boolean): void => {
  try {
    localStorage.setItem(SIDER_COLLAPSED_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // ignore persistence errors
  }
};
