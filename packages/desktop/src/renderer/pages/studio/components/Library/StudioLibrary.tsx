/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Input, Modal, Select, Spin } from '@arco-design/web-react';
import { Add, Delete, Film } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type {
  StudioAspectRatio,
  StudioProjectSummary,
  StudioRendererProject,
} from '@/common/types/project/creativeStudioTypes';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import StudioEmptyState from './StudioEmptyState';
import styles from './StudioLibrary.module.css';

const ACTIVE_JOB_STATUSES = new Set(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention']);

const aspectRatioOptions: Array<{ value: StudioAspectRatio; key: string }> = [
  { value: '16:9', key: 'aspectRatio16x9' },
  { value: '9:16', key: 'aspectRatio9x16' },
  { value: '1:1', key: 'aspectRatio1x1' },
  { value: '4:3', key: 'aspectRatio4x3' },
  { value: '3:4', key: 'aspectRatio3x4' },
];

const storyboardStatusKey = (hasOptions: boolean): string =>
  hasOptions
    ? 'conversation.creativeStudio.library.readinessReady'
    : 'conversation.creativeStudio.library.readinessSetupRequired';

const hasActiveWork = (jobs: Record<string, { status: string }>): boolean =>
  Object.values(jobs).some((job) => ACTIVE_JOB_STATUSES.has(job.status));

export const StudioLibrary: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [readiness, setReadiness] = useState<boolean | null>(null);
  const [listErrorMessageKey, setListErrorMessageKey] = useState<string | null>(null);
  const [createErrorMessageKey, setCreateErrorMessageKey] = useState<string | null>(null);
  const [deleteErrorMessageKey, setDeleteErrorMessageKey] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<StudioRendererProject | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletePreparing, setDeletePreparing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [aspectRatio, setAspectRatio] = useState<StudioAspectRatio>('16:9');
  const [duration, setDuration] = useState('15');
  const listRequestRef = useRef(0);
  const deletePreparationRef = useRef(0);
  const mutationBusy = creating || deletePreparing || deleting;

  const refreshProjects = useCallback(async (): Promise<void> => {
    const request = ++listRequestRef.current;
    setProjectsLoading(true);
    try {
      const result = await ipcBridge.creativeStudio.listProjects.invoke();
      if (listRequestRef.current !== request) return;
      if (result.ok === false) {
        setListErrorMessageKey(result.error.messageKey);
        return;
      }
      setProjects(result.data);
      setListErrorMessageKey(null);
    } catch {
      if (listRequestRef.current === request) {
        setListErrorMessageKey('conversation.creativeStudio.errors.storage');
      }
    } finally {
      if (listRequestRef.current === request) setProjectsLoading(false);
    }
  }, []);

  const refreshReadiness = useCallback(async (): Promise<void> => {
    try {
      const result = await ipcBridge.creativeStudio.listRoutes.invoke({});
      if (result.ok) setReadiness(result.data.storyboard.options.length > 0);
    } catch {
      setReadiness(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
    void refreshReadiness();
    const unsubscribe = ipcBridge.creativeStudio.projectUpdated.on(() => {
      void refreshProjects();
    });
    return () => {
      listRequestRef.current += 1;
      deletePreparationRef.current += 1;
      unsubscribe();
    };
  }, [refreshProjects, refreshReadiness]);

  const openCreate = useCallback(() => {
    setCreateErrorMessageKey(null);
    setCreateVisible(true);
  }, []);

  const closeCreate = useCallback(() => {
    if (!creating) {
      setCreateErrorMessageKey(null);
      setCreateVisible(false);
    }
  }, [creating]);

  const createProject = useCallback(async (): Promise<void> => {
    const targetDurationSeconds = Number(duration);
    if (!Number.isInteger(targetDurationSeconds) || targetDurationSeconds < 5 || targetDurationSeconds > 60) {
      setCreateErrorMessageKey('conversation.creativeStudio.create.invalidDuration');
      return;
    }
    setCreating(true);
    setCreateErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.createProject.invoke({
        name,
        brief,
        aspectRatio,
        targetDurationSeconds,
        resolution: '720p',
      });
      if (result.ok === false) {
        setCreateErrorMessageKey(result.error.messageKey);
        return;
      }
      await refreshProjects();
      setCreateVisible(false);
      navigate(`/studio/${result.data.id}`);
    } catch {
      setCreateErrorMessageKey('conversation.creativeStudio.errors.storage');
    } finally {
      setCreating(false);
    }
  }, [aspectRatio, brief, duration, name, navigate, refreshProjects]);

  const prepareDelete = useCallback(async (candidate: StudioProjectSummary): Promise<void> => {
    const request = ++deletePreparationRef.current;
    setDeletePreparing(true);
    setDeleteErrorMessageKey(null);
    try {
      const canonical = await ipcBridge.creativeStudio.getProject.invoke({ projectId: candidate.id });
      if (deletePreparationRef.current !== request) return;
      if (canonical.ok === false) {
        setDeleteErrorMessageKey(canonical.error.messageKey);
        return;
      }
      if (!canonical.data) {
        setDeleteErrorMessageKey('conversation.creativeStudio.errors.projectNotFound');
        return;
      }
      if (hasActiveWork(canonical.data.jobs)) {
        setDeleteErrorMessageKey('conversation.creativeStudio.library.deleteActiveWork');
        return;
      }
      setDeleteCandidate(canonical.data);
    } catch {
      if (deletePreparationRef.current === request) {
        setDeleteErrorMessageKey('conversation.creativeStudio.errors.storage');
      }
    } finally {
      if (deletePreparationRef.current === request) setDeletePreparing(false);
    }
  }, []);

  const deleteProject = useCallback(async (): Promise<void> => {
    if (!deleteCandidate) return;
    setDeleting(true);
    setDeleteErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.deleteProject.invoke({
        projectId: deleteCandidate.id,
        expectedRevision: deleteCandidate.revision,
      });
      if (result.ok === false) {
        setDeleteErrorMessageKey(result.error.messageKey);
        return;
      }
      setDeleteCandidate(null);
      await refreshProjects();
    } catch {
      setDeleteErrorMessageKey('conversation.creativeStudio.errors.storage');
    } finally {
      setDeleting(false);
    }
  }, [deleteCandidate, refreshProjects]);

  return (
    <section aria-label={t('conversation.creativeStudio.library.title')} className={styles.library}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('conversation.creativeStudio.library.title')}</h1>
          <p className={styles.subtitle}>{t('conversation.creativeStudio.library.subtitle')}</p>
        </div>
        <Button type='primary' icon={<Add />} disabled={mutationBusy || deleteCandidate !== null} onClick={openCreate}>
          {t('conversation.creativeStudio.library.newProject')}
        </Button>
      </header>

      {readiness !== null && (
        <div className={styles.readiness}>
          <span>{t('conversation.creativeStudio.library.readinessLabel')}</span>
          <span>{t(storyboardStatusKey(readiness))}</span>
        </div>
      )}
      {listErrorMessageKey && (
        <div role='alert' className={styles.alert}>
          {t(listErrorMessageKey)}
        </div>
      )}
      {deleteErrorMessageKey && !deleteCandidate && (
        <div role='alert' className={styles.alert}>
          {t(deleteErrorMessageKey)}
        </div>
      )}

      {projectsLoading && projects.length === 0 ? (
        <div className={styles.loading}>
          <Spin tip={t('conversation.creativeStudio.library.loading')} />
        </div>
      ) : projects.length === 0 ? (
        <StudioEmptyState disabled={mutationBusy || deleteCandidate !== null} onCreate={openCreate} />
      ) : (
        <div className={styles.grid}>
          {projects.map((project) => (
            <Card key={project.id} size='small' className='min-w-0'>
              <div className={styles.cardHeader}>
                <Button type='text' icon={<Film />} onClick={() => navigate(`/studio/${project.id}`)}>
                  {project.name}
                </Button>
                <Button
                  type='text'
                  status='danger'
                  icon={<Delete />}
                  aria-label={t('conversation.creativeStudio.library.deleteProject')}
                  disabled={createVisible || mutationBusy || deleteCandidate !== null}
                  onClick={() => void prepareDelete(project)}
                />
              </div>
              <p className={styles.sceneCount}>
                {t('conversation.creativeStudio.library.sceneCount', { count: project.sceneCount })}
              </p>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title={t('conversation.creativeStudio.create.title')}
        visible={createVisible}
        onCancel={closeCreate}
        footer={
          <>
            <Button disabled={creating} onClick={closeCreate}>
              {t('conversation.creativeStudio.create.cancel')}
            </Button>
            <Button type='primary' loading={creating} onClick={() => void createProject()}>
              {t('conversation.creativeStudio.create.submit')}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          {createErrorMessageKey && (
            <div role='alert' className={styles.alert}>
              {t(createErrorMessageKey)}
            </div>
          )}
          <label htmlFor='studio-project-name'>{t('conversation.creativeStudio.create.nameLabel')}</label>
          <Input
            id='studio-project-name'
            value={name}
            placeholder={t('conversation.creativeStudio.create.namePlaceholder')}
            onChange={setName}
          />
          <label htmlFor='studio-project-brief'>{t('conversation.creativeStudio.create.briefLabel')}</label>
          <Input.TextArea
            id='studio-project-brief'
            value={brief}
            placeholder={t('conversation.creativeStudio.create.briefPlaceholder')}
            onChange={setBrief}
          />
          <label htmlFor='studio-project-aspect'>{t('conversation.creativeStudio.create.aspectRatioLabel')}</label>
          <Select
            id='studio-project-aspect'
            aria-label={t('conversation.creativeStudio.create.aspectRatioLabel')}
            value={aspectRatio}
            onChange={(value) => setAspectRatio(value as StudioAspectRatio)}
          >
            {aspectRatioOptions.map((option) => (
              <Select.Option key={option.value} value={option.value}>
                {t(`conversation.creativeStudio.create.${option.key}`)}
              </Select.Option>
            ))}
          </Select>
          <label htmlFor='studio-project-duration'>{t('conversation.creativeStudio.create.targetDurationLabel')}</label>
          <Input id='studio-project-duration' type='number' value={duration} onChange={setDuration} />
        </div>
      </Modal>

      <Modal
        title={t('conversation.creativeStudio.library.deleteConfirmTitle')}
        visible={deleteCandidate !== null}
        onCancel={() => !deleting && setDeleteCandidate(null)}
        footer={
          <>
            <Button disabled={deleting} onClick={() => setDeleteCandidate(null)}>
              {t('conversation.creativeStudio.create.cancel')}
            </Button>
            <Button type='primary' status='danger' loading={deleting} onClick={() => void deleteProject()}>
              {t('conversation.creativeStudio.library.deleteConfirm')}
            </Button>
          </>
        }
      >
        {deleteErrorMessageKey && (
          <div role='alert' className={styles.alert}>
            {t(deleteErrorMessageKey)}
          </div>
        )}
        <p>{t('conversation.creativeStudio.library.deleteConfirmBody', { name: deleteCandidate?.name ?? '' })}</p>
      </Modal>
    </section>
  );
};
