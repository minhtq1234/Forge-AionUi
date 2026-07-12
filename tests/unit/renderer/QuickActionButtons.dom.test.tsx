import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import QuickActionButtons from '@/renderer/pages/guid/components/QuickActionButtons';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openHistory: vi.fn(),
  openLink: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const values: Record<string, string> = {
        'guid.toolbar.history': 'History',
        'guid.toolbar.saved': 'Saved',
        'guid.toolbar.community': 'Community',
      };
      return values[key] ?? key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({
  default: ({
    renderTrigger,
  }: {
    renderTrigger: (props: { onClick: () => void; isActive: boolean }) => React.ReactNode;
  }) => renderTrigger({ onClick: mocks.openHistory, isActive: false }),
}));

describe('QuickActionButtons', () => {
  it('renders a labeled top toolbar with working destinations', () => {
    render(<QuickActionButtons onOpenLink={mocks.openLink} />);

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Community' }));

    expect(mocks.openHistory).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/skills');
    expect(mocks.openLink).toHaveBeenCalledWith('https://github.com/iOfficeAI/AionUi');
  });
});
