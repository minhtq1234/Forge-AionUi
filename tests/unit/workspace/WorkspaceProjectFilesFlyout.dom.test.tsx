/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import WorkspaceProjectFilesFlyout from '@/renderer/pages/conversation/Workspace/components/WorkspaceProjectFilesFlyout';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    className,
    onClick,
    onContextMenu,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button type='button' className={className} onClick={onClick} onContextMenu={onContextMenu} {...props}>
      {children}
    </button>
  ),
  Input: ({
    className,
    value,
    onChange,
    placeholder,
  }: {
    className?: string;
    value?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      className={className}
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
      placeholder={placeholder}
    />
  ),
}));

vi.mock('@icon-park/react', () => ({
  FileText: () => <span />,
  FolderOpen: () => <span />,
  Right: () => <span />,
  Search: () => <span />,
}));

const sourceFile: IDirOrFile = {
  name: 'app.ts',
  fullPath: '/workspace/src/app.ts',
  relativePath: 'src/app.ts',
  isDir: false,
  isFile: true,
};

const contextFile: IDirOrFile = {
  name: 'Context.md',
  fullPath: '/workspace/Context.md',
  relativePath: 'Context.md',
  isDir: false,
  isFile: true,
};

const srcFolder: IDirOrFile = {
  name: 'src',
  fullPath: '/workspace/src',
  relativePath: 'src',
  isDir: true,
  isFile: false,
  children: [sourceFile],
};

const readmeFile: IDirOrFile = {
  name: 'README.md',
  fullPath: '/workspace/README.md',
  relativePath: 'README.md',
  isDir: false,
  isFile: true,
};

const aionrsFolder: IDirOrFile = {
  name: '.aionrs',
  fullPath: '/workspace/.aionrs',
  relativePath: '.aionrs',
  isDir: true,
  isFile: false,
  children: [],
};

const t = (key: string) => key;

describe('WorkspaceProjectFilesFlyout', () => {
  afterEach(() => {
    cleanup();
  });

  it('toggles a folder and opens a nested file when it is expanded', () => {
    const onOpenFile = vi.fn();
    const onToggleFolder = vi.fn();

    const { rerender } = render(
      <WorkspaceProjectFilesFlyout
        t={t}
        workspaceDisplayName='Demo project'
        files={[srcFolder, readmeFile]}
        expandedKeys={[]}
        onToggleFolder={onToggleFolder}
        onOpenFile={onOpenFile}
      />
    );

    expect(screen.queryByText('app.ts')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'src' }));

    expect(onToggleFolder).toHaveBeenCalledWith(srcFolder);

    rerender(
      <WorkspaceProjectFilesFlyout
        t={t}
        workspaceDisplayName='Demo project'
        files={[srcFolder, readmeFile]}
        expandedKeys={['src']}
        onToggleFolder={onToggleFolder}
        onOpenFile={onOpenFile}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'app.ts' }));

    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ relativePath: sourceFile.relativePath }));
  });

  it('searches recursively and opens a matching nested file without expanding its folder', () => {
    const onOpenFile = vi.fn();

    render(
      <WorkspaceProjectFilesFlyout
        t={t}
        workspaceDisplayName='Demo project'
        files={[srcFolder, readmeFile]}
        expandedKeys={[]}
        onToggleFolder={vi.fn()}
        onOpenFile={onOpenFile}
      />
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'app.ts' } });
    fireEvent.click(screen.getByRole('button', { name: 'app.ts' }));

    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ relativePath: sourceFile.relativePath }));
  });

  it('forwards a file context-menu request to the workspace callback', () => {
    const onOpenContextMenu = vi.fn();

    render(
      <WorkspaceProjectFilesFlyout
        t={t}
        workspaceDisplayName='Demo project'
        files={[srcFolder, readmeFile]}
        expandedKeys={[]}
        onToggleFolder={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenContextMenu={onOpenContextMenu}
      />
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'README.md' }), { clientX: 24, clientY: 48 });

    expect(onOpenContextMenu).toHaveBeenCalledWith(readmeFile, 24, 48);
  });

  it('shows the empty-search state when no file matches', () => {
    render(
      <WorkspaceProjectFilesFlyout
        t={t}
        workspaceDisplayName='Demo project'
        files={[srcFolder, readmeFile]}
        expandedKeys={[]}
        onToggleFolder={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing-file' } });
    expect(screen.getByText('conversation.workspace.search.empty')).toBeInTheDocument();
  });

  it('marks Context.md as the managed context file', () => {
    render(
      <WorkspaceProjectFilesFlyout
        t={t}
        workspaceDisplayName='Temporary Space'
        files={[aionrsFolder, contextFile]}
        expandedKeys={[]}
        onToggleFolder={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Context.md' })).toHaveClass('workspace-project-files-row-context');
    expect(
      screen.getByRole('button', { name: 'Context.md' }).querySelector('.workspace-project-files-context-indicator')
    ).toBeInTheDocument();
  });
});
