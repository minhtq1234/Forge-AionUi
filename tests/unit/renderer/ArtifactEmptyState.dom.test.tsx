import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@icon-park/react', () => ({ FileText: () => <span aria-hidden='true' /> }));
import ArtifactEmptyState from '@/renderer/pages/conversation/Preview/components/ArtifactEmptyState';

describe('ArtifactEmptyState', () => {
  it('renders the empty title and hint', () => {
    render(<ArtifactEmptyState />);
    expect(screen.getByText('conversation.artifact.emptyTitle')).toBeInTheDocument();
    expect(screen.getByText('conversation.artifact.emptyHint')).toBeInTheDocument();
  });
});
