import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import SiderFooter from '@/renderer/components/layout/Sider/SiderFooter';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const values: Record<string, string> = {
        'common.back': 'Back',
        'common.settings': 'Settings',
        'settings.darkMode': 'Dark mode',
        'settings.lightMode': 'Light mode',
      };
      return values[key] ?? key;
    },
  }),
}));

describe('SiderFooter', () => {
  it('shows only utility actions without a user profile', () => {
    const onSettingsClick = vi.fn();

    render(
      <SiderFooter
        isMobile={false}
        isSettings={false}
        theme='light'
        siderTooltipProps={{}}
        onSettingsClick={onSettingsClick}
        onThemeToggle={vi.fn()}
      />
    );

    expect(screen.queryByText('NL')).not.toBeInTheDocument();
    expect(screen.queryByText('Nhung Le')).not.toBeInTheDocument();
    expect(screen.queryByText('Free plan')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSettingsClick).toHaveBeenCalledTimes(1);
  });
});
