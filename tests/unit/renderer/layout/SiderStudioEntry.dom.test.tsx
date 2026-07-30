import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lifecycle: [] as string[],
  blurActiveElement: vi.fn(() => mocks.lifecycle.push('blur')),
  closePreview: vi.fn(() => mocks.lifecycle.push('preview')),
  cleanupSiderTooltips: vi.fn(() => mocks.lifecycle.push('tooltips')),
  isElectronDesktop: vi.fn(() => true),
  navigate: vi.fn(() => mocks.lifecycle.push('navigate')),
  onSessionClick: vi.fn(() => mocks.lifecycle.push('session')),
}));

let currentPathname = '/guid';
let isMobile = false;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: currentPathname, search: '', hash: '' }),
  useNavigate: () => mocks.navigate,
}));

vi.mock('@renderer/utils/platform', () => ({
  isElectronDesktop: mocks.isElectronDesktop,
}));

vi.mock('@renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: mocks.cleanupSiderTooltips,
  getSiderTooltipProps: () => ({}),
}));

vi.mock('@renderer/utils/ui/focus', () => ({
  blurActiveElement: mocks.blurActiveElement,
}));

vi.mock('@renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: mocks.closePreview }),
}));

vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), status: 'authenticated' }),
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile }),
}));

vi.mock('@renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@renderer/pages/conversation/GroupedHistory', () => ({
  default: ({ batchMode, onBatchModeChange }: { batchMode: boolean; onBatchModeChange: (value: boolean) => void }) => (
    <>
      <span>{batchMode ? 'batch mode enabled' : 'batch mode disabled'}</span>
      <button type='button' onClick={() => onBatchModeChange(true)}>
        Enable batch mode
      </button>
    </>
  ),
}));

vi.mock('@renderer/pages/settings/components/SettingsSider', () => ({
  default: () => null,
}));

vi.mock('@/renderer/components/layout/Sider/SiderFooter', () => ({
  default: () => null,
}));

vi.mock('@/renderer/components/layout/Sider/TeamSiderSection', () => ({
  default: () => null,
}));

import Sider from '@/renderer/components/layout/Sider';
import SiderStudioEntry from '@/renderer/components/layout/Sider/SiderNav/SiderStudioEntry';

const studioNavKey = 'conversation.creativeStudio.nav.title';

const renderStudioEntry = (overrides: Partial<React.ComponentProps<typeof SiderStudioEntry>> = {}) => {
  return render(
    <SiderStudioEntry
      collapsed={false}
      isActive={false}
      isMobile={false}
      onClick={vi.fn()}
      siderTooltipProps={{}}
      {...overrides}
    />
  );
};

describe('SiderStudioEntry', () => {
  beforeEach(() => {
    currentPathname = '/guid';
    isMobile = false;
    mocks.lifecycle.length = 0;
    mocks.blurActiveElement.mockClear();
    mocks.closePreview.mockClear();
    mocks.cleanupSiderTooltips.mockClear();
    mocks.isElectronDesktop.mockReturnValue(true);
    mocks.navigate.mockClear();
    mocks.onSessionClick.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the translated Studio label as an accessible expanded navigation control', () => {
    renderStudioEntry();

    expect(screen.getByRole('button', { name: studioNavKey })).toBeInTheDocument();
  });

  it('keeps an accessible name when collapsed', () => {
    renderStudioEntry({ collapsed: true });

    expect(screen.getByRole('button', { name: studioNavKey })).toBeInTheDocument();
  });

  it.each(['/studio', '/studio/project_1'])('marks the Studio control current for %s', (pathname) => {
    currentPathname = pathname;
    render(<Sider onSessionClick={mocks.onSessionClick} />);

    expect(screen.getByRole('button', { name: studioNavKey })).toHaveAttribute('aria-current', 'page');
  });

  it('navigates to Studio after closing active sidebar UI state', () => {
    render(<Sider onSessionClick={mocks.onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Enable batch mode' }));
    expect(screen.getByText('batch mode enabled')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: studioNavKey }));

    expect(mocks.cleanupSiderTooltips).toHaveBeenCalledOnce();
    expect(mocks.blurActiveElement).toHaveBeenCalledOnce();
    expect(mocks.closePreview).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith('/studio');
    expect(mocks.onSessionClick).toHaveBeenCalledOnce();
    expect(screen.getByText('batch mode disabled')).toBeInTheDocument();
    expect(mocks.lifecycle).toEqual(['tooltips', 'blur', 'preview', 'navigate', 'session']);
  });

  it('uses the same session-closing lifecycle in the Electron mobile sidebar', () => {
    isMobile = true;
    render(<Sider onSessionClick={mocks.onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: studioNavKey }));

    expect(mocks.onSessionClick).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith('/studio');
  });

  it('is absent outside Electron', () => {
    mocks.isElectronDesktop.mockReturnValue(false);
    renderStudioEntry();

    expect(screen.queryByRole('button', { name: studioNavKey })).not.toBeInTheDocument();
  });
});
