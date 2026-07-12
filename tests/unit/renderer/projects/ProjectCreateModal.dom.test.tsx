/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_STORAGE_KEY } from '@/renderer/pages/conversation/projects/projectStorage';
import { ProjectCreateModal } from '@/renderer/pages/conversation/projects/ProjectCreateModal';

const showOpenMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: {
      showOpen: {
        invoke: (...args: unknown[]) => showOpenMock(...args),
      },
    },
  },
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'conversation.history.projectDuplicateFolder') {
        return `This folder is already used by "${params?.name}".`;
      }
      return key;
    },
  }),
}));

describe('ProjectCreateModal', () => {
  beforeEach(() => {
    localStorage.clear();
    showOpenMock.mockReset();
  });

  const getCreateButton = () => screen.getByRole('button', { name: 'conversation.history.createProject' });

  it('keeps Create disabled until a folder is selected', () => {
    const onCreated = vi.fn();
    render(<ProjectCreateModal visible onCancel={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('conversation.history.projectNameLabel'), {
      target: { value: 'Finance Close' },
    });

    expect(screen.getByPlaceholderText('conversation.history.projectFolderPlaceholder')).toBeInTheDocument();
    expect(getCreateButton()).toBeDisabled();
    expect(getCreateButton()).toHaveClass('arco-btn-secondary');
    expect(screen.queryByText('conversation.history.projectFolderRequired')).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('explains when the selected folder already belongs to another Project', () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'project-finance-close',
          name: 'Finance Close',
          workspace: '/Users/me/Finance Close',
          created_at: 1000,
          updated_at: 1000,
        },
      ])
    );

    render(
      <ProjectCreateModal visible initialWorkspace='/Users/me/Finance Close' onCancel={vi.fn()} onCreated={vi.fn()} />
    );

    expect(screen.getByText('This folder is already used by "Finance Close".')).toBeInTheDocument();
    expect(getCreateButton()).toBeDisabled();
    expect(getCreateButton()).toHaveClass('arco-btn-secondary');
  });

  it('creates a Project from a selected folder', async () => {
    showOpenMock.mockResolvedValue(['/Users/me/Finance Close']);
    const onCreated = vi.fn();
    render(<ProjectCreateModal visible onCancel={vi.fn()} onCreated={onCreated} />);

    fireEvent.click(screen.getByText('conversation.history.chooseProjectFolder'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('/Users/me/Finance Close')).toBeInTheDocument();
    });
    expect(screen.queryByText('/Users/me/Finance Close')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('conversation.history.createProject'));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Finance Close',
          workspace: '/Users/me/Finance Close',
        })
      );
    });
  });
});
