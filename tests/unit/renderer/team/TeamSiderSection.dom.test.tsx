import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamSiderSection from '@/renderer/components/layout/Sider/TeamSiderSection';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  removeTeam: vi.fn(),
  teams: [] as Array<{ id: string; name: string }>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const values: Record<string, string> = {
        'team.sider.createTeam': 'New Team',
        'team.sider.title': 'Teams',
      };
      return values[key] ?? key;
    },
  }),
}));

vi.mock('@/renderer/pages/team/hooks/useTeamList', () => ({
  useTeamList: () => ({
    teams: mocks.teams,
    mutate: mocks.mutate,
    removeTeam: mocks.removeTeam,
  }),
}));

vi.mock('@/renderer/pages/team/hooks/useSiderTeamBadges', () => ({
  useSiderTeamBadges: () => new Map<string, number>(),
}));

vi.mock('@/renderer/pages/team/components/TeamCreateModal', () => ({
  default: (_props: { visible: boolean; onClose: () => void; onCreated: (team: { id: string }) => void }) => null,
}));

describe('TeamSiderSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.teams = [];
    localStorage.clear();
  });

  it('shows the number of teams in the collapsible section header', () => {
    mocks.teams = [
      { id: 'team-a', name: 'aaa' },
      { id: 'team-report', name: 'report' },
    ];

    render(
      <MemoryRouter>
        <TeamSiderSection collapsed={false} pathname='/' siderTooltipProps={{}} />
      </MemoryRouter>
    );

    expect(screen.getByText('Teams')).toBeInTheDocument();
    const teamLabel = screen.getByText('Teams');
    const teamCount = screen.getByText('2');
    expect(teamCount.compareDocumentPosition(teamLabel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('uses the neutral sidebar action color for the Teams create button', () => {
    render(
      <MemoryRouter>
        <TeamSiderSection collapsed={false} pathname='/' siderTooltipProps={{}} />
      </MemoryRouter>
    );

    const createButton = screen.getByTestId('team-create-btn');

    expect(createButton).toHaveClass('sider-section-add-action');
    expect(createButton).toHaveClass('!w-22px');
    expect(createButton).toHaveClass('!text-t-secondary');
    expect(createButton).toHaveClass('hover:!text-t-primary');
    expect(createButton).not.toHaveClass('text-primary');
  });
});
