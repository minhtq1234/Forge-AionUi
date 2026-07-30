/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Spin } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { StudioLibrary } from './components';
import { useStudioProject } from './hooks';
import styles from './StudioPage.module.css';

const StudioProjectShell: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { project, loading, notFound, errorMessageKey } = useStudioProject(id);

  if (loading) {
    return (
      <div className={styles.centered}>
        <Spin tip={t('conversation.creativeStudio.project.loading')} />
      </div>
    );
  }

  if (errorMessageKey && !project) {
    return (
      <div role='alert' className={styles.centered}>
        {t(errorMessageKey)}
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className={styles.centered}>
        <p>{t('conversation.creativeStudio.project.notFound')}</p>
        <Button type='primary' onClick={() => navigate('/studio')}>
          {t('conversation.creativeStudio.library.openProject')}
        </Button>
      </div>
    );
  }

  return (
    <section aria-label={t('conversation.creativeStudio.project.title')} className={styles.projectShell}>
      {errorMessageKey && (
        <div role='alert' className={styles.projectAlert}>
          {t(errorMessageKey)}
        </div>
      )}
      <header className={styles.projectHeader}>
        <div>
          <h1 className='m-0 text-24px font-600 text-t-primary'>{project.name}</h1>
          <p className='m-0 mt-6px text-14px text-t-secondary'>{project.brief}</p>
        </div>
        <Button onClick={() => navigate('/studio')}>{t('conversation.creativeStudio.library.title')}</Button>
      </header>
      <dl className={styles.projectMetadata}>
        <div>
          <dt>{t('conversation.creativeStudio.project.aspectRatio')}</dt>
          <dd>{project.aspectRatio}</dd>
        </div>
        <div>
          <dt>{t('conversation.creativeStudio.project.targetDuration')}</dt>
          <dd>{project.targetDurationSeconds}</dd>
        </div>
        <div>
          <dt>{t('conversation.creativeStudio.project.resolution')}</dt>
          <dd>{project.resolution}</dd>
        </div>
        <div>
          <dt>{t('conversation.creativeStudio.project.sceneCount')}</dt>
          <dd>{project.sceneOrder.length}</dd>
        </div>
      </dl>
      <div className={styles.placeholder}>{t('conversation.creativeStudio.project.emptyStoryboard')}</div>
    </section>
  );
};

const StudioPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return <main className={styles.page}>{id ? <StudioProjectShell /> : <StudioLibrary />}</main>;
};

export default StudioPage;
