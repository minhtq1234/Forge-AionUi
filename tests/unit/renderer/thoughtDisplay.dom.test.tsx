/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('ThoughtDisplay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a calm thinking state before a live activity is available', () => {
    render(<ThoughtDisplay running />);

    const display = screen.getByTestId('thought-display');
    expect(display).toHaveClass('thought-display');
    expect(display).toHaveClass('thought-display--running');
    expect(display).not.toHaveClass('mb--20px');
    expect(display).not.toHaveClass('pb-30px');
    expect(display).not.toHaveClass('rd-t-20px');
    expect(screen.getByText('conversation.thinking.label')).toBeInTheDocument();
    expect(screen.getByTestId('thought-display-dots')).toBeInTheDocument();
    expect(screen.queryByText('0s')).not.toBeInTheDocument();
  });

  it('narrates the live activity without a separate status tag', () => {
    render(<ThoughtDisplay running thought={{ subject: 'Planning', description: 'Checking files' }} />);

    const display = screen.getByTestId('thought-display');
    expect(display).toHaveClass('thought-display');
    expect(display).toHaveClass('thought-display--running');
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Checking files')).toBeInTheDocument();
    expect(display.querySelector('.arco-tag')).not.toBeInTheDocument();
    expect(screen.queryByTestId('thought-display-dots')).not.toBeInTheDocument();
  });

  it('shows elapsed time only after the activity has been running for a few seconds', () => {
    vi.useFakeTimers();
    render(<ThoughtDisplay running />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByText('5s')).toBeInTheDocument();
  });
});
