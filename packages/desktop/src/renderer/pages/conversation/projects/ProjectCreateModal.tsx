/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ForgeProject } from '@/common/types/project/projectTypes';
import { Button, Input, Message, Modal } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createProject, findProjectByWorkspace, getWorkspaceBasename } from './projectStorage';

export type ProjectCreateModalProps = {
  visible: boolean;
  initialWorkspace?: string;
  onCancel: () => void;
  onCreated: (project: ForgeProject) => void;
};

export const ProjectCreateModal = ({ visible, initialWorkspace, onCancel, onCreated }: ProjectCreateModalProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) {
      setName('');
      setWorkspace('');
      setError(null);
      setLoading(false);
      return;
    }
    if (initialWorkspace) {
      setWorkspace(initialWorkspace);
      setName(getWorkspaceBasename(initialWorkspace));
    }
  }, [initialWorkspace, visible]);

  const duplicateProject = useMemo(() => (workspace ? findProjectByWorkspace(workspace) : null), [workspace]);
  const isCreateDisabled = !workspace || Boolean(duplicateProject);
  const validationError = duplicateProject
    ? t('conversation.history.projectDuplicateFolder', { name: duplicateProject.name })
    : error;

  const chooseFolder = async () => {
    const result = await ipcBridge.dialog.showOpen.invoke({
      defaultPath: workspace || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    const selectedFolder = result?.[0];
    if (!selectedFolder) {
      return;
    }
    setWorkspace(selectedFolder);
    setName((currentName) => currentName.trim() || getWorkspaceBasename(selectedFolder));
    setError(null);
  };

  const handleCreate = () => {
    if (!workspace) {
      setError(t('conversation.history.projectFolderRequired'));
      return;
    }
    if (duplicateProject) {
      setError(t('conversation.history.projectDuplicateFolder', { name: duplicateProject.name }));
      return;
    }

    setLoading(true);
    try {
      const project = createProject({
        name: name.trim() || getWorkspaceBasename(workspace),
        workspace,
      });
      Message.success(t('conversation.history.createProjectSuccess'));
      onCreated(project);
    } catch (createError) {
      console.error('Failed to create project:', createError);
      Message.error(t('conversation.history.createProjectFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t('conversation.history.createProjectTitle')}
      onCancel={onCancel}
      onOk={handleCreate}
      okText={t('conversation.history.createProject')}
      cancelText={t('common.cancel')}
      confirmLoading={loading}
      okButtonProps={{ disabled: isCreateDisabled, type: isCreateDisabled ? 'secondary' : 'primary' }}
      alignCenter
      getPopupContainer={() => document.body}
    >
      <div className='flex flex-col gap-16px'>
        <label className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('conversation.history.projectNameLabel')}</span>
          <Input
            aria-label={t('conversation.history.projectNameLabel')}
            value={name}
            placeholder={t('conversation.history.projectNamePlaceholder')}
            onChange={setName}
            allowClear
          />
        </label>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('conversation.history.projectFolderLabel')}</span>
          <div className='flex items-center gap-8px'>
            <Input value={workspace} readOnly placeholder={t('conversation.history.projectFolderPlaceholder')} />
            <Button icon={<FolderOpen theme='outline' size='16' />} onClick={() => void chooseFolder()}>
              {workspace
                ? t('conversation.history.changeProjectFolder')
                : t('conversation.history.chooseProjectFolder')}
            </Button>
          </div>
        </div>

        {validationError ? <div className='text-12px leading-18px text-danger-6'>{validationError}</div> : null}
      </div>
    </Modal>
  );
};
