/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import WorkspaceToolbar from '@/renderer/pages/conversation/Workspace/components/WorkspaceToolbar';

vi.mock('@/renderer/pages/conversation/components/ChatLayout/WorkspaceOpenButton', () => ({
  default: () => <div data-testid='workspace-open-button' />,
}));

vi.mock('@icon-park/react', () => ({
  Down: () => <span />,
  Plus: () => <span />,
  Refresh: () => <span />,
  Search: () => <span />,
}));

vi.mock('@arco-design/web-react', () => {
  const Menu = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  Menu.Item = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Dropdown: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Input: ({ placeholder }: { placeholder?: string }) => <input aria-label={placeholder} />,
    Menu,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));

vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

describe('WorkspaceToolbar', () => {
  it('keeps file search and the project-folder action in the same top row', () => {
    render(
      <WorkspaceToolbar
        t={(key: string) => (key === 'conversation.workspace.searchPlaceholder' ? 'Search files...' : key)}
        isWorkspaceCollapsed={false}
        setIsWorkspaceCollapsed={vi.fn()}
        workspaceDisplayName='forge-test'
        showSearch
        searchText=''
        setSearchText={vi.fn()}
        onSearch={vi.fn()}
        searchInputRef={{ current: null }}
        loading={false}
        refreshWorkspace={vi.fn()}
        handleSelectHostFiles={vi.fn()}
        handleUploadDeviceFiles={vi.fn()}
        setShowHostFileSelector={vi.fn()}
        workspacePath='/workspace/forge-test'
        isTemporaryWorkspace={false}
      />
    );

    const topRow = screen.getByTestId('workspace-toolbar-top-row');
    expect(within(topRow).getByRole('textbox', { name: 'Search files...' })).toBeInTheDocument();
    expect(within(topRow).getByTestId('workspace-open-button')).toBeInTheDocument();
  });
});
