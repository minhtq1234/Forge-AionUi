/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import WorkspaceProjectMenu from '@/renderer/pages/conversation/Workspace/components/WorkspaceProjectMenu';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button type='button' onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@icon-park/react', () => ({
  BranchOne: () => <span />,
  Down: () => <span />,
  FolderOpen: () => <span />,
  Right: () => <span />,
}));

const t = (key: string) => key;

describe('WorkspaceProjectMenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders only the active files panel and marks the Files item as selected', () => {
    render(
      <WorkspaceProjectMenu
        t={t}
        open
        activePanel='files'
        changeCount={3}
        onToggle={vi.fn()}
        onSelectPanel={vi.fn()}
        filesPanel={<div>files panel</div>}
        changesPanel={<div>changes panel</div>}
      />
    );

    expect(screen.getByText('files panel')).toBeInTheDocument();
    expect(screen.queryByText('changes panel')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'conversation.workspace.changes.filesTab' })).toHaveClass(
      'workspace-project-menu-item-active'
    );
  });

  it('selects the Changes panel and shows its change count', () => {
    const onSelectPanel = vi.fn();

    render(
      <WorkspaceProjectMenu
        t={t}
        open
        activePanel='files'
        changeCount={3}
        onToggle={vi.fn()}
        onSelectPanel={onSelectPanel}
        filesPanel={<div>files panel</div>}
        changesPanel={<div>changes panel</div>}
      />
    );

    const changesButton = screen.getByRole('menuitem', { name: /conversation\.workspace\.changes\.tab.*3/ });
    fireEvent.click(changesButton);

    expect(onSelectPanel).toHaveBeenCalledWith('changes');
  });

  it('closes the open menu when a pointer event starts outside it', () => {
    const onToggle = vi.fn();

    render(
      <>
        <WorkspaceProjectMenu
          t={t}
          open
          activePanel='files'
          changeCount={0}
          onToggle={onToggle}
          onSelectPanel={vi.fn()}
          filesPanel={<div>files panel</div>}
          changesPanel={<div>changes panel</div>}
        />
        <div data-testid='outside' />
      </>
    );

    fireEvent.pointerDown(screen.getByTestId('outside'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('supports arrow-key navigation and closes with Escape', () => {
    const onToggle = vi.fn();

    render(
      <WorkspaceProjectMenu
        t={t}
        open
        activePanel={null}
        changeCount={0}
        onToggle={onToggle}
        onSelectPanel={vi.fn()}
        filesPanel={<div>files panel</div>}
        changesPanel={<div>changes panel</div>}
      />
    );

    const filesItem = screen.getByRole('menuitem', { name: 'conversation.workspace.changes.filesTab' });
    const changesItem = screen.getByRole('menuitem', { name: 'conversation.workspace.changes.tab' });
    filesItem.focus();

    fireEvent.keyDown(filesItem, { key: 'ArrowDown' });
    expect(changesItem).toHaveFocus();

    fireEvent.keyDown(changesItem, { key: 'Escape' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not intercept navigation keys while the Files search has focus', () => {
    render(
      <WorkspaceProjectMenu
        t={t}
        open
        activePanel='files'
        changeCount={0}
        onToggle={vi.fn()}
        onSelectPanel={vi.fn()}
        filesPanel={<input aria-label='File search' />}
        changesPanel={<div>changes panel</div>}
      />
    );

    const searchInput = screen.getByRole('textbox', { name: 'File search' });
    searchInput.focus();

    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    expect(searchInput).toHaveFocus();
  });
});
