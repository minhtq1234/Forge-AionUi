/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as layoutContext from '@renderer/hooks/context/LayoutContext';

// Spy on the persistence helper while keeping the rest of LayoutContext real.
vi.mock('@renderer/hooks/context/LayoutContext', async (importActual) => {
  const actual = await importActual<typeof import('@renderer/hooks/context/LayoutContext')>();
  return { ...actual, persistSiderCollapsed: vi.fn((value: boolean) => actual.persistSiderCollapsed(value)) };
});

// A probe rendered through <Outlet/> that surfaces the collapse state and lets
// the test invoke the explicit collapse setter from context.
vi.mock('react-router-dom', async () => {
  const React_ = await import('react');
  const ctx = await import('@renderer/hooks/context/LayoutContext');
  const Probe = () => {
    const layout = ctx.useLayoutContext();
    return React_.createElement(
      'div',
      null,
      React_.createElement('span', { 'data-testid': 'collapsed' }, String(layout?.siderCollapsed)),
      React_.createElement(
        'button',
        { 'data-testid': 'explicit-collapse', onClick: () => layout?.setSiderCollapsed(true) },
        'collapse'
      )
    );
  };
  return {
    useLocation: () => ({ pathname: '/guid', search: '', hash: '' }),
    useNavigate: () => vi.fn(),
    Outlet: () => React_.createElement(Probe),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      logStream: { on: vi.fn(() => vi.fn()) },
      openDevTools: { invoke: vi.fn() },
    },
    task: { stopAll: { invoke: vi.fn() } },
  },
}));

vi.mock('@/common/config/constants', () => ({ TEAM_MODE_ENABLED: false }));
vi.mock('@renderer/assets/logos/brand/forge-mark.svg', () => ({ default: 'forge-mark.svg' }));
vi.mock('@/renderer/components/layout/Titlebar', () => ({ default: () => <div data-testid='titlebar' /> }));
vi.mock('@/renderer/components/layout/PwaPullToRefresh', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/UpdateModal', () => ({ default: () => null }));
vi.mock('@renderer/hooks/context/NavigationHistoryContext', () => ({
  NavigationHistoryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@renderer/hooks/system/useDeepLink', () => ({ useDeepLink: vi.fn() }));
vi.mock('@renderer/hooks/system/notification/useNotificationClick', () => ({ useNotificationClick: vi.fn() }));
vi.mock('@renderer/hooks/system/notification/useBrowserNotification', () => ({ useBrowserNotification: vi.fn() }));
vi.mock('@renderer/hooks/file/useDirectorySelection', () => ({
  useDirectorySelection: () => ({ contextHolder: null }),
}));
vi.mock('@renderer/hooks/ui/useConversationShortcuts', () => ({ useConversationShortcuts: vi.fn() }));
vi.mock('@renderer/utils/navigation', () => ({ setGlobalNavigate: vi.fn() }));
vi.mock('@renderer/utils/ui/siderTooltip', () => ({ cleanupSiderTooltips: vi.fn() }));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import Layout from '@/renderer/components/layout/Layout';

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
};

const persistSpy = vi.mocked(layoutContext.persistSiderCollapsed);

describe('Layout sider collapse persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    persistSpy.mockClear();
  });

  afterEach(() => cleanup());

  it('does NOT persist app-sider-collapsed when mobile force-collapses the sider', () => {
    setViewportWidth(500); // < 768 => mobile
    render(<Layout sider={<div>sider</div>} />);

    // The mobile force-collapse ran (collapse state is true)...
    expect(screen.getByTestId('collapsed').textContent).toBe('true');
    // ...but it must not write the persisted collapse preference.
    expect(persistSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('app-sider-collapsed')).toBeNull();
  });

  it('DOES persist an explicit desktop collapse toggle', () => {
    setViewportWidth(1280); // desktop
    render(<Layout sider={<div>sider</div>} />);

    expect(screen.getByTestId('collapsed').textContent).toBe('false');

    act(() => {
      fireEvent.click(screen.getByTestId('explicit-collapse'));
    });

    expect(persistSpy).toHaveBeenCalledWith(true);
    expect(localStorage.getItem('app-sider-collapsed')).toBe('1');
    expect(screen.getByTestId('collapsed').textContent).toBe('true');
  });
});
