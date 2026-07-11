/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import { Button, Input } from '@arco-design/web-react';
import { FileText, FolderOpen, Right, Search } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useMemo, useState } from 'react';

type WorkspaceProjectFilesFlyoutProps = {
  t: TFunction;
  workspaceDisplayName: string;
  files: IDirOrFile[];
  expandedKeys: string[];
  onToggleFolder: (node: IDirOrFile) => void;
  onOpenFile: (node: IDirOrFile) => void;
  onOpenContextMenu?: (node: IDirOrFile, x: number, y: number) => void;
  searchText?: string;
  onSearchTextChange?: (value: string) => void;
};

const filterFiles = (files: IDirOrFile[], query: string): IDirOrFile[] => {
  if (!query) return files;

  return files.reduce<IDirOrFile[]>((visibleFiles, file) => {
    const children = filterFiles(file.children ?? [], query);
    if (file.name.toLocaleLowerCase().includes(query) || children.length > 0) {
      visibleFiles.push({ ...file, children });
    }
    return visibleFiles;
  }, []);
};

const WorkspaceProjectFilesFlyout: React.FC<WorkspaceProjectFilesFlyoutProps> = ({
  t,
  workspaceDisplayName,
  files,
  expandedKeys,
  onToggleFolder,
  onOpenFile,
  onOpenContextMenu,
  searchText: controlledSearchText,
  onSearchTextChange,
}) => {
  const [internalSearchText, setInternalSearchText] = useState('');
  const searchText = controlledSearchText ?? internalSearchText;
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();
  const visibleFiles = useMemo(() => filterFiles(files, normalizedSearchText), [files, normalizedSearchText]);

  const renderFiles = (nodes: IDirOrFile[], depth = 0): React.ReactNode =>
    nodes.map((node) => {
      const isFolder = !node.isFile;
      const isExpanded = expandedKeys.includes(node.relativePath);
      const showChildren = isFolder && (isExpanded || normalizedSearchText.length > 0);
      const rowStyle = { paddingInlineStart: `${10 + depth * 17}px` };

      return (
        <React.Fragment key={node.relativePath}>
          <Button
            type='text'
            className='workspace-project-files-row'
            style={rowStyle}
            aria-expanded={isFolder ? isExpanded : undefined}
            onClick={() => {
              if (isFolder) {
                onToggleFolder(node);
                return;
              }
              onOpenFile(node);
            }}
            onContextMenu={(event) => {
              if (!onOpenContextMenu) return;
              event.preventDefault();
              onOpenContextMenu(node, event.clientX, event.clientY);
            }}
          >
            {isFolder ? (
              <Right
                theme='outline'
                size='13'
                className={
                  isExpanded ? 'workspace-project-files-chevron is-expanded' : 'workspace-project-files-chevron'
                }
              />
            ) : (
              <span className='workspace-project-files-chevron-spacer' />
            )}
            <span className='workspace-project-files-icon'>
              {isFolder ? <FolderOpen theme='outline' size='16' /> : <FileText theme='outline' size='16' />}
            </span>
            <span className='workspace-project-files-name'>{node.name}</span>
          </Button>
          {showChildren && node.children && renderFiles(node.children, depth + 1)}
        </React.Fragment>
      );
    });

  return (
    <div className='workspace-project-files' data-testid='project-files-flyout'>
      <Input
        className='workspace-project-files-search'
        aria-label={t('conversation.workspace.searchPlaceholder')}
        placeholder={t('conversation.workspace.searchPlaceholder')}
        value={searchText}
        onChange={(value) => {
          if (controlledSearchText === undefined) setInternalSearchText(value);
          onSearchTextChange?.(value);
        }}
        prefix={<Search theme='outline' size='15' />}
      />
      <div className='workspace-project-files-title'>{workspaceDisplayName}</div>
      <div className='workspace-project-files-list'>
        {visibleFiles.length > 0 ? (
          renderFiles(visibleFiles)
        ) : (
          <div className='workspace-project-files-empty'>{t('conversation.workspace.search.empty')}</div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceProjectFilesFlyout;
