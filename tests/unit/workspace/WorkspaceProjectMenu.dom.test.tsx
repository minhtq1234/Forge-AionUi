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
    className,
    onClick,
    role,
    ...props
  }: React.PropsWithChildren<{
    className?: string;
    role?: string;
    tabIndex?: number;
    children?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    [key: string]: unknown;
  }>) => (
    <button type='button' className={className} onClick={onClick} role={role} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@icon-park/react', () => ({
  BranchOne: () => <span />,
  Down: () => <span />,
  FolderOpen: () => <span />,
  FileText: () => <span />,
  Right: () => <span />,
}));

const t = (key: string) => key;

describe('WorkspaceProjectMenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the active files panel and context metadata', () => {
    const { container } = render(
      <WorkspaceProjectMenu
        t={t}
        open
        activePanel='files'
        changeCount={3}
        contextBudgetLabel='9%'
        showContext
        onToggle={vi.fn()}
        onSelectPanel={vi.fn()}
        filesPanel={<div>files panel</div>}
        changesPanel={<div>changes panel</div>}
        contextPanel={<div>context panel</div>}
      />
    );

    expect(screen.getByText('files panel')).toBeInTheDocument();
    expect(screen.queryByText('changes panel')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'conversation.workspace.changes.filesTab' })).toHaveClass(
      'workspace-project-menu-item-active'
    );
    const overlay = container.querySelector('.workspace-project-overlay');
    const overlayChildren = Array.from(overlay?.children ?? []);

    expect(overlayChildren[0]).toHaveClass('workspace-project-flyout');
    expect(overlayChildren[1]).toHaveClass('workspace-project-menu-popover');
    expect(container.querySelector('.workspace-project-flyout-header')).not.toBeInTheDocument();
    expect(container.querySelector('.workspace-project-menu-separator')).toBeInTheDocument();
    expect(screen.queryByText('Temporary Space')).not.toBeInTheDocument();
    expect(screen.queryByText('⇧⌘F')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /conversation.contextHandoff.sectionTitle.*9%/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /conversation.workspace.changes.tab.*3/ })).toBeInTheDocument();
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
    );

    fireEvent.pointerDown(document.body);

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
        showContext={false}
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
